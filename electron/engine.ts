/** 训练引擎：随机出题、步进揭示、日/周切换、撮合成交、账户、结算。与标的类型解耦（需求 4.2） */
import { getDb } from './db'
import { getSettings } from './settings'
import type {
  Kline, Session, SessionConfig, OrderRequest, Trade, Settlement,
  PoolEstimate, Category, Freq, MatchModel, AccountState, TradeRule,
  PoolChoice, AppSettings,
} from '../shared/types'
import { isCommonCrossborder, isKeptLof } from './instruments'
import { testToken } from './tushare'

/** 出题池 SQL 分类条件 + JS 行过滤（策略类剔除、小众跨境剔除、商品开关） */
function poolCats(s: AppSettings, pool: PoolChoice): string[] {
  if (pool === 'all' || pool === 'watchlist') {
    const cats = ['broad', 'industry']
    if (!s.excludeCrossborder) cats.push('crossborder')
    if (!s.excludeCommodity) cats.push('commodity')
    return cats
  }
  if (pool === 'crossborder') return ['crossborder', 'commodity']  // 显式选择时两者都给
  return [pool]
}

function poolRowFilter<T extends { name: string; category: string }>(rows: T[], pool: PoolChoice): T[] {
  return rows.filter((r) => {
    if (r.name.includes('策略')) return false
    if (!isKeptLof(r.name)) return false
    if (r.category === 'crossborder' && !isCommonCrossborder(r.name)) return false
    return true
  })
}

// ---------------------------------------------------------------- 工具

/** mulberry32 可复现随机数 */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

/** 周 K 聚合：按自然周分组（周一为一周起点） */
export function aggregateWeekly(klines: Kline[]): Kline[] {
  const out: Kline[] = []
  let cur: Kline | null = null
  let curWeek = ''
  for (const k of klines) {
    const d = new Date(
      +k.tradeDate.slice(0, 4), +k.tradeDate.slice(4, 6) - 1, +k.tradeDate.slice(6, 8),
    )
    // ISO 周一作为一周开始
    const day = (d.getDay() + 6) % 7
    d.setDate(d.getDate() - day)
    const week = fmtDate(d)
    if (week !== curWeek) {
      cur = { ...k, tradeDate: k.tradeDate }
      out.push(cur)
      curWeek = week
    } else if (cur) {
      cur.high = Math.max(cur.high, k.high)
      cur.low = Math.min(cur.low, k.low)
      cur.close = k.close
      cur.vol += k.vol
      cur.amount += k.amount
    }
  }
  return out
}

// ---------------------------------------------------------------- 数据读取

interface KlineRow {
  trade_date: string; open: number; high: number; low: number; close: number
  vol: number; amount: number; adj_factor: number
}

/** 读原始 K 线并前复权（以最新因子为基准，全程形态连续，需求 5.1.3） */
export function loadKlinesQfq(code: string): Kline[] {
  const db = getDb()
  const rows = db.prepare(
    `SELECT trade_date, open, high, low, close, vol, amount, adj_factor
     FROM kline_cache WHERE code = ? ORDER BY trade_date`,
  ).all(code) as KlineRow[]
  if (!rows.length) return []
  const base = rows[rows.length - 1].adj_factor || 1
  return rows.map((r) => ({
    tradeDate: r.trade_date,
    open: +(r.open * r.adj_factor / base).toFixed(4),
    high: +(r.high * r.adj_factor / base).toFixed(4),
    low: +(r.low * r.adj_factor / base).toFixed(4),
    close: +(r.close * r.adj_factor / base).toFixed(4),
    vol: r.vol, amount: r.amount,
  }))
}

// ---------------------------------------------------------------- 标的池估算（5.2.5 交互细节）

