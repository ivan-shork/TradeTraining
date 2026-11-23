/** 训练界面：步进揭示 + 下单 + 账户 + 画线（需求 5.3 / 5.4 / 5.5 / 第 6 节布局） */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import KlineChart, { DRAW_TOOLS, type SavedOverlay, type KlineChartHandle } from '../components/KlineChart'
import OrderPanel from '../components/OrderPanel'
import EquitySpark from '../components/EquitySpark'
import { call } from '../api'
import type {
  Kline, Session, SessionConfig, Trade, AccountState, TradeRule, Settlement, Freq,
} from '@shared/types'
import { fmtDisp } from '@shared/kline'
import type { Route } from '../App'

interface Props {
  route: Extract<Route, { page: 'training' }>
  go: (r: Route) => void
}

interface SessionAccount extends AccountState {
  revealedCount: number
  pendingOrder: { side: 'buy' | 'sell'; qty: number } | null
}

interface EquityPoint {
  date: string
  asset: number
  benchmark: number
}

export default function Training({ route, go }: Props) {
  const { session } = route
  const [klines, setKlines] = useState<Kline[]>(route.klines)
  const [account, setAccount] = useState<SessionAccount>({
    cash: session.initCash, positionQty: 0, avgCost: 0, realizedPnl: 0,
    revealedCount: 1, pendingOrder: null,
  })
  const [trades, setTrades] = useState<Trade[]>([])
  const [freq, setFreq] = useState<Freq>(session.freqDefault)
  const [tool, setTool] = useState<string | null>(null)
  const [lookback, setLookback] = useState(0)          // ← 回看根数（仅展示）
  const [rule, setRule] = useState<TradeRule | null>(null)
  const [settings, setSettings] = useState<{ upColor: 'red' | 'green' } | null>(null)
  const [equity, setEquity] = useState<{ date: string; asset: number; benchmark: number }[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [blind, setBlind] = useState(true)   // 盲训：默认遮蔽标的与日期，防"看名字猜行情"
  const [maPeriods, setMaPeriods] = useState<number[]>([5, 20, 60, 120])
  const [showMacd, setShowMacd] = useState(false)
  const startedAt = useRef(Date.now())
  const lastStepAt = useRef(0)
  const klinesRef = useRef(route.klines)
  klinesRef.current = klines

  // 初始化：设置、账户、成交、资金曲线
  useEffect(() => {
    ;(async () => {
      const s = await call<any>('settings:get')
      setSettings({ upColor: s.upColor })
      setRule(s.rule)
      await refreshState()
    })()
  }, [])

  const refreshState = async () => {
    const r = await call<{ session: Session; account: SessionAccount }>('session:get', session.id)
    if (r.account) {
      setAccount(r.account)
      setFreq(r.session?.freqDefault ?? freq)
    }
    setTrades(await call<Trade[]>('session:trades', session.id))
    setEquity(await call<EquityPoint[]>('session:equity', session.id))
  }

  const showToast = (t: string) => {
    setToast(t)
    setTimeout(() => setToast(null), 1800)
  }

  // ---- 步进（空格 300ms 防抖，需求 5.3.1） ----
  const doStep = useCallback(async () => {
    const now = Date.now()
    if (now - lastStepAt.current < 300) return
    lastStepAt.current = now
    setLookback(0)
    const r = await call<{
      kline: Kline; revealedCount: number; finished: boolean
      filled?: Trade; settlement?: Settlement
    }>('session:step', session.id)
    if (r.kline && r.kline.tradeDate !== klinesRef.current[klinesRef.current.length - 1]?.tradeDate) {
      setKlines((prev) => [...prev, r.kline])
    }
    if (r.filled) showToast(`挂单成交：${r.filled.side === 'buy' ? '买入' : '卖出'} ${r.filled.qty} 份 @${r.filled.price}`)
    await refreshState()
    if (r.finished) {
      await call('drawings:save', {
        sessionId: session.id,
        drawings: overlayArchive.current,
      })
      go({ page: 'settlement', sessionId: session.id, backTo: 'training' })
    }
  }, [session.id])

  // ---- 下单 ----
  const doOrder = async (side: 'buy' | 'sell', qty: number, note: string, tags: string[]): Promise<string | null> => {
    if (lookback > 0) return '回看状态下不允许交易，请按空格回到最新'
    try {
      const r = await call<{ trade?: Trade; pending?: boolean }>('session:order', {
        sessionId: session.id, side, qty, note, tags,
      })
      if (r.pending) showToast('已挂单，下一步开盘价成交（模型 B）')
      await refreshState()
      return null
    } catch (e) {
      return (e as Error).message
    }
  }

  // ---- 画线存档 + 单条删除 ----
  const overlayArchive = useRef<SavedOverlay[]>([])
  const chartHandleRef = useRef<KlineChartHandle>(null)
  const [selectedOverlay, setSelectedOverlay] = useState<string | null>(null)
  const onOverlayComplete = (o: SavedOverlay) => {
    overlayArchive.current = [...overlayArchive.current, o]
    call('drawings:save', { sessionId: session.id, drawings: overlayArchive.current }).catch(() => {})
  }
  const deleteSelectedDrawing = useCallback(() => {
    const id = selectedOverlay
    if (!id) return
    chartHandleRef.current?.removeOverlayById(id)
    overlayArchive.current = overlayArchive.current.filter((o) => o.overlayId !== id)
    call('drawings:save', { sessionId: session.id, drawings: overlayArchive.current }).catch(() => {})
    setSelectedOverlay(null)
    showToast('已删除选中画线')
  }, [selectedOverlay, session.id])

  // ---- 键盘 ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'
      if (e.code === 'Space' && !typing) {
        e.preventDefault()
        doStep()
      } else if (e.key === 'Delete' && !typing) {
        deleteSelectedDrawing()
      } else if (e.key === 'ArrowLeft' && !typing) {
        setLookback((n) => Math.min(n + 1, klines.length - session.contextBars - 1))
      } else if (e.key === 'Escape') {
        setLookback(0)
        setTool(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doStep, deleteSelectedDrawing, klines.length, session.contextBars])

  const curIdx = klines.length - 1 - lookback
  const curKline = klines[curIdx] ?? null
  const displayKlines = useMemo(() => klines.slice(0, klines.length - lookback), [klines, lookback])
  const steps = account.revealedCount
  const stepLimit = session.stepLimit
  const lastPrice = klines[klines.length - 1]?.close ?? 0
  const marketValue = account.positionQty * lastPrice
  const totalAsset = account.cash + marketValue
  const pnlPct = ((totalAsset / session.initCash - 1) * 100).toFixed(1)
  const minutes = Math.round((Date.now() - startedAt.current) / 60000)

  const finishNow = async () => {
    try {
      await call('session:finish', session.id)
      go({ page: 'settlement', sessionId: session.id, backTo: 'training' })
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  return (
    <>
      <div className="top-bar">
        <button onClick={() => go({ page: 'home' })}>← 返回</button>
        <span className="title">{blind ? '████ 盲训中' : `${session.name} ${session.code}`}</span>
        <span className="meta">{blind ? '日期已隐藏' : `${fmtDisp(session.startDate)} 起`} · 第 {steps}/{stepLimit === 0 ? '∞' : stepLimit} 步 · 已用 {minutes} 分钟</span>
        <span style={{ flex: 1 }} />
        <button
          title={blind ? '显示标的与日期（训练不受影响，但会失去盲训意义）' : '恢复遮蔽'}
          onClick={() => {
            if (blind && !window.confirm('揭示标的名与日期？将失去盲练意义（本局成绩仍有效）')) return
            setBlind(!blind)
          }}
        >
          {blind ? '👁 揭示' : '🙈 遮蔽'}
        </button>
        <span className="tag">前复权</span>
        <select value={freq} onChange={(e) => { setFreq(e.target.value as Freq); showToast(`已切换 ${e.target.value === 'D' ? '日K' : '周K'}（账户状态不变）`) }}>
          <option value="D">日 K</option>
          <option value="W">周 K</option>
        </select>
      </div>

      <div className="training-layout">
        <div className="chart-area">
          <div className="draw-toolbar">
            {[5, 20, 60, 120].map((p) => (
              <button
                key={p}
                className={maPeriods.includes(p) ? 'on' : ''}
                onClick={() =>
                  setMaPeriods((prev) =>
                    prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p].sort((a, b) => a - b),
                  )
                }
              >
                MA{p}
              </button>
            ))}
            <button
              className={showMacd ? 'on' : ''}
              onClick={() => setShowMacd((v) => !v)}
              title="成交量下方增加 MACD 副图"
            >
              MACD
            </button>
            <span style={{ width: 10 }} />
            {DRAW_TOOLS.map((t) => (
              <button key={t.key} className={tool === t.key ? 'on' : ''}
                onClick={() => setTool(tool === t.key ? null : t.key)}>{t.label}</button>
            ))}
            <span style={{ flex: 1 }} />
            <button
              disabled={!selectedOverlay}
              title="先点击图上要删的画线使其选中，再点此按钮（或按 Delete 键）"
              onClick={deleteSelectedDrawing}
            >
              ✕ 删除选中{selectedOverlay ? '' : '（先点选画线）'}
            </button>
          </div>
          <KlineChart
            ref={chartHandleRef}
            onOverlaySelected={setSelectedOverlay}
            klines={displayKlines}
            freq={freq}
            contextBars={session.contextBars}
            trades={trades}
            activeTool={tool}
            onOverlayComplete={onOverlayComplete}
            onToolConsumed={() => setTool(null)}
            upColor={settings?.upColor ?? 'red'}
            blindMode={blind}
            maPeriods={maPeriods}
            showMacd={showMacd}
          />
          {lookback > 0 && (
            <div className="pending-tip" style={{ marginTop: 8 }}>
              回看模式：隐藏最近 {lookback} 根（仅回看，禁止交易），按空格继续
            </div>
          )}
        </div>

        <div className="side-panel">
          {rule && (
            <OrderPanel
              account={account}
              curKline={curKline}
              rule={rule}
              matchModel={session.matchModel}
              pendingOrder={account.pendingOrder}
              onOrder={doOrder}
            />
          )}
          <div className="section-title" style={{ marginTop: 14 }}>资金曲线（vs 买入持有）</div>
          <div className="equity-mini">
            <EquitySpark data={equity} initCash={session.initCash} />
          </div>
        </div>
      </div>

      <div className="bottom-bar">
        <button className="primary" onClick={doStep}>下一步（<span className="kbd">空格</span>）</button>
        <button onClick={() => setLookback((n) => Math.min(n + 1, klines.length - session.contextBars - 1))}>
          回退（<span className="kbd">←</span>）
        </button>
        <button onClick={() => setLookback(0)}>回到最新</button>
        <span style={{ flex: 1 }} />
        {toast && <span style={{ color: 'var(--accent)' }}>{toast}</span>}
        <span>本局盈亏 <b className={+pnlPct >= 0 ? 'num-up' : 'num-down'}>{+pnlPct >= 0 ? '+' : ''}{pnlPct}%</b></span>
        <button className="danger" onClick={finishNow}>结束本局</button>
      </div>
    </>
  )
}
