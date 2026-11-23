/** 复盘中心（需求 5.7 一期轻量版）：记录列表 + 基础统计 + 单局回放 */
import { useEffect, useMemo, useRef, useState } from 'react'
import KlineChart, { type SavedOverlay } from '../components/KlineChart'
import { call } from '../api'
import type { Kline, Session, Settlement, Trade } from '@shared/types'
import { fmtDisp } from '@shared/kline'
import type { Route } from '../App'

interface Props {
  go: (r: Route) => void
}

interface Stats {
  sessions: number
  totalPnl: number
  avgReturn: number
  avgWinRate: number
  avgHolding: number
  maxSingleDrawdown: number
  noteRate: number
  tagDist: Record<string, number>
  sampleWarning: boolean
}

export default function ReplayCenter({ go }: Props) {
  const [list, setList] = useState<Settlement[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [capital, setCapital] = useState<number | null>(null)
  const [filterCat, setFilterCat] = useState('all')
  const [filterPnl, setFilterPnl] = useState('all')
  const [filterNote, setFilterNote] = useState('all')
  const [replayId, setReplayId] = useState<number | null>(null)

  const refresh = async () => {
    setList(await call<Settlement[]>('replay:list'))
    setStats(await call<Stats | null>('replay:stats'))
    setCapital(await call<number>('capital:current'))
  }
  useEffect(() => { refresh() }, [])

  const del = async (id: number, name: string) => {
    if (!window.confirm(`删除这局记录（${name}）？删除后本金将回退该局盈亏。`)) return
    await call('replay:delete', id)
    refresh()
  }

  const filtered = useMemo(() => list.filter((s) => {
    if (filterCat !== 'all' && s.category !== filterCat) return false
    if (filterPnl === 'win' && s.pnlAmount <= 0) return false
    if (filterPnl === 'loss' && s.pnlAmount > 0) return false
    if (filterNote === 'yes' && s.noteCompleteRate === 0) return false
    if (filterNote === 'no' && s.noteCompleteRate > 0) return false
    return true
  }), [list, filterCat, filterPnl, filterNote])

  if (replayId !== null) {
    return <ReplayPlayer sessionId={replayId} onExit={() => { setReplayId(null); refresh() }} go={go} />
  }

  const catLabel: Record<string, string> = { broad: '宽基', industry: '行业/主题', crossborder: '跨境', commodity: '商品' }
  const pct = (v: number, d = 1) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`

  return (
    <div className="replay">
      <div className="top-bar" style={{ margin: -24, marginBottom: 16, paddingLeft: 24, paddingRight: 24 }}>
        <button onClick={() => go({ page: 'home' })}>← 主页</button>
        <span className="title">复盘中心</span>
        <span style={{ flex: 1 }} />
        <button onClick={() => call('export:csv').then((ok) => ok && alert('导出成功')).catch((e) => alert(e.message))}>
          导出 CSV
        </button>
      </div>

      {/* 基础统计看板 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title">基础统计</div>
        {stats ? (
          <>
            <div className="stats-grid">
              <div className="stat-cell"><div className="label">当前总本金</div>
                <div className={`value ${stats.totalPnl >= 0 ? 'num-up' : 'num-down'}`}>
                  ¥{(capital ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
                </div>
                <div className="sub">起始本金 + 累计盈亏</div></div>
              <div className="stat-cell"><div className="label">训练局数</div><div className="value">{stats.sessions}</div></div>
              <div className="stat-cell"><div className="label">累计盈亏</div>
                <div className={`value ${stats.totalPnl >= 0 ? 'num-up' : 'num-down'}`}>
                  {stats.totalPnl >= 0 ? '+' : '−'}¥{Math.abs(stats.totalPnl).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
                </div></div>
              <div className="stat-cell"><div className="label">平均收益率</div><div className="value">{pct(stats.avgReturn)}</div></div>
              <div className="stat-cell"><div className="label">平均胜率</div><div className="value">{(stats.avgWinRate * 100).toFixed(1)}%</div></div>
              <div className="stat-cell"><div className="label">平均持仓</div><div className="value">{stats.avgHolding.toFixed(1)} 日</div></div>
              <div className="stat-cell"><div className="label">最大单局回撤</div>
                <div className="value num-down">{(stats.maxSingleDrawdown * 100).toFixed(1)}%</div></div>
              <div className="stat-cell"><div className="label">备注完整率</div><div className="value">{(stats.noteRate * 100).toFixed(0)}%</div></div>
              <div className="stat-cell"><div className="label">高频标签</div>
                <div className="value" style={{ fontSize: 14 }}>
                  {Object.entries(stats.tagDist).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => k).join(' / ') || '—'}
                </div></div>
            </div>
            {stats.sampleWarning && (
              <div className="sample-warn">样本量不足 20 局，统计仅供参考；50 局以上才适合做风格归因。</div>
            )}
          </>
        ) : <div style={{ color: 'var(--text-dim)' }}>暂无训练记录，先去开一局吧。</div>}
      </div>

      {/* 记录列表 */}
      <div className="card">
        <div className="section-title">训练记录</div>
        <div className="filter-row">
          <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
            <option value="all">全部类型</option>
            <option value="broad">宽基</option>
            <option value="industry">行业/主题</option>
            <option value="crossborder">跨境</option>
            <option value="commodity">商品</option>
          </select>
          <select value={filterPnl} onChange={(e) => setFilterPnl(e.target.value)}>
            <option value="all">盈亏不限</option>
            <option value="win">仅盈利</option>
            <option value="loss">仅亏损</option>
          </select>
          <select value={filterNote} onChange={(e) => setFilterNote(e.target.value)}>
            <option value="all">备注不限</option>
            <option value="yes">写了备注</option>
            <option value="no">没写备注</option>
          </select>
        </div>
        <table className="records">
          <thead>
            <tr>
              <th>结算时间</th><th>标的</th><th>类型</th><th>区间</th><th>交易日</th>
              <th>收益率</th><th>区间涨幅</th><th>超额</th><th>交易</th><th>备注率</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.sessionId}>
                <td>{s.settledAt.slice(0, 10)}</td>
                <td>{s.name}<br /><span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{s.code}</span></td>
                <td><span className="tag">{catLabel[s.category]}</span></td>
                <td>{fmtDisp(s.startDate)}<br />{fmtDisp(s.endDate)}</td>
                <td>{s.tradeDays}</td>
                <td className={s.pnlAmount >= 0 ? 'num-up' : 'num-down'}>{pct(s.totalReturn)}</td>
                <td className={s.periodChange >= 0 ? 'num-up' : 'num-down'}>{pct(s.periodChange)}</td>
                <td className={s.excessReturn >= 0 ? 'num-up' : 'num-down'}>{pct(s.excessReturn)}</td>
                <td>{s.buyCount}买/{s.sellCount}卖</td>
                <td>{(s.noteCompleteRate * 100).toFixed(0)}%</td>
                <td>
                  <button onClick={() => setReplayId(s.sessionId)}>回放</button>{' '}
                  <button className="del-btn" onClick={() => del(s.sessionId, s.name)} title="删除本条记录">✕</button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={11} style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 20 }}>暂无记录</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** 单局回放：从上下文开始，自动/手动步进，买卖点与画线还原（需求 5.7.2） */
function ReplayPlayer({ sessionId, onExit, go }: { sessionId: number; onExit: () => void; go: (r: Route) => void }) {
  const [data, setData] = useState<{
    session: Session; klines: Kline[]; trades: Trade[]
    drawings: { toolType: string; pointsJson: string; styleJson: string; visible: boolean }[]
    equityCurve: { date: string; asset: number; benchmark: number }[]
  } | null>(null)
  const [pos, setPos] = useState(0)          // 当前展示到的索引（含上下文）
  const [freq, setFreq] = useState<'D' | 'W'>('D')
  const [auto, setAuto] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    call<any>('replay:data', sessionId).then((d) => {
      setData(d)
      setFreq(d.session.freqDefault)
      setPos(d.session.contextBars + 1)
    })
  }, [sessionId])

  // 自动播放
  useEffect(() => {
    if (!auto || !data) return
    timerRef.current = setInterval(() => {
      setPos((p) => {
        if (p >= data.klines.length) { setAuto(false); return p }
        return p + 1
      })
    }, 200)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [auto, data])

  if (!data) return <div className="replay"><div className="card">加载回放数据...</div></div>
  const s = data.session
  const shown = data.klines.slice(0, pos)
  // 只显示当前展示进度之前已发生的成交
  const shownTrades = data.trades.filter((t) => t.tradeDate <= shown[shown.length - 1]?.tradeDate)

  const jumpToTrade = (dir: 1 | -1) => {
    const dates = data.trades.map((t) => t.tradeDate)
    const cur = shown[shown.length - 1]?.tradeDate
    if (dir === 1) {
      const next = dates.find((d) => d > cur)
      if (next) {
        const idx = data.klines.findIndex((k) => k.tradeDate >= next)
        if (idx >= 0) setPos(idx + 1)
      }
    } else {
      const prev = [...dates].reverse().find((d) => d < cur)
      if (prev) {
        const idx = data.klines.findIndex((k) => k.tradeDate >= prev)
        if (idx >= 0) setPos(idx + 1)
      }
    }
  }

  return (
    <div className="replay">
      <div className="top-bar" style={{ margin: -24, marginBottom: 12, paddingLeft: 24, paddingRight: 24 }}>
        <button onClick={onExit}>← 返回列表</button>
        <span className="title">{s.name} {s.code} · 回放</span>
        <span className="meta">{fmtDisp(s.startDate)} 起 · {pos - s.contextBars}/{data.klines.length - s.contextBars} 步</span>
        <span style={{ flex: 1 }} />
        <span className="tag">前复权</span>
        <select value={freq} onChange={(e) => setFreq(e.target.value as 'D' | 'W')}>
          <option value="D">日 K</option>
          <option value="W">周 K</option>
        </select>
      </div>
      <div style={{ height: 'calc(100% - 110px)', display: 'flex', flexDirection: 'column' }}>
        <KlineChart
          klines={shown}
          freq={freq}
          contextBars={s.contextBars}
          trades={shownTrades}
          activeTool={null}
          overlays={data.drawings as SavedOverlay[]}
        />
      </div>
      <div className="bottom-bar" style={{ marginLeft: -24, marginRight: -24 }}>
        <button className="primary" onClick={() => setPos((p) => Math.min(p + 1, data.klines.length))}>
          下一步（<span className="kbd">空格</span>）
        </button>
        <button onClick={() => setPos((p) => Math.max(p - 1, s.contextBars + 1))}>回退</button>
        <button onClick={() => setAuto(!auto)}>{auto ? '⏸ 暂停' : '▶ 自动播放'}</button>
        <button onClick={() => jumpToTrade(-1)}>← 上一买卖点</button>
        <button onClick={() => jumpToTrade(1)}>下一买卖点 →</button>
        <span style={{ flex: 1 }} />
        <button onClick={() => go({ page: 'settlement', sessionId, backTo: 'replay' })}>查看概况</button>
        <button onClick={() => setPos(data.klines.length)}>跳到结尾</button>
      </div>
      {/* 回放也支持空格 */}
      <ReplayKeys onStep={() => setPos((p) => Math.min(p + 1, data.klines.length))} />
      {/* 买卖点备注列表 */}
      <div style={{ padding: '8px 24px', fontSize: 12, color: 'var(--text-dim)', overflowY: 'auto', maxHeight: 120 }}>
        {shownTrades.slice(-6).map((t) => (
          <span key={t.id} style={{ marginRight: 16 }}>
            {fmtDisp(t.tradeDate)} <b style={{ color: t.side === 'buy' ? 'var(--up)' : 'var(--down)' }}>{t.side === 'buy' ? '买' : '卖'}</b> {t.qty}份@{t.price}
            {t.note && `「${t.note}」`}
          </span>
        ))}
      </div>
    </div>
  )
}

function ReplayKeys({ onStep }: { onStep: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); onStep() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStep])
  return null
}