export function estimatePool(config: SessionConfig): PoolEstimate {
  const db = getDb()
  const s = getSettings()
  const reasons: string[] = []
  const cats = poolCats(s, config.pool)
  const placeholders = cats.map(() => '?').join(',')
  let where = `in_blacklist = 0 AND category IN (${placeholders})`
  if (config.pool === 'watchlist') where += ` AND in_watchlist = 1`
  const rows = poolRowFilter(db.prepare(
    `SELECT i.code, i.name, i.category, i.list_date,
       (SELECT COUNT(*) FROM kline_cache k WHERE k.code = i.code) AS cnt,
       (SELECT AVG(amount) FROM (
          SELECT amount FROM kline_cache WHERE code = i.code
          ORDER BY trade_date DESC LIMIT 250
       )) AS avg_amount
     FROM instruments i WHERE ${where}`,
  ).all(...cats) as { code: string; name: string; category: string; list_date: string; cnt: number; avg_amount: number | null }[], config.pool)

  let list = rows
  if (s.minHistory > 0) {
    const before = list.length
    list = list.filter((r) => r.cnt >= s.minHistory)
    if (list.length < before) reasons.push(`历史 K 线不足 ${s.minHistory} 根剔除 ${before - list.length} 只`)
  }
  if (s.minListYears > 0) {
    const cutoff = fmtDate(new Date(Date.now() - s.minListYears * 365.25 * 86400_000))
    const before = list.length
    list = list.filter((r) => r.list_date && r.list_date < cutoff)
    if (list.length < before) reasons.push(`上市不足 ${s.minListYears} 年剔除 ${before - list.length} 只`)
  }
  if (s.minAvgAmount > 0) {
    // fund_daily.amount 单位为千元；设置项 minAvgAmount 单位为万元 → 换算
    const threshold = s.minAvgAmount * 10
    const before = list.length
    list = list.filter((r) => (r.avg_amount ?? 0) >= threshold)
    if (list.length < before) reasons.push(`近 250 日日均成交额不足 ${s.minAvgAmount} 万剔除 ${before - list.length} 只`)
  }
  if (config.era !== 'all') {
    const years = config.era === 'y3' ? 3 : config.era === 'y5' ? 5 : 0
    if (years > 0) {
      const cutoff = `${new Date().getFullYear() - years}0101`
      const before = list.length
      list = list.filter((r) => r.cnt >= 250 && hasDataAfter(r.code, cutoff))
      if (list.length < before) reasons.push(`历史时间段筛选剔除 ${before - list.length} 只`)
    } else if (config.era === 'after2015') {
      const before = list.length
      list = list.filter((r) => hasDataAfter(r.code, '20150101'))
      if (list.length < before) reasons.push(`2015 年后无数据剔除 ${before - list.length} 只`)
    }
  }
  return { count: list.length, reasons }
}

function hasDataAfter(code: string, date: string): boolean {
  const db = getDb()
  const row = db.prepare(
    `SELECT 1 AS ok FROM kline_cache WHERE code = ? AND trade_date >= ? LIMIT 1`,
  ).get(code, date) as { ok: number } | undefined
  return !!row
}

/** 当前总本金 = 起始本金 + 全部已结算局盈亏（本金滚动制） */
export function currentCapital(): number {
  const db = getDb()
  const s = getSettings()
  const r = db.prepare(`SELECT COALESCE(SUM(pnl_amount), 0) AS p FROM settlements`).get() as { p: number }
  return +(s.initCash + r.p).toFixed(2)
}

