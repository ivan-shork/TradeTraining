/** 本局概况（需求 5.6）：基本信息 → 收益结果 → 行为指标 + 资金曲线 + 操作 */
import { useEffect, useRef, useState } from 'react'
import EquitySpark from '../components/EquitySpark'
import { call } from '../api'
import type { Settlement } from '@shared/types'
import { fmtDisp } from '@shared/kline'
import type { Route } from '../App'

interface Props {
  sessionId: number
  backTo: 'training' | 'replay'
  go: (r: Route) => void
}

const pct = (v: number, digits = 2) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`
const money = (v: number) => `${v >= 0 ? '+' : '−'}¥${Math.abs(v).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`

export default function SettlementView({ sessionId, backTo, go }: Props) {
  const [s, setS] = useState<Settlement | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    call<Settlement>('replay:get', sessionId).then(setS).catch((e) => setErr((e as Error).message))
  }, [sessionId])

  if (err) return <div className="settlement"><div className="card">加载失败：{err}</div></div>
  if (!s) return <div className="settlement"><div className="card">加载中...</div></div>

  const catLabel: Record<string, string> = { broad: '宽基', industry: '行业/主题', crossborder: '跨境', commodity: '商品' }
  const usedMin = Math.max(1, Math.round((Date.now() - Date.parse(s.settledAt)) / 60000))

  const copySummary = async () => {
    const text = [
      `【TradeTraining 本局概况】`,
      `${s.name} ${s.code}（${catLabel[s.category]}）`,
      `区间 ${fmtDisp(s.startDate)} → ${fmtDisp(s.endDate)}（${s.tradeDays} 个交易日 / 前复权）`,
      `本局盈亏 ${money(s.pnlAmount)}，收益率 ${pct(s.totalReturn)}`,
      `区间涨跌幅 ${pct(s.periodChange)}，超额 ${pct(s.excessReturn)}（${s.excessPnl >= 0 ? '跑赢' : '跑输'} ¥${Math.abs(s.excessPnl).toFixed(0)}）`,
      `最大回撤 ${(s.maxDrawdown * 100).toFixed(1)}%，交易 ${s.buyCount} 买 / ${s.sellCount} 卖`,
      `胜率 ${(s.winRate * 100).toFixed(1)}%，盈亏比 ${s.profitLossRatio > 0 ? s.profitLossRatio : '—'}，平均持仓 ${s.avgHoldingDays} 日`,
    ].join('\n')
    await navigator.clipboard.writeText(text)
    alert('概况已复制到剪贴板')
  }

  return (
    <div className="settlement">
      <div className="card" ref={cardRef}>
        <h2>本局结束 · {s.name} {s.code} <span className="tag">{catLabel[s.category]}</span></h2>
        <div style={{ color: 'var(--text-dim)', marginTop: 6, fontSize: 13 }}>
          区间 {fmtDisp(s.startDate)} → {fmtDisp(s.endDate)}（{s.tradeDays} 个交易日 / {s.weeks} 周 · 前复权 · 揭示 {s.revealedSteps} 步 / 上下文 {s.contextBars} 根）
        </div>

        {/* 收益结果（5.6.2）：四个数并列，超额对比最显眼 */}
        <div className="stat-row">
          <div className="stat-cell">
            <div className="label">本局盈亏</div>
            <div className={`value ${s.pnlAmount >= 0 ? 'num-up' : 'num-down'}`}>{money(s.pnlAmount)}</div>
            <div className="sub">初始 ¥{s.initCash.toLocaleString()}</div>
          </div>
          <div className="stat-cell">
            <div className="label">本局收益率</div>
            <div className={`value ${s.totalReturn >= 0 ? 'num-up' : 'num-down'}`}>{pct(s.totalReturn)}</div>
            <div className="sub">期末 ¥{s.endAsset.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</div>
          </div>
          <div className="stat-cell">
            <div className="label">区间涨跌幅</div>
            <div className={`value ${s.periodChange >= 0 ? 'num-up' : 'num-down'}`}>{pct(s.periodChange)}</div>
            <div className="sub">这段行情本身的涨幅</div>
          </div>
          <div className="stat-cell">
            <div className="label">超额收益</div>
            <div className={`value ${s.excessReturn >= 0 ? 'num-up' : 'num-down'}`}>{pct(s.excessReturn, 1)}</div>
            <div className="sub">{s.excessPnl >= 0 ? '跑赢' : '跑输'}躺平 ¥{Math.abs(s.excessPnl).toFixed(0)}</div>
          </div>
        </div>

        {/* 行为指标（5.6.3） */}
        <div className="kv-grid">
          <div><span>最大回撤 </span><b className="num-down">{(s.maxDrawdown * 100).toFixed(1)}%</b></div>
          <div><span>交易次数 </span><b>{s.buyCount} 买 / {s.sellCount} 卖</b></div>
          <div><span>胜率 </span><b>{s.buyCount === 0 || s.sellCount === 0 ? '—' : `${(s.winRate * 100).toFixed(1)}%`}</b></div>
          <div><span>盈亏比 </span><b>{s.profitLossRatio > 0 ? s.profitLossRatio + ' 倍' : '—'}</b></div>
          <div><span>平均持仓 </span><b>{s.avgHoldingDays} 个交易日</b></div>
          <div><span>备注完整率 </span><b>{(s.noteCompleteRate * 100).toFixed(0)}%</b></div>
        </div>
        {Object.keys(s.tagDist).length > 0 && (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            <span style={{ color: 'var(--text-dim)' }}>标签分布：</span>
            {Object.entries(s.tagDist).map(([k, v]) => (
              <span key={k} className="tag" style={{ margin: '0 4px' }}>{k} ×{v}</span>
            ))}
          </div>
        )}

        <div className="section-title" style={{ marginTop: 16 }}>资金曲线</div>
        <div style={{ height: 140 }}>
          <EquitySpark data={s.equityCurve} initCash={s.initCash} height={140} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
          <span style={{ color: 'var(--up)' }}>──</span> 我的操作　<span style={{ color: 'var(--text-dim)' }}>-- --</span> 买入持有基准
        </div>

        <div className="btn-row">
          <button onClick={copySummary}>复制概况</button>
          <button onClick={() => go({ page: 'replay' })}>回放本局</button>
          <button className="primary" onClick={() => go({ page: 'home' })}>再来一局</button>
          <button onClick={() => go(backTo === 'replay' ? { page: 'replay' } : { page: 'home' })}>返回</button>
        </div>
      </div>
    </div>
  )
}
