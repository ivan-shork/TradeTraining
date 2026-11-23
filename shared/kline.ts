import type { Kline } from './types'

/** "20210315" → 毫秒时间戳（本地时区，避免 UTC 偏移错日） */
export function dateToTs(yyyymmdd: string): number {
  return new Date(
    +yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8),
  ).getTime()
}

export function tsToDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

/** 显示用 "2021-03-15" */
export function fmtDisp(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
}

/** 周 K 聚合：按自然周（周一起）分组（需求 5.3.2） */
export function aggregateWeekly(klines: Kline[]): Kline[] {
  const out: Kline[] = []
  let cur: Kline | null = null
  let curWeek = ''
  for (const k of klines) {
    const d = new Date(+k.tradeDate.slice(0, 4), +k.tradeDate.slice(4, 6) - 1, +k.tradeDate.slice(6, 8))
    const day = (d.getDay() + 6) % 7
    d.setDate(d.getDate() - day)
    const week = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    if (week !== curWeek) {
      cur = { ...k }
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

/** klinecharts 数据行 */
export interface CandleData {
  timestamp: number
  open: number; high: number; low: number; close: number
  volume: number
  turnover?: number
  tradeDate: string
  /** 进行中周 K 标记（最后一根不满一周） */
  partial?: boolean
}

export function toCandle(k: Kline): CandleData {
  return {
    timestamp: dateToTs(k.tradeDate),
    open: k.open, high: k.high, low: k.low, close: k.close,
    volume: k.vol, turnover: k.amount, tradeDate: k.tradeDate,
  }
}
