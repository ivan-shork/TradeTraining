/** ETF 标的池过滤与分类打标（需求 5.1.2） */
import type { Category } from '../shared/types'
import type { FundBasicRow } from './tushare'

/** 名称兜底剔除关键词（防字段标注不全；"策略"=主动策略类，非指数跟踪，不适合形态训练） */
const NAME_EXCLUDE = ['债', '国债', '短融', '货币', '理财', '存单', '质押', '回购', '策略', '增强策略']

/** 宽基关键词（顺序匹配，命中即打宽基标签） */
const BROAD_KEYWORDS = [
  '沪深300', '300ETF', '中证500', '500ETF', '中证1000', '1000ETF',
  '科创50', '科创板50', '创业板', '创业', '上证50', '50ETF', 'A500',
  '红利', '红利低波', '中证800', '800ETF', '中证100', '100ETF',
  '中证A50', 'A50', '中证2000', '2000ETF', '沪深300增强', '全指',
  '央企', '国企', '大盘', '中盘', '小盘', '价值', '成长', 'MSCI中国A50',
]

/** 跨境关键词 */
const CROSSBORDER_KEYWORDS = [
  '纳指', '纳斯达克', '标普', '美国', '美股', '日经', '东证', '日本',
  '恒生', '香港', '港股', '恒生科技', '恒生医疗', '恒生互联网', '法国',
  '德国', '亚太', '东南亚', '印度', '沙特', '海外',
]

/** 常规跨境白名单：主流市场指数（恒生/港股/纳指/标普/日经/德法），小众（沙特/东南亚/印度等）剔除 */
const CROSSBORDER_KEEP = [
  '纳指', '纳斯达克', '标普', '美国', '美股', '日经', '东证', '日本',
  '恒生', '香港', '港股', '德国', '法国',
]

/** 是否常规跨境标的（白名单外的剔除） */
export function isCommonCrossborder(name: string): boolean {
  return CROSSBORDER_KEEP.some((k) => name.includes(k))
}

/** 大众 LOF 白名单（名称含 LOF 的默认剔除，命中白名单的保留） */
const LOF_KEEP = ['保险主题']

/** 是否保留的 LOF（非 LOF 一律保留） */
export function isKeptLof(name: string): boolean {
  if (!name.toUpperCase().includes('LOF')) return true
  return LOF_KEEP.some((k) => name.includes(k))
}

/** 商品关键词 */
const COMMODITY_KEYWORDS = ['黄金', '原油', '石油', '豆粕', '有色', '白银', '铜', '稀土', '期货']

export function classifyFund(row: FundBasicRow): Category | null {
  // 1. fund_type 大类过滤（Tushare 实际取值：股票型/混合型/债券型/货币型/REITs/其他）
  //    只保留股票型与混合型，剔除债、货币、REITs、其他
  if (!['股票型', '混合型'].includes(row.fund_type ?? '')) return null
  // 2. invest_type 兜底剔除（实际主力是"被动指数型/增强指数型"，不在白名单内也保留）
  const it = row.invest_type ?? ''
  if (['债券型', '货币型'].includes(it)) return null
  if (it.includes('债券') || it.includes('货币')) return null
  // 3. 未上市/无上市日期的剔除（无法构成历史训练区间）
  if (!row.list_date) return null
  // 4. 名称兜底剔除（防字段标注不全）
  if (NAME_EXCLUDE.some((k) => row.name.includes(k))) return null
  // 5. LOF 默认剔除，仅保留大众白名单（保险主题等）
  if (!isKeptLof(row.name)) return null

  // 分类打标：跨境/商品优先于宽基（如"纳指ETF"含"纳指"）
  if (CROSSBORDER_KEYWORDS.some((k) => row.name.includes(k))) return 'crossborder'
  if (COMMODITY_KEYWORDS.some((k) => row.name.includes(k)) || it.includes('期货型')) return 'commodity'
  if (BROAD_KEYWORDS.some((k) => row.name.includes(k))) return 'broad'
  return 'industry'
}

export function categoryLabel(c: Category): string {
  return { broad: '宽基', industry: '行业/主题', crossborder: '跨境', commodity: '商品' }[c]
}

/** 跨境/商品 ETF 场内可 T+0 */
export function isT0(category: Category): boolean {
  return category === 'crossborder' || category === 'commodity'
}
