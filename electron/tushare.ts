/** Tushare HTTP API 客户端（无 Python 依赖，直连 api.tushare.pro） */
// Electron 主进程自带全局 fetch（基于 net 模块），无需额外依赖

interface TsResp<T> {
  code: number
  msg: string
  data?: { fields: string[]; items: unknown[][] }
}

export class TushareError extends Error {
  constructor(msg: string, public code = 0) {
    super(msg)
  }
}

const API_URL = 'http://api.tushare.pro'

export async function tsRequest<T = Record<string, unknown>>(
  apiName: string,
  token: string,
  params: Record<string, unknown> = {},
  fields = '',
  retries = 3,
): Promise<T[]> {
  if (!token) throw new TushareError('未配置 Tushare Token，请先在设置中填写', -1)
  let lastErr: Error | null = null
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_name: apiName, token, params, fields }),
      })
      const json = (await res.json()) as TsResp<T>
      if (json.code !== 0) {
        // 每分钟频次限制：等待后重试
        if (json.msg.includes('每分钟') || json.msg.includes('频次')) {
          await sleep(15_000)
          continue
        }
        throw new TushareError(json.msg, json.code)
      }
      if (!json.data) return []
      const { fields: fs, items } = json.data
      return items.map((row) => {
        const obj: Record<string, unknown> = {}
        fs.forEach((f, idx) => (obj[f] = row[idx]))
        return obj as T
      })
    } catch (e) {
      if (e instanceof TushareError) throw e
      lastErr = e as Error
      await sleep(2000 * (i + 1))
    }
  }
  throw lastErr ?? new TushareError('网络请求失败')
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** fund_basic 行 */
export interface FundBasicRow {
  ts_code: string
  name: string
  fund_type: string
  invest_type: string
  list_date: string
  delist_date: string
  status: string
}

/** fund_daily 行 */
export interface FundDailyRow {
  ts_code: string
  trade_date: string
  open: number
  high: number
  low: number
  close: number
  pre_close: number
  vol: number
  amount: number
}

/** fund_adj 行 */
export interface FundAdjRow {
  ts_code: string
  trade_date: string
  adj_factor: number
}

export async function fetchFundBasic(token: string): Promise<FundBasicRow[]> {
  const out: FundBasicRow[] = []
  // market=E 场内基金；分页拉取
  let offset = 0
  for (;;) {
    const rows = await tsRequest<FundBasicRow>('fund_basic', token, {
      market: 'E',
      limit: 2000,
      offset,
    }, 'ts_code,name,fund_type,invest_type,list_date,delist_date,status')
    out.push(...rows)
    if (rows.length < 2000) break
    offset += 2000
  }
  return out
}

/** 拉单标的日线（按年份分批，防单次行数超限） */
export async function fetchFundDaily(
  token: string,
  code: string,
  start: string,
  end: string,
): Promise<FundDailyRow[]> {
  const out: FundDailyRow[] = []
  // 按日期分批（单次最多约 6000 行，一只 ETF 一年约 250 行，一次拉 15 年足够）
  const rows = await tsRequest<FundDailyRow>('fund_daily', token, {
    ts_code: code,
    start_date: start,
    end_date: end,
  }, 'ts_code,trade_date,open,high,low,close,pre_close,vol,amount')
  out.push(...rows)
  return out
}

export async function fetchFundAdj(
  token: string,
  code: string,
  start: string,
  end: string,
): Promise<FundAdjRow[]> {
  return tsRequest<FundAdjRow>('fund_adj', token, {
    ts_code: code,
    start_date: start,
    end_date: end,
  }, 'ts_code,trade_date,adj_factor')
}

export async function testToken(token: string): Promise<boolean> {
  const rows = await tsRequest('trade_cal', token, {
    exchange: 'SSE', start_date: '20240101', end_date: '20240110',
  }, 'cal_date')
  return rows.length > 0
}