/** 删除一局训练的全部数据（结算/成交/画线/状态/局记录） */
export function deleteSessionData(sessionId: number): void {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM settlements WHERE session_id = ?`).run(sessionId)
    db.prepare(`DELETE FROM trades WHERE session_id = ?`).run(sessionId)
    db.prepare(`DELETE FROM drawings WHERE session_id = ?`).run(sessionId)
    db.prepare(`DELETE FROM session_state WHERE session_id = ?`).run(sessionId)
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId)
  })
  tx()
}

// ---------------------------------------------------------------- 出题（5.2）

/**
 * 训练起点在全量 K 线数组中的真实索引。
 * 注意：绝不能假设"起点 = 第 contextBars+1 根"——起点是随机的（如 idx=792），
 * 此前用 contextBars 当基址导致步进取到 2021 年数据接到 2024 年图后的严重 bug。
 */
function startIndexOf(session: Session, klines: Kline[]): number {
  const i = klines.findIndex((k) => k.tradeDate === session.startDate)
  return i < 0 ? session.contextBars : i
}

interface EraRange { from: string; to: string }

function eraToRange(config: SessionConfig): EraRange {
  const y = new Date().getFullYear()
  switch (config.era) {
    case 'y3': return { from: `${y - 3}0101`, to: '20991231' }
    case 'y5': return { from: `${y - 5}0101`, to: '20991231' }
    case 'after2015': return { from: '20150101', to: '20991231' }
    case 'custom':
      return { from: `${config.eraFrom ?? '2015'}0101`, to: `${config.eraTo ?? y}1231` }
    default: return { from: '20100101', to: '20991231' }
  }
}

/** 平衡抽样：随机抽多个候选起点，按涨/跌/震荡分层后各 1/3 概率抽取 */
function pickStartBalanced(
  klines: Kline[], range: EraRange, contextBars: number, minSteps: number,
  rand: () => number,
): number {
  const candidates: { idx: number; chg: number }[] = []
  const tries = 24
  for (let t = 0; t < tries; t++) {
    const idx = pickStartRandom(klines, range, contextBars, minSteps, rand)
    if (idx < 0) continue
    const probe = Math.min(idx + minSteps, klines.length - 1)
    const chg = klines[probe].close / klines[idx].close - 1
    candidates.push({ idx, chg })
  }
  if (!candidates.length) return -1
  const up = candidates.filter((c) => c.chg > 0.15)
  const down = candidates.filter((c) => c.chg < -0.15)
  const flat = candidates.filter((c) => Math.abs(c.chg) <= 0.15)
  const layers = [up, down, flat].filter((l) => l.length)
  const layer = layers[Math.floor(rand() * layers.length)]
  return layer[Math.floor(rand() * layer.length)].idx
}

function pickStartRandom(
  klines: Kline[], range: EraRange, contextBars: number, minSteps: number,
  rand: () => number,
): number {
  // 可作起点的 idx：idx>=contextBars（前面有足够上下文）且 idx+minSteps<len（后面有足够步数）
  let lo = klines.findIndex((k) => k.tradeDate >= range.from)
  if (lo < 0) return -1
  lo = Math.max(lo, contextBars)
  let hi = klines.length - 1
  while (hi >= 0 && klines[hi].tradeDate > range.to) hi--
  hi = hi - minSteps
  if (hi < lo) {
    // 起点后不足 minSteps：放宽为有 60 根即可
    hi = klines.length - 1 - Math.min(60, klines.length - 1 - contextBars)
    if (hi < lo) return -1
  }
  return lo + Math.floor(rand() * (hi - lo + 1))
}

const MIN_STEPS = 60

export function startSession(config: SessionConfig): { session: Session; klines: Kline[] } | { error: string } {
  const db = getDb()
  const s = getSettings()
  const seed = config.seed ?? Math.floor(Math.random() * 2 ** 31)
  const rand = rng(seed)

  // 1. 筛选候选标的（与 estimatePool 相同规则）
  const cats = poolCats(s, config.pool)
  const placeholders = cats.map(() => '?').join(',')
  let where = `in_blacklist = 0 AND category IN (${placeholders})`
  if (config.pool === 'watchlist') where += ` AND in_watchlist = 1`
  const rows = poolRowFilter(db.prepare(
    `SELECT i.code, i.name, i.category, i.list_date,
       (SELECT COUNT(*) FROM kline_cache k WHERE k.code = i.code) AS cnt
     FROM instruments i WHERE ${where}`,
  ).all(...cats) as { code: string; name: string; category: string; list_date: string; cnt: number }[], config.pool)

  const cutoff = s.minListYears > 0
    ? fmtDate(new Date(Date.now() - s.minListYears * 365.25 * 86400_000)) : ''
  const range = eraToRange(config)
  const candidates = rows.filter((r) =>
    r.cnt >= s.minHistory && (!cutoff || (r.list_date && r.list_date < cutoff)),
  )
  if (!candidates.length) return { error: '候选标的池为空：请先同步数据或放宽筛选条件' }

  // 2. 随机抽标的 + 随机起点（最多尝试 50 个标的，避免死循环）
  for (let t = 0; t < 50; t++) {
    const inst = candidates[Math.floor(rand() * candidates.length)]
    const klines = loadKlinesQfq(inst.code)
    if (klines.length < s.minHistory) continue
    const idx =
      config.sampleMode === 'balanced'
        ? pickStartBalanced(klines, range, config.contextBars, MIN_STEPS, rand)
        : pickStartRandom(klines, range, config.contextBars, MIN_STEPS, rand)
    if (idx < 0) continue

    // 3. 建 session + state（初始资金 = 当前滚动本金）
    const matchModel: MatchModel = config.rulePreset === 'default'
      ? s.rule.matchModel
      : config.rulePreset === 'real' ? 'B' : 'A'
    const initCash = currentCapital()
    const now = new Date().toISOString()
    const info = db.prepare(`
      INSERT INTO sessions (code, name, category, freq_default, start_date, seed,
        step_limit, context_bars, init_cash, match_model, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ongoing', ?)
    `).run(
      inst.code, inst.name, inst.category, config.freq, klines[idx].tradeDate, seed,
      config.stepLimit === 'unlimited' ? 0 : config.stepLimit, config.contextBars,
      initCash, matchModel, now,
    )
    const sessionId = Number(info.lastInsertRowid)
    db.prepare(`
      INSERT INTO session_state (session_id, revealed_count, cash, position_qty,
        avg_cost, realized_pnl, equity_curve, last_freq)
      VALUES (?, 1, ?, 0, 0, 0, ?, ?)
    `).run(
      sessionId, initCash,
      JSON.stringify([equityPoint(klines, idx, initCash, klines[idx].open)]),
      config.freq,
    )
    const session: Session = {
      id: sessionId, code: inst.code, name: inst.name, category: inst.category as Category,
      freqDefault: config.freq, startDate: klines[idx].tradeDate, endDate: klines[idx].tradeDate,
      seed, stepLimit: config.stepLimit === 'unlimited' ? 0 : config.stepLimit,
      contextBars: config.contextBars, initCash, matchModel,
      status: 'ongoing', createdAt: now,
    }
    // 只返回上下文 + 第 1 根（防未来函数）
    return { session, klines: klines.slice(idx - config.contextBars, idx + 1) }
  }
  return { error: '随机出题失败：候选标的历史区间不足，请放宽时间段或长度设置' }
}

/** 资金曲线打点：asset = 现金+持仓市值；benchmark = 买入持有（起点开盘买入） */
function equityPoint(
  klines: Kline[], idx: number, initCash: number, baseOpen: number, qty = 0, cash = 0,
) {
  const close = klines[idx].close
  return {
    date: klines[idx].tradeDate,
    asset: +(cash + qty * close).toFixed(2),
    benchmark: +(initCash * close / baseOpen).toFixed(2),
  }
}

// ---------------------------------------------------------------- 步进（5.3）

export interface StepResult {
  kline: Kline
  revealedCount: number
  finished: boolean
  filled?: Trade          // 模型 B 挂单在本次开盘成交
  settlement?: Settlement
}

export function stepSession(sessionId: number): StepResult | { error: string } {
  const db = getDb()
  const session = getSession(sessionId)
  if (!session) return { error: '训练局不存在' }
  if (session.status !== 'ongoing') return { error: '本局已结算' }
  const state = getState(sessionId)
  const klines = loadKlinesQfq(session.code)
  // 起点在全量数组中的真实索引（随机，不能按 contextBars 假设）
  const startIdx = startIndexOf(session, klines)
  const nextRevealed = state.revealed_count + 1
  const nextIdx = startIdx + nextRevealed - 1
  if (nextIdx >= klines.length) {
    // 数据已走完：直接结算
    const r = finish(sessionId)
    if ('error' in r) return r
    return {
      kline: klines[klines.length - 1], revealedCount: state.revealed_count,
      finished: true, settlement: r,
    }
  }

  // 模型 B：挂单在下一根开盘价成交
  let filled: Trade | undefined
  const pending = state.pending_order ? JSON.parse(state.pending_order) as {
    side: 'buy' | 'sell'; qty: number; note: string; tags: string[]; orderDate: string
  } : null
  if (pending) {
    const res = matchOrder(sessionId, session, {
      cash: state.cash, positionQty: state.position_qty, avgCost: state.avg_cost,
      realizedPnl: state.realized_pnl, revealed: state.revealed_count,
    }, {
      side: pending.side, qty: pending.qty, price: klines[nextIdx].open,
      note: pending.note, tags: pending.tags, tradeDate: klines[nextIdx].tradeDate,
    })
    if ('error' in res) {
      db.prepare(`UPDATE session_state SET pending_order = NULL WHERE session_id = ?`).run(sessionId)
    } else {
      filled = res.trade
    }
  }

  // 更新揭示数与资金曲线
  const freshState = getState(sessionId)
  const equity = JSON.parse(freshState.equity_curve) as { date: string; asset: number; benchmark: number }[]
  equity.push(equityPoint(
    klines, nextIdx, session.initCash, klines[startIdx].open,
    freshState.position_qty, freshState.cash,
  ))
  db.prepare(`UPDATE session_state SET revealed_count = ?, equity_curve = ? WHERE session_id = ?`)
    .run(nextRevealed, JSON.stringify(equity), sessionId)
  db.prepare(`UPDATE sessions SET end_date = ? WHERE id = ?`).run(klines[nextIdx].tradeDate, sessionId)

  const finished = session.stepLimit > 0 && nextRevealed >= session.stepLimit
  if (nextIdx === klines.length - 1 || finished) {
    const r = finish(sessionId)
    if (!('error' in r)) return { kline: klines[nextIdx], revealedCount: nextRevealed, finished: true, filled, settlement: r }
  }
  return { kline: klines[nextIdx], revealedCount: nextRevealed, finished: false, filled }
}

// ---------------------------------------------------------------- 下单撮合（5.4）

interface MatchInput {
  side: 'buy' | 'sell'; qty: number; price: number
  note?: string; tags?: string[]; tradeDate: string
}

function currentRule(sessionId: number): TradeRule {
  const s = getSettings()
  return s.rule
}

function matchOrder(
  sessionId: number, session: Session, state: AccountState & { revealed?: number },
  input: MatchInput,
): { trade: Trade } | { error: string } {
  const db = getDb()
  const rule = currentRule(sessionId)
  const klines = loadKlinesQfq(session.code)
  const idx = startIndexOf(session, klines) + (state.revealed ?? 1) - 1
  const cur = klines[idx]
  const prevClose = idx > 0 ? klines[idx - 1].close : cur.open

  // 滑点
  const slip = rule.slippage
  const price = input.side === 'buy' ? input.price * (1 + slip) : input.price * (1 - slip)
  const fee = Math.max(rule.feeMin, price * input.qty * rule.feeRate)

  let { cash, positionQty, avgCost, realizedPnl } = state
  if (input.side === 'buy') {
    const cost = price * input.qty + fee
    if (cost > cash + 1e-6) return { error: '资金不足，拒绝下单' }
    avgCost = positionQty + input.qty === 0 ? price
      : (avgCost * positionQty + price * input.qty) / (positionQty + input.qty)
    cash -= cost
    positionQty += input.qty
  } else {
    if (input.qty > positionQty) return { error: '持仓份额不足，拒绝下单' }
    realizedPnl += (price - avgCost) * input.qty - fee
    cash += price * input.qty - fee
    positionQty -= input.qty
    if (positionQty === 0) avgCost = 0
  }

  const seq = ((db.prepare(`SELECT MAX(seq) AS m FROM trades WHERE session_id = ?`).get(sessionId) as { m: number | null }).m ?? 0) + 1
  const ins = db.prepare(`
    INSERT INTO trades (session_id, seq, side, price, qty, fee, note, tags, match_model, trade_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'filled')
  `).run(sessionId, seq, input.side, +price.toFixed(4), input.qty, +fee.toFixed(2),
    input.note ?? '', JSON.stringify(input.tags ?? []), session.matchModel, input.tradeDate)
  db.prepare(`
    UPDATE session_state SET cash = ?, position_qty = ?, avg_cost = ?, realized_pnl = ?,
      last_buy_date = ?
    WHERE session_id = ?
  `).run(
    +cash.toFixed(2), positionQty, +avgCost.toFixed(4), +realizedPnl.toFixed(2),
    input.side === 'buy' ? input.tradeDate : null, sessionId,
  )
  const trade: Trade = {
    id: Number(ins.lastInsertRowid), sessionId, seq, side: input.side,
    price: +price.toFixed(4), qty: input.qty, fee: +fee.toFixed(2),
    note: input.note ?? '', tags: input.tags ?? [], matchModel: session.matchModel,
    tradeDate: input.tradeDate, status: 'filled',
  }
  return { trade }
}

export function placeOrder(req: OrderRequest): { trade: Trade } | { pending: true } | { error: string } {
  const db = getDb()
  const session = getSession(req.sessionId)
  if (!session) return { error: '训练局不存在' }
  if (session.status !== 'ongoing') return { error: '本局已结算' }
  const state = getState(req.sessionId)
  const rule = currentRule(req.sessionId)
  const klines = loadKlinesQfq(session.code)
  const idx = startIndexOf(session, klines) + state.revealed_count - 1
  const cur = klines[idx]
  const prevClose = idx > 0 ? klines[idx - 1].close : cur.open

  // 参数校验
  if (!Number.isInteger(req.qty) || req.qty <= 0) return { error: '份额必须为正整数' }
  if (req.qty % rule.lotSize !== 0) return { error: `份额须为 ${rule.lotSize} 的整倍数` }
  if (req.note && req.note.length > 200) return { error: '备注不能超过 200 字' }

  const price = req.price ?? cur.close
  // 涨跌停（ETF ±10%）
  if (rule.limitUpDown) {
    const up = prevClose * 1.1, down = prevClose * 0.9
    if (price > up + 1e-6 || price < down - 1e-6) {
      return { error: `委托价超出涨跌停范围（${down.toFixed(3)} ~ ${up.toFixed(3)}）` }
    }
  }
  // T+1：当日买入不可卖
  if (req.side === 'sell' && rule.t1 && state.last_buy_date === cur.tradeDate) {
    return { error: 'T+1 限制：当日买入的份额今日不可卖出' }
  }

  // 撮合模型 B：挂单待下一根开盘成交
  if (session.matchModel === 'B') {
    if (state.pending_order) return { error: '已有待成交委托' }
    db.prepare(`UPDATE session_state SET pending_order = ? WHERE session_id = ?`).run(
      JSON.stringify({ side: req.side, qty: req.qty, note: req.note ?? '', tags: req.tags ?? [], orderDate: cur.tradeDate }),
      req.sessionId,
    )
    return { pending: true }
  }
  return matchOrder(req.sessionId, session, {
    cash: state.cash, positionQty: state.position_qty, avgCost: state.avg_cost,
    realizedPnl: state.realized_pnl, revealed: state.revealed_count,
  }, {
    side: req.side, qty: req.qty, price, note: req.note, tags: req.tags, tradeDate: cur.tradeDate,
  })
}

// ---------------------------------------------------------------- 状态读取

export function getSession(sessionId: number): Session | null {
  const db = getDb()
  const r = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as any
  if (!r) return null
  return {
    id: r.id, code: r.code, name: r.name, category: r.category, freqDefault: r.freq_default,
    startDate: r.start_date, endDate: r.end_date, seed: r.seed, stepLimit: r.step_limit,
    contextBars: r.context_bars, initCash: r.init_cash, matchModel: r.match_model,
    status: r.status, createdAt: r.created_at, settledAt: r.settled_at,
  }
}

export interface StateRow {
  session_id: number
  revealed_count: number
  cash: number
  position_qty: number
  avg_cost: number
  realized_pnl: number
  equity_curve: string
  pending_order: string | null
  last_freq: string
  last_buy_date: string | null
}

export function getState(sessionId: number): StateRow {
  const db = getDb()
  return db.prepare(`SELECT * FROM session_state WHERE session_id = ?`).get(sessionId) as StateRow
}

export function getSessionTrades(sessionId: number): Trade[] {
  const db = getDb()
  const rows = db.prepare(`SELECT * FROM trades WHERE session_id = ? ORDER BY seq`).all(sessionId) as any[]
  return rows.map((r) => ({
    id: r.id, sessionId: r.session_id, seq: r.seq, side: r.side, price: r.price,
    qty: r.qty, fee: r.fee, note: r.note, tags: JSON.parse(r.tags ?? '[]'),
    matchModel: r.match_model, tradeDate: r.trade_date, status: r.status,
  }))
}

// ---------------------------------------------------------------- 结算（5.6）

export function finish(sessionId: number): Settlement | { error: string } {
  const db = getDb()
  const session = getSession(sessionId)
  if (!session) return { error: '训练局不存在' }
  if (session.status === 'settled') {
    const row = db.prepare(`SELECT * FROM settlements WHERE session_id = ?`).get(sessionId) as any
    if (row) return hydrateSettlement(row)
  }
  const state = getState(sessionId)
  const klines = loadKlinesQfq(session.code)
  const startIdx = startIndexOf(session, klines)
  const lastIdx = startIdx + state.revealed_count - 1
  const firstIdx = startIdx
  const lastClose = klines[lastIdx].close
  const firstOpen = klines[firstIdx].open

  const endAsset = state.cash + state.position_qty * lastClose
  const pnlAmount = endAsset - session.initCash
  const totalReturn = pnlAmount / session.initCash
  const periodChange = lastClose / firstOpen - 1
  const excessReturn = totalReturn - periodChange
  const excessPnl = pnlAmount - session.initCash * periodChange

  // 最大回撤（资金曲线）；空曲线或全程无回落时为 0，不可为 -Infinity（NOT NULL 数值列）
  const equity = JSON.parse(state.equity_curve) as { asset: number }[]
  let peak = -Infinity, mdd = 0
  for (const p of equity) {
    peak = Math.max(peak, p.asset)
    mdd = Math.min(mdd, p.asset / peak - 1)
  }
  if (!Number.isFinite(mdd)) mdd = 0

  // 行为指标
  const trades = getSessionTrades(sessionId)
  const buys = trades.filter((t) => t.side === 'buy')
  const sells = trades.filter((t) => t.side === 'sell')
  // 完整回合 = FIFO 配对
  const buyQueue: { date: string; qty: number; price: number }[] = []
  const rounds: { pnl: number; days: number }[] = []
  const kdateIdx = new Map(klines.map((k, i) => [k.tradeDate, i]))
  for (const t of trades) {
    if (t.side === 'buy') {
      buyQueue.push({ date: t.tradeDate, qty: t.qty, price: t.price })
    } else {
      let remain = t.qty
      while (remain > 0 && buyQueue.length) {
        const b = buyQueue[0]
        const take = Math.min(b.qty, remain)
        const days = (kdateIdx.get(t.tradeDate) ?? 0) - (kdateIdx.get(b.date) ?? 0)
        rounds.push({ pnl: (t.price - b.price) * take, days })
        b.qty -= take
        remain -= take
        if (b.qty === 0) buyQueue.shift()
      }
    }
  }
  const wins = rounds.filter((r) => r.pnl > 0)
  const losses = rounds.filter((r) => r.pnl < 0)
  const winRate = rounds.length ? wins.length / rounds.length : 0
  const avgWin = wins.length ? wins.reduce((a, r) => a + r.pnl, 0) / wins.length : 0
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, r) => a + r.pnl, 0) / losses.length) : 0
  const plr = avgLoss === 0 ? -1 : avgWin / avgLoss
  const avgHold = rounds.length ? rounds.reduce((a, r) => a + r.days, 0) / rounds.length : 0
  const noted = trades.filter((t) => t.note && t.note.trim()).length
  const noteRate = trades.length ? noted / trades.length : 0
  const tagDist: Record<string, number> = {}
  for (const t of trades) for (const tag of t.tags) tagDist[tag] = (tagDist[tag] ?? 0) + 1

  const settledAt = new Date().toISOString()
  const weeks = aggregateWeekly(klines.slice(firstIdx, lastIdx + 1)).length
  const settlement: Settlement = {
    sessionId, code: session.code, name: session.name, category: session.category,
    startDate: klines[firstIdx].tradeDate, endDate: klines[lastIdx].tradeDate,
    tradeDays: state.revealed_count, weeks, revealedSteps: state.revealed_count,
    contextBars: session.contextBars, initCash: session.initCash,
    endAsset: +endAsset.toFixed(2), pnlAmount: +pnlAmount.toFixed(2),
    totalReturn, periodChange, excessReturn,
    excessPnl: +excessPnl.toFixed(2), maxDrawdown: mdd,
    buyCount: buys.length, sellCount: sells.length, winRate,
    profitLossRatio: plr === -1 ? -1 : +plr.toFixed(2),
    avgHoldingDays: +avgHold.toFixed(1), noteCompleteRate: noteRate, tagDist,
    matchModel: session.matchModel, settledAt, equityCurve: equity as Settlement['equityCurve'],
  }
  db.prepare(`
    INSERT OR REPLACE INTO settlements (session_id, code, name, category, start_date, end_date,
      trade_days, weeks, revealed_steps, context_bars, init_cash, end_asset, pnl_amount,
      total_return, period_change, excess_return, excess_pnl, max_drawdown,
      buy_count, sell_count, win_rate, profit_loss_ratio, avg_holding_days,
      note_complete_rate, tag_dist, match_model, settled_at, equity_curve)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    settlement.sessionId, settlement.code, settlement.name, settlement.category,
    settlement.startDate, settlement.endDate, settlement.tradeDays, settlement.weeks,
    settlement.revealedSteps, settlement.contextBars, settlement.initCash,
    settlement.endAsset, settlement.pnlAmount, settlement.totalReturn,
    settlement.periodChange, settlement.excessReturn, settlement.excessPnl,
    settlement.maxDrawdown, settlement.buyCount, settlement.sellCount,
    settlement.winRate, settlement.profitLossRatio, settlement.avgHoldingDays,
    settlement.noteCompleteRate, JSON.stringify(tagDist), settlement.matchModel,
    settlement.settledAt, JSON.stringify(equity),
  )
  db.prepare(`UPDATE sessions SET status = 'settled', settled_at = ?, end_date = ? WHERE id = ?`)
    .run(settledAt, settlement.endDate, sessionId)
  return settlement
}

