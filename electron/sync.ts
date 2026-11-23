/** 数据同步：fund_basic → 标的池落库；全量=逐标的拉全历史（校准用）；增量=按交易日全市场补齐 */
import { getDb } from './db'
import {
  fetchFundBasic, fetchFundDaily, fetchFundAdj, tsRequest, TushareError,
  type FundDailyRow, type FundAdjRow,
} from './tushare'
import { classifyFund, isT0 } from './instruments'
import { getSettings } from './settings'
import type { SyncProgress } from '../shared/types'

type ProgressCb = (p: SyncProgress) => void
type LogCb = (msg: string) => void

let syncing = false
export function isSyncing() {
  return syncing
}

/** 同步主入口。mode: full 全量 / incremental 增量补齐 */
export async function runSync(
  mode: 'full' | 'incremental',
  onProgress: ProgressCb,
  onLog: LogCb,
): Promise<void> {
  if (syncing) throw new Error('已有同步任务进行中')
  syncing = true
  try {
    const token = getSettings().token
    if (!token) throw new TushareError('未配置 Tushare Token', -1)

    // ---------- 阶段 1：标的列表 ----------
    onProgress({ phase: 'fund_basic', current: 0, total: 1, message: '拉取场内基金列表...' })
    const basics = await fetchFundBasic(token)
    const db = getDb()
    const upsertInst = db.prepare(`
      INSERT INTO instruments (code, name, category, invest_type, list_date, t0_eligible)
      VALUES (@code, @name, @category, @investType, @listDate, @t0)
      ON CONFLICT(code) DO UPDATE SET
        name=excluded.name, category=excluded.category,
        invest_type=excluded.invest_type, list_date=excluded.list_date,
        t0_eligible=excluded.t0_eligible
    `)
    let kept = 0
    const keptCodes: string[] = []
    for (const row of basics) {
      const cat = classifyFund(row)
      if (!cat) continue
      upsertInst.run({
        code: row.ts_code,
        name: row.name,
        category: cat,
        investType: row.invest_type ?? '',
        listDate: row.list_date ?? '',
        t0: isT0(cat) ? 1 : 0,
      })
      keptCodes.push(row.ts_code)
      kept++
    }
    onLog(`标的池：场内基金 ${basics.length} 只，过滤后保留 ${kept} 只（剔除债/货币/REITs/非ETF）`)
    if (kept === 0) {
      throw new Error(`fund_basic 返回 ${basics.length} 只但过滤后为 0——字段取值与预期不符，请反馈开发`)
    }
    if (basics.length === 0) {
      throw new Error('fund_basic 返回空列表：Token 无该接口权限（需 120 积分以上）')
    }

    // ---------- 阶段 2：行情数据 ----------
    // 增量：按交易日全市场拉取（每天 2 次请求，断点后只需补最近几天，秒级完成）
    // 全量：逐标的从 2010 年重拉（校准/修复用途，耗时长）
    if (mode === 'incremental') {
      await syncIncrementalByDate(token, onProgress, onLog)
      onProgress({ phase: 'done', current: 1, total: 1, message: '同步完成' })
      onLog('增量同步完成。')
      return
    }

    const codes = db.prepare(
      `SELECT code FROM instruments WHERE in_blacklist = 0 ORDER BY code`,
    ).all() as { code: string }[]
    const total = codes.length
    const insertK = db.prepare(`
      INSERT OR REPLACE INTO kline_cache (code, trade_date, open, high, low, close, vol, amount, adj_factor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const lastDateOf = db.prepare(
      `SELECT MAX(trade_date) AS d FROM kline_cache WHERE code = ?`,
    )
    const insertMany = db.transaction((rows: [string, string, number, number, number, number, number, number, number][]) => {
      for (const r of rows) insertK.run(...r)
    })

    for (let i = 0; i < total; i++) {
      const code = codes[i].code
      onProgress({
        phase: 'kline', current: i + 1, total, code,
        message: `同步 ${code}（${i + 1}/${total}）`,
      })
      try {
        // 全量模式：一律从 2010 年重拉（校准/修复用途）；断点续传由 INSERT OR REPLACE 天然保证
        const start = '20100101'
        const end = todayStr()
        const [daily, adj] = await Promise.all([
          fetchFundDaily(token, code, start, end),
          fetchFundAdj(token, code, start, end),
        ])
        if (!daily.length) continue
        const adjMap = new Map(adj.map((a) => [a.trade_date, a.adj_factor]))
        const rows = daily.map((d) => [
          code, d.trade_date, d.open, d.high, d.low, d.close, d.vol ?? 0, d.amount ?? 0,
          adjMap.get(d.trade_date) ?? 1,
        ] as [string, string, number, number, number, number, number, number, number])
        insertMany(rows)
      } catch (e) {
        if (e instanceof TushareError && e.code === -1) throw e
        onLog(`⚠ ${code} 同步失败：${(e as Error).message}，跳过`)
      }
      // 限速：Tushare 不同积分频次不同，留基础间隔
      await sleepSmall()
    }

    onProgress({ phase: 'done', current: total, total, message: '同步完成' })
    onLog('数据同步完成，可开始训练。')
  } finally {
    syncing = false
  }
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function nextDate(yyyymmdd: string): string {
  const y = +yyyymmdd.slice(0, 4), m = +yyyymmdd.slice(4, 6), d = +yyyymmdd.slice(6, 8)
  const dt = new Date(y, m - 1, d + 1)
  return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}`
}

function daysBetween(from: string, to: string): number {
  const p = (s: string) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)).getTime()
  return Math.round((p(to) - p(from)) / 86400000)
}

