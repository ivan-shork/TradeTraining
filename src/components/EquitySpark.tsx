/** 资金曲线 mini 图：我的操作 vs 买入持有基准（SVG，无依赖） */
interface Props {
  data: { date: string; asset: number; benchmark: number }[]
  initCash: number
  height?: number
}

export default function EquitySpark({ data, initCash, height = 90 }: Props) {
  if (data.length < 2) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', height }}>走出第一步后显示资金曲线</div>
  }
  const W = 280, H = height, pad = 4
  const vals = data.flatMap((d) => [d.asset, d.benchmark])
  const min = Math.min(...vals, initCash)
  const max = Math.max(...vals, initCash)
  const x = (i: number) => pad + (i / (data.length - 1)) * (W - pad * 2)
  const y = (v: number) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2)
  const path = (key: 'asset' | 'benchmark') =>
    data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ')
  const last = data[data.length - 1]
  const up = last.asset >= initCash

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sparkline" preserveAspectRatio="none">
      <line x1={pad} y1={y(initCash)} x2={W - pad} y2={y(initCash)} stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" />
      <path d={path('benchmark')} fill="none" stroke="var(--text-dim)" strokeWidth="1" strokeDasharray="4 3" />
      <path d={path('asset')} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth="1.6" />
    </svg>
  )
}
