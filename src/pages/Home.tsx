/** 主界面 = 卡片式入口面板（需求 4.1） */
import { useEffect, useState } from 'react'
import StartConfigModal from '../components/StartConfigModal'
import { call } from '../api'
import type { SessionConfig, NewSessionView } from '@shared/types'
import type { Route } from '../App'

interface Props {
  go: (r: Route) => void
}

export default function Home({ go }: Props) {
  const [showConfig, setShowConfig] = useState(false)
  const [summary, setSummary] = useState<{ instruments: number; codesWithData: number; totalRows: number } | null>(null)

  useEffect(() => {
    call<any>('pool:summary').then(setSummary).catch(() => setSummary(null))
  }, [showConfig])

  const startSession = async (config: SessionConfig) => {
    try {
      const r = await call<{ session: NewSessionView['session']; klines: NewSessionView['klines'] } | { error: string }>('session:start', config)
      if ('error' in r) {
        alert(r.error)
        return
      }
      go({ page: 'training', session: r.session, klines: r.klines, config })
    } catch (e) {
      alert((e as Error).message)
    }
  }

  return (
    <div className="home" style={{ position: 'relative' }}>
      <div className="home-top">
        <button onClick={() => go({ page: 'settings' })}>设置 ⚙</button>
      </div>
      <h1>TradeTraining</h1>
      <p className="subtitle">历史行情盲盒回放 · 手动模拟交易 · 刻意练习盘感</p>

      {summary && summary.codesWithData === 0 && (
        <div className="est-line" style={{ maxWidth: 420 }}>
          本地暂无行情数据。请先到 <b>设置 → 数据</b> 配置 Tushare Token 并同步数据。
        </div>
      )}

      <div className="panel-grid">
        <div className="panel-card" onClick={() => setShowConfig(true)}>
          <h3>ETF 训练</h3>
          <p>宽基 / 行业 / 跨境 / 商品<br />随机出题 · 逐步揭示</p>
          <button className="primary">开始训练</button>
        </div>
        <div className="panel-card" onClick={() => go({ page: 'replay' })}>
          <h3>复盘中心</h3>
          <p>记录 · 回放 · 统计<br />让训练可被量化反思</p>
          <button>进入复盘</button>
        </div>
        <div className="panel-card disabled">
          <h3>指数训练</h3>
          <p>敬请期待</p>
        </div>
        <div className="panel-card disabled">
          <h3>股票训练</h3>
          <p>敬请期待</p>
        </div>
      </div>

      {summary && summary.codesWithData > 0 && (
        <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
          本地数据：{summary.instruments} 只标的 · {summary.codesWithData} 只有日线 · 共 {summary.totalRows.toLocaleString()} 根 K 线
        </p>
      )}

      {showConfig && (
        <StartConfigModal
          onCancel={() => setShowConfig(false)}
          onStart={(cfg) => { setShowConfig(false); startSession(cfg) }}
        />
      )}
    </div>
  )
}