function fmtDisp(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
}

/** 增量同步：按交易日全市场拉 fund_daily/fund_adj，只写本地已收录的标的 */
async function syncIncrementalByDate(
  token: string,
  onProgress: ProgressCb,
  onLog: LogCb,
) {
  const db = getDb()
  const last = (db.prepare(`SELECT MAX(trade_date) AS d FROM kline_cache`).get() as { d: string | null }).d
  if (!last) throw new Error('本地无历史数据，请先执行全量同步')
  const today = todayStr()
  let cur = nextDate(last)
  if (cur > today) {
    onLog(`本地数据已到 ${fmtDisp(last)}，无需增量。`)
    return
  }
  const totalDays = daysBetween(cur, today) + 1
  onLog(`增量：从 ${fmtDisp(cur)} 补到 ${fmtDisp(today)}，共 ${totalDays} 天`)

  const instrumentCodes = new Set(
    (db.prepare(`SELECT code FROM instruments`).all() as { code: string }[]).map((r) => r.code),
  )
  const insertMany = db.transaction((rows: [string, string, number, number, number, number, number, number, number][]) => {
    const insertK = db.prepare(`
      INSERT OR REPLACE INTO kline_cache (code, trade_date, open, high, low, close, vol, amount, adj_factor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const r of rows) insertK.run(...r)
  })

  let day = 0, inserted = 0
  while (cur <= today) {
    day++
    onProgress({
      phase: 'kline', current: day, total: totalDays,
      message: `增量同步 ${fmtDisp(cur)}（${day}/${totalDays} 天）`,
    })
    try {
      const [daily, adj] = await Promise.all([
        tsRequest<FundDailyRow>('fund_daily', token, { trade_date: cur },
          'ts_code,trade_date,open,high,low,close,pre_close,vol,amount'),
        tsRequest<FundAdjRow>('fund_adj', token, { trade_date: cur },
          'ts_code,trade_date,adj_factor'),
      ])
      if (daily.length) {
        const adjMap = new Map(adj.map((a) => [a.ts_code, a.adj_factor]))
        const rows = daily
          .filter((d) => instrumentCodes.has(d.ts_code))
          .map((d) => [
            d.ts_code, d.trade_date, d.open, d.high, d.low, d.close, d.vol ?? 0, d.amount ?? 0,
            adjMap.get(d.ts_code) ?? 1,
          ] as [string, string, number, number, number, number, number, number, number])
        if (rows.length) { insertMany(rows); inserted += rows.length }
      }
    } catch (e) {
      onLog(`⚠ ${fmtDisp(cur)} 增量失败：${(e as Error).message}，跳过`)
    }
    cur = nextDate(cur)
    await sleepSmall()
  }
  onLog(`增量完成：新写入 ${inserted} 行（非交易日自动为空）`)
}

function sleepSmall() {
  return new Promise((r) => setTimeout(r, 350))
}