function hydrateSettlement(r: any): Settlement {
  return {
    sessionId: r.session_id, code: r.code, name: r.name, category: r.category,
    startDate: r.start_date, endDate: r.end_date, tradeDays: r.trade_days,
    weeks: r.weeks, revealedSteps: r.revealed_steps, contextBars: r.context_bars,
    initCash: r.init_cash, endAsset: r.end_asset, pnlAmount: r.pnl_amount,
    totalReturn: r.total_return, periodChange: r.period_change,
    excessReturn: r.excess_return, excessPnl: r.excess_pnl,
    maxDrawdown: r.max_drawdown, buyCount: r.buy_count, sellCount: r.sell_count,
    winRate: r.win_rate, profitLossRatio: r.profit_loss_ratio,
    avgHoldingDays: r.avg_holding_days, noteCompleteRate: r.note_complete_rate,
    tagDist: JSON.parse(r.tag_dist ?? '{}'), matchModel: r.match_model,
    settledAt: r.settled_at, equityCurve: JSON.parse(r.equity_curve ?? '[]'),
  }
}

export function listSettlements(): Settlement[] {
  const db = getDb()
  const rows = db.prepare(`SELECT * FROM settlements ORDER BY settled_at DESC`).all() as any[]
  return rows.map(hydrateSettlement)
}

