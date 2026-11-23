/** 右侧常驻下单面板（需求 5.4.1 / 界面布局） */
import { useState } from 'react'
import { REASON_TAGS, type TradeRule, type AccountState, type Kline } from '@shared/types'

interface Props {
  account: AccountState
  curKline: Kline | null
  rule: TradeRule
  matchModel: 'A' | 'B'
  pendingOrder: { side: string } | null
  onOrder: (side: 'buy' | 'sell', qty: number, note: string, tags: string[]) => Promise<string | null>
}

export default function OrderPanel({ account, curKline, rule, matchModel, pendingOrder, onOrder }: Props) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [qty, setQty] = useState(100)
  const [note, setNote] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null)

  const price = curKline?.close ?? 0
  const lot = rule.lotSize

  const quickQty = (frac: number | 'max') => {
    if (side === 'buy') {
      const useCash = frac === 'max' ? account.cash : account.cash * frac
      const q = Math.floor(useCash / (price * (1 + rule.feeRate) * (1 + rule.slippage)))
      setQty(Math.max(0, Math.floor(q / lot) * lot))
    } else {
      const q = frac === 'max' ? account.positionQty : Math.floor(account.positionQty * frac)
      setQty(Math.floor(q / lot) * lot)
    }
  }

  const submit = async (forceSide?: 'buy' | 'sell') => {
    const s = forceSide ?? side
    const err = await onOrder(s, qty, note, tags)
    if (err) setMsg({ kind: 'err', text: err })
    else {
      setMsg({ kind: 'ok', text: s === 'buy' ? `已${matchModel === 'B' ? '挂单' : '买入'} ${qty} 份` : `已${matchModel === 'B' ? '挂单' : '卖出'} ${qty} 份` })
      setNote('')
      setTags([])
    }
  }

  const toggleTag = (t: string) =>
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))

  const marketValue = account.positionQty * price
  const totalAsset = account.cash + marketValue
  const floatPnl = account.avgCost > 0 ? (price - account.avgCost) * account.positionQty : 0
  const floatPct = account.avgCost > 0 ? (price / account.avgCost - 1) * 100 : 0

  return (
    <div className="order-panel">
      <div className="section-title">账户</div>
      <div className="account-grid">
        <span>总资产</span><b>¥ {totalAsset.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</b>
        <span>现金</span><b>¥ {account.cash.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</b>
        <span>持仓</span><b>{account.positionQty} 份</b>
        <span>成本</span><b>{account.avgCost > 0 ? `¥ ${account.avgCost.toFixed(3)}` : '—'}</b>
        <span>浮动盈亏</span>
        <b className={floatPnl > 0 ? 'num-up' : floatPnl < 0 ? 'num-down' : ''}>
          {account.positionQty > 0 ? `¥ ${floatPnl >= 0 ? '+' : ''}${floatPnl.toFixed(0)} (${floatPct.toFixed(1)}%)` : '—'}
        </b>
        <span>仓位</span><b>{totalAsset > 0 ? ((marketValue / totalAsset) * 100).toFixed(1) + '%' : '—'}</b>
      </div>

      <div className="section-title" style={{ marginTop: 14 }}>下单{matchModel === 'B' && <span className="tag" style={{ marginLeft: 6 }}>模型B·下根开盘成交</span>}</div>
      {pendingOrder && (
        <div className="pending-tip">待成交：{pendingOrder.side === 'buy' ? '买入' : '卖出'}委托已挂出，下一步开盘撮合</div>
      )}
      <div className="side-row">
        <button className={side === 'buy' ? 'success' : ''} onClick={() => setSide('buy')}>买入 (B)</button>
        <button className={side === 'sell' ? 'danger' : ''} onClick={() => setSide('sell')}>卖出 (S)</button>
      </div>
      <div className="qty-row">
        <input
          type="number" value={qty} step={lot} min={0}
          onChange={(e) => setQty(Math.floor(+e.target.value))}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <span>份</span>
        <span className="hint">须为 {lot} 整倍数</span>
      </div>
      <div className="quick-row">
        <button onClick={() => quickQty(0.25)}>1/4</button>
        <button onClick={() => quickQty(0.5)}>1/2</button>
        <button onClick={() => quickQty('max')}>{side === 'buy' ? '全仓' : '清仓'}</button>
      </div>
      <textarea
        placeholder="备注：为什么买 / 卖？（复盘核心素材，≤200字）"
        value={note} maxLength={200} rows={2}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="tags-row">
        {REASON_TAGS.map((t) => (
          <label key={t} className={`tag-check${tags.includes(t) ? ' on' : ''}`}>
            <input type="checkbox" checked={tags.includes(t)} onChange={() => toggleTag(t)} />
            {t}
          </label>
        ))}
      </div>
      <button className={`primary block ${side === 'sell' ? 'danger' : 'success'}`} onClick={() => submit()}>
        确认{side === 'buy' ? '买入' : '卖出'}
      </button>
      {msg && <div className={`order-msg ${msg.kind}`}>{msg.text}</div>}
    </div>
  )
}
