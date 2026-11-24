/** 标的分类标签 */
export type Category = 'broad' | 'industry' | 'crossborder' | 'commodity'

/** K 线周期 */
export type Freq = 'D' | 'W'

export interface Instrument {
  code: string            // ts_code，如 512480.SH
  name: string
  category: Category
  investType: string      // 股票型/混合型...
  listDate: string
  t0Eligible: boolean     // 跨境/商品 ETF 可 T+0
  inBlacklist: boolean
  inWatchlist: boolean
  klineCount: number      // 本地缓存的日 K 行数
  barCount: number        // 有效（复权后）日 K 行数
}

export interface Kline {
  tradeDate: string       // yyyyMMdd
  open: number
  high: number
  low: number
  close: number
  vol: number
  amount: number
}

/** 标的池选择 */
export type PoolChoice = 'all' | 'broad' | 'industry' | 'crossborder' | 'watchlist'

/** 历史时间段 */
export type EraChoice = 'all' | 'y3' | 'y5' | 'after2015' | 'custom'

/** 抽样方式 */
export type SampleMode = 'random' | 'balanced'

/** 撮合模型 */
export type MatchModel = 'A' | 'B'

/** 交易规则档位 */
export type RulePreset = 'default' | 'simple' | 'real'

/** 开局配置（弹窗） */
export interface SessionConfig {
  stepLimit: number | 'unlimited'   // 可走 K 线数
  pool: PoolChoice
  era: EraChoice
  eraFrom?: string                  // custom 时起止年份
  eraTo?: string
  freq: Freq
  contextBars: number               // 起点前上下文根数
  sampleMode: SampleMode
  seed?: number
  rulePreset: RulePreset
}

export interface TradeRule {
  matchModel: MatchModel
  lotSize: number            // 最小交易单位 100
  t1: boolean                // T+1 限制
  feeRate: number            // 万 1 => 0.0001
  feeMin: number             // 最低 0
  slippage: number           // 0.001 => 0.1%
  limitUpDown: boolean       // 涨跌停限制
}

export type SessionStatus = 'ongoing' | 'settled'

export interface Session {
  id: number
  code: string
  name: string
  category: Category
  freqDefault: Freq
  startDate: string
  endDate: string
  seed: number
  stepLimit: number         // 0 = 不限
  contextBars: number
  initCash: number
  matchModel: MatchModel
  status: SessionStatus
  createdAt: string
  settledAt?: string
}

export type Side = 'buy' | 'sell'

/** 下单请求 */
export interface OrderRequest {
  sessionId: number
  side: Side
  qty: number
  price?: number            // 缺省用当前 K 线收盘价
  note?: string
  tags?: string[]
}

/** 已成交记录 */
export interface Trade {
  id: number
  sessionId: number
  seq: number
  side: Side
  price: number
  qty: number
  fee: number
  note: string
  tags: string[]            // JSON
  matchModel: MatchModel
  tradeDate: string
  /** 撮合模型 B：下单时先挂起，下一步开盘成交 */
  status: 'filled' | 'pending'
}

/** 账户状态 */
export interface AccountState {
  cash: number
  positionQty: number
  avgCost: number
  realizedPnl: number
}

export interface Settlement {
  sessionId: number
  code: string
  name: string
  category: Category
  startDate: string
  endDate: string
  tradeDays: number
  weeks: number
  revealedSteps: number
  contextBars: number
  initCash: number
  endAsset: number
  pnlAmount: number
  totalReturn: number
  periodChange: number      // 区间涨跌幅
  excessReturn: number      // 超额收益（百分点）
  excessPnl: number         // 超额收益（金额）
  maxDrawdown: number
  buyCount: number
  sellCount: number
  winRate: number
  profitLossRatio: number   // -1 表示无亏损样本
  avgHoldingDays: number
  noteCompleteRate: number
  tagDist: Record<string, number>
  matchModel: MatchModel
  settledAt: string
  /** 星标（重要局收藏） */
  starred: number
  /** 整局复盘笔记（回放时对照 K 线撰写） */
  note: string
  /** 资金曲线与买卖持有基准（复算用） */
  equityCurve: { date: string; asset: number; benchmark: number }[]
}

/** 画线 */
export interface Drawing {
  id: number
  sessionId: number
  toolType: string
  pointsJson: string
  styleJson: string
  visible: boolean
}

/** 全局设置 */
export interface AppSettings {
  token: string
  initCash: number
  rule: TradeRule
  defaultConfig: SessionConfig
  excludeCrossborder: boolean
  excludeCommodity: boolean    // 商品 ETF（黄金/原油/有色等）从"全部/自选池"剔除
  minListYears: number          // 上市不足 N 年剔除，0 = 不剔除
  minAvgAmount: number          // 近 250 日日均成交额下限（万元），0 = 不剔除
  minHistory: number            // 历史 K 线行数下限
  theme: 'dark' | 'light'
  upColor: 'red' | 'green'      // 红涨绿跌 / 绿涨红跌
  rememberLastConfig: boolean
  autoSyncOnStart: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  token: '',
  initCash: 200000,
  rule: {
    matchModel: 'A',
    lotSize: 100,
    t1: true,
    feeRate: 0.0001,
    feeMin: 0,
    slippage: 0,
    limitUpDown: true,
  },
  defaultConfig: {
    stepLimit: 120,
    pool: 'all',
    era: 'after2015',
    freq: 'D',
    contextBars: 120,
    sampleMode: 'random',
    rulePreset: 'default',
  },
  excludeCrossborder: false,
  excludeCommodity: true,
  minListYears: 2,
  minAvgAmount: 1000,
  minHistory: 250,
  theme: 'dark',
  upColor: 'red',
  rememberLastConfig: true,
  autoSyncOnStart: false,
}

/** 理由标签（5.4.1） */
export const REASON_TAGS = [
  '突破', '回踩支撑', '超跌反弹', '趋势跟随',
  '消息面', '止损', '止盈', '情绪化',
] as const

export interface SyncProgress {
  phase: 'fund_basic' | 'kline' | 'done'
  current: number
  total: number
  code?: string
  message: string
}

/** 开局前估算 */
export interface PoolEstimate {
  count: number
  reasons: string[]   // 数据不足时的原因说明
}

/** 出题结果（响应 startSession） */
export interface NewSessionView {
  session: Session
  /** 全部 K 线（前复权）——渲染层只取前 revealedCount+context 根，此数组不落渲染进程缓存以外的地方 */
  klines: Kline[]
  contextBars: number
  revealedCount: number   // 已揭示步数（开局 = 1，即起点那根）
}