export function getSettlement(sessionId: number): Settlement | null {
  const db = getDb()
  const row = db.prepare(`SELECT * FROM settlements WHERE session_id = ?`).get(sessionId) as any
  return row ? hydrateSettlement(row) : null
}

/** 复盘回放：K 线与训练同口径（起点前 contextBars 根 → 数据末尾），成交、画线还原 */
export function getReplayData(sessionId: number) {
  const db = getDb()
  const session = getSession(sessionId)
  if (!session) return null
  const all = loadKlinesQfq(session.code)
  // 定位训练起点在全量数据中的索引，回放数组 = 起点前 contextBars 根切片到末尾
  const startIdx = all.findIndex((k) => k.tradeDate >= session.startDate)
  const from = Math.max(0, (startIdx < 0 ? all.length - 1 : startIdx) - session.contextBars)
  const klines = all.slice(from)
  const trades = getSessionTrades(sessionId)
  const drawings = (db.prepare(
    `SELECT * FROM drawings WHERE session_id = ?`,
  ).all(sessionId) as any[]).map((d) => ({
    id: d.id, sessionId: d.session_id, toolType: d.tool_type,
    pointsJson: d.points_json, styleJson: d.style_json, visible: !!d.visible,
  }))
  const state = getState(sessionId)
  return {
    session, klines, trades, drawings,
    equityCurve: JSON.parse(state.equity_curve) as Settlement['equityCurve'],
  }
}

