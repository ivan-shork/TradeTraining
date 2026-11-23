/** 设置页（需求 5.8）：数据 / 出题 / 交易 / 界面 / 数据管理 */
import { useEffect, useState } from 'react'
import { call, onSyncProgress, type SyncProgressMsg } from '../api'
import type { AppSettings } from '@shared/types'
import type { Route } from '../App'

interface Props {
  go: (r: Route) => void
}

export default function SettingsPage({ go }: Props) {
  const [s, setS] = useState<AppSettings | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState<SyncProgressMsg | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [syncResult, setSyncResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [blacklist, setBlacklist] = useState<{ code: string; name: string; in_blacklist: number; in_watchlist: number; klineCount: number; category: string }[]>([])
  const [blFilter, setBlFilter] = useState('')
  const [saving, setSaving] = useState(false)

  const refresh = async () => {
    const st = await call<AppSettings>('settings:get')
    setS(st)
    setTokenInput(st.token)
    setBlacklist(await call<any[]>('instruments:list'))
  }
  useEffect(() => { refresh() }, [])

  // 订阅同步进度
  useEffect(() => onSyncProgress?.((p) => setProgress(p as SyncProgressMsg), (m) => setLogs((l) => [...l.slice(-50), m])) ?? undefined, [])

  if (!s) return <div className="settings-page"><div className="card">加载中...</div></div>

  const save = async () => {
    setSaving(true)
    try {
      await call('settings:save', { ...s, token: tokenInput })
      setTestMsg(null)
      alert('设置已保存')
    } finally {
      setSaving(false)
    }
  }

  const testConn = async () => {
    setTestMsg('测试中...')
    try {
      const ok = await call<boolean>('tushare:test', tokenInput)
      setTestMsg(ok ? '✓ 连接成功' : '✗ 连接失败，请检查 Token')
      if (ok) await call('settings:save', { ...s, token: tokenInput })
    } catch (e) {
      setTestMsg(`✗ ${(e as Error).message}`)
    }
  }

  const runSync = async (mode: 'full' | 'incremental') => {
    if (!tokenInput.trim()) { alert('请先填写 Tushare Token'); return }
    setSyncing(true)
    setSyncResult(null)
    setLogs([])
    try {
      // 先保存 Token（失败会在 catch 中醒目提示，不再静默）
      await call('settings:save', { ...s, token: tokenInput.trim() })
      await call('sync:run', mode)
      setSyncResult({ ok: true, text: '同步完成' })
    } catch (e) {
      setSyncResult({ ok: false, text: `同步失败：${(e as Error).message}` })
      setLogs((l) => [...l, `✗ ${(e as Error).message}`])
    } finally {
      setSyncing(false)
    }
  }

  const setFlag = async (code: string, field: 'blacklist' | 'watchlist', value: boolean) => {
    await call('instruments:setFlag', { code, field, value })
    setBlacklist((list) => list.map((r) => r.code === code
      ? { ...r, [field === 'blacklist' ? 'in_blacklist' : 'in_watchlist']: value ? 1 : 0 }
      : r))
  }

  const filteredInst = blacklist.filter((r) =>
    !blFilter || r.code.includes(blFilter) || r.name.includes(blFilter))
    .slice(0, 100)
  const catLabel: Record<string, string> = { broad: '宽基', industry: '行业/主题', crossborder: '跨境', commodity: '商品' }

  const num = (v: string) => (v === '' ? undefined : +v)

  return (
    <div className="settings-page">
      <div className="top-bar" style={{ margin: '-24px', marginBottom: 16, paddingLeft: 24, paddingRight: 24 }}>
        <button onClick={() => go({ page: 'home' })}>← 主页</button>
        <span className="title">设置</span>
      </div>

      {/* 数据 */}
      <div className="card settings-section">
        <div className="section-title">数据 · Tushare</div>
        <div className="form-row">
          <label>Token</label>
          <input type="password" value={tokenInput} placeholder="tushare.pro 的接口 Token（仅存本地）"
            onChange={(e) => setTokenInput(e.target.value)} style={{ flex: 1 }} />
          <button onClick={testConn}>测试连接</button>
          {testMsg && <span style={{ fontSize: 12, color: testMsg.startsWith('✓') ? '#38b478' : 'var(--danger)' }}>{testMsg}</span>}
        </div>
        <div className="form-row">
          <label>数据同步</label>
          <button disabled={syncing} onClick={() => runSync('full')}>全量同步</button>
          <button disabled={syncing} onClick={() => runSync('incremental')}>增量更新</button>
          <label style={{ width: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={s.autoSyncOnStart} onChange={(e) => setS({ ...s, autoSyncOnStart: e.target.checked })} />
            开机自动增量
          </label>
        </div>
        {syncing && progress && (
          <div className="sync-progress">
            <div className="progress-bar">
              <div style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>{progress.message}</div>
          </div>
        )}
        {syncResult && (
          <div className={`order-msg ${syncResult.ok ? 'ok' : 'err'}`} style={{ marginTop: 10, fontSize: 13 }}>
            {syncResult.ok ? '✓ ' : ''}{syncResult.text}
            {!syncResult.ok && (
              <div style={{ marginTop: 4 }}>常见原因：Token 无效/积分不足（fund_daily 需 2000 积分）、网络不通。请检查下方日志。</div>
            )}
          </div>
        )}
        {logs.length > 0 && (
          <div className="sync-log">
            {logs.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
      </div>

      {/* 出题 */}
      <div className="card settings-section">
        <div className="section-title">出题 · 全局默认（开局弹窗可临时覆盖）</div>
        <div className="form-row">
          <label>默认步数上限</label>
          <select value={String(s.defaultConfig.stepLimit)}
            onChange={(e) => setS({ ...s, defaultConfig: { ...s.defaultConfig, stepLimit: e.target.value === 'unlimited' ? 'unlimited' : +e.target.value } })}>
            <option value="60">60 根</option>
            <option value="120">120 根</option>
            <option value="250">250 根</option>
            <option value="unlimited">不限</option>
          </select>
          <label style={{ width: 'auto' }}>上下文根数</label>
          <select value={s.defaultConfig.contextBars}
            onChange={(e) => setS({ ...s, defaultConfig: { ...s.defaultConfig, contextBars: +e.target.value } })}>
            <option value={60}>60</option><option value={120}>120</option><option value={250}>250</option>
          </select>
        </div>
        <div className="form-row">
          <label>品类开关</label>
          <label style={{ width: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={s.excludeCommodity} onChange={(e) => setS({ ...s, excludeCommodity: e.target.checked })} />
            剔除商品ETF（黄金/原油/有色等）
          </label>
          <label style={{ width: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={s.excludeCrossborder} onChange={(e) => setS({ ...s, excludeCrossborder: e.target.checked })} />
            剔除跨境ETF
          </label>
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>名称含"策略"、小众跨境（沙特/东南亚等）自动剔除</span>
        </div>
        <div className="form-row">
          <label>上市不足剔除</label>
          <select value={s.minListYears} onChange={(e) => setS({ ...s, minListYears: +e.target.value })}>
            <option value={0}>不剔除</option><option value={1}>1 年</option><option value={2}>2 年（默认）</option>
          </select>
          <label style={{ width: 'auto' }}>日均成交额下限</label>
          <select value={s.minAvgAmount} onChange={(e) => setS({ ...s, minAvgAmount: +e.target.value })}>
            <option value={0}>不限制</option><option value={500}>500 万</option><option value={1000}>1000 万（默认）</option>
          </select>
          <label style={{ width: 'auto' }}>最少历史根数</label>
          <input style={{ width: 70 }} type="number" value={s.minHistory}
            onChange={(e) => setS({ ...s, minHistory: +e.target.value || 0 })} />
        </div>
      </div>

      {/* 交易 */}
      <div className="card settings-section">
        <div className="section-title">交易规则</div>
        <div className="form-row">
          <label>起始本金</label>
          <input type="number" value={s.initCash} onChange={(e) => setS({ ...s, initCash: +e.target.value || 0 })} />
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>实际开局资金 = 起始本金 + 已结算局盈亏（本金滚动）</span>
          <label style={{ width: 'auto' }}>撮合模型</label>
          <select value={s.rule.matchModel} onChange={(e) => setS({ ...s, rule: { ...s.rule, matchModel: e.target.value as 'A' | 'B' } })}>
            <option value="A">A · 当前收盘价成交</option>
            <option value="B">B · 下一根开盘价成交</option>
          </select>
        </div>
        <div className="form-row">
          <label>手续费(万)</label>
          <input type="number" step="0.1" value={s.rule.feeRate * 10000}
            onChange={(e) => setS({ ...s, rule: { ...s.rule, feeRate: (+e.target.value || 0) / 10000 } })} />
          <label style={{ width: 'auto' }}>滑点(%)</label>
          <input type="number" step="0.1" value={s.rule.slippage * 100}
            onChange={(e) => setS({ ...s, rule: { ...s.rule, slippage: (+e.target.value || 0) / 100 } })} />
          <label style={{ width: 'auto' }}>交易单位</label>
          <input style={{ width: 70 }} type="number" value={s.rule.lotSize}
            onChange={(e) => setS({ ...s, rule: { ...s.rule, lotSize: +e.target.value || 100 } })} />
        </div>
        <div className="form-row">
          <label>开关</label>
          <label style={{ width: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={s.rule.t1} onChange={(e) => setS({ ...s, rule: { ...s.rule, t1: e.target.checked } })} /> T+1
          </label>
          <label style={{ width: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={s.rule.limitUpDown} onChange={(e) => setS({ ...s, rule: { ...s.rule, limitUpDown: e.target.checked } })} /> 涨跌停限制
          </label>
        </div>
      </div>

      {/* 界面 */}
      <div className="card settings-section">
        <div className="section-title">界面</div>
        <div className="form-row">
          <label>涨跌配色</label>
          <select value={s.upColor} onChange={(e) => setS({ ...s, upColor: e.target.value as 'red' | 'green' })}>
            <option value="red">红涨绿跌</option>
            <option value="green">绿涨红跌</option>
          </select>
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>快捷键：空格步进 · B 买 · S 卖 · ← 回看 · Esc 暂停</span>
        </div>
      </div>

      {/* 黑名单 / 自选池 */}
      <div className="card settings-section">
        <div className="section-title">黑名单 / 自选池管理</div>
        <div className="form-row">
          <label>搜索</label>
          <input value={blFilter} placeholder="代码或名称" onChange={(e) => setBlFilter(e.target.value)} />
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>显示前 {filteredInst.length} 条（黑名单 = 不出题；自选池 = "仅自选池"模式候选）</span>
        </div>
        <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          <table className="records">
            <thead><tr><th>代码</th><th>名称</th><th>类型</th><th>K线数</th><th>黑名单</th><th>自选池</th></tr></thead>
            <tbody>
              {filteredInst.map((r) => (
                <tr key={r.code}>
                  <td>{r.code}</td><td>{r.name}</td>
                  <td><span className="tag">{catLabel[r.category] ?? r.category}</span></td>
                  <td>{r.klineCount ?? 0}</td>
                  <td><input type="checkbox" checked={!!r.in_blacklist} onChange={(e) => setFlag(r.code, 'blacklist', e.target.checked)} /></td>
                  <td><input type="checkbox" checked={!!r.in_watchlist} onChange={(e) => setFlag(r.code, 'watchlist', e.target.checked)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 数据管理 */}
      <div className="card settings-section">
        <div className="section-title">数据管理</div>
        <div className="form-row">
          <label>导出</label>
          <button onClick={() => call('export:csv').then((ok) => ok && alert('导出成功')).catch((e) => alert(e.message))}>
            导出训练记录 CSV
          </button>
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>导出与备份均不包含 Token</span>
        </div>
      </div>

      <button className="primary" style={{ padding: '10px 40px' }} disabled={saving} onClick={save}>
        {saving ? '保存中...' : '保存设置'}
      </button>
    </div>
  )
}