/** 导出训练记录（CSV），不含 token */
export function exportCsv(): string {
  const rows = listSettlements()
  const header = [
    '标的代码', '名称', '类别', '区间起', '区间止', '交易日数', '揭示步数',
    '初始资金', '期末总资产', '盈亏金额', '收益率', '区间涨跌幅', '超额收益(pp)',
    '最大回撤', '买入次数', '卖出次数', '胜率', '盈亏比', '平均持仓(日)', '备注完整率', '结算时间',
  ]
  const esc = (v: unknown) => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = rows.map((r) => [
    r.code, r.name, r.category, r.startDate, r.endDate, r.tradeDays, r.revealedSteps,
    r.initCash, r.endAsset, r.pnlAmount, (r.totalReturn * 100).toFixed(2) + '%',
    (r.periodChange * 100).toFixed(2) + '%', (r.excessReturn * 100).toFixed(2),
    (r.maxDrawdown * 100).toFixed(2) + '%', r.buyCount, r.sellCount,
    (r.winRate * 100).toFixed(1) + '%', r.profitLossRatio, r.avgHoldingDays,
    (r.noteCompleteRate * 100).toFixed(0) + '%', r.settledAt,
  ].map(esc).join(','))
  // BOM 便于 Excel 中文
  return '\ufeff' + header.join(',') + '\n' + lines.join('\n')
}

export { testToken }
