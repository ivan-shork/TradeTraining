/** 开局前配置弹窗（需求 5.2.5）：常用项展开 + 高级折叠 + 池内估算 + 快速开局 */
import { useEffect, useState } from 'react'
import { call } from '../api'
import type { SessionConfig, PoolEstimate } from '@shared/types'

interface Props {
  onCancel: () => void
  onStart: (config: SessionConfig) => void
}

const STEP_OPTIONS: { value: number | 'unlimited'; label: string; dayHint: string; weekHint: string }[] = [
  { value: 60, label: '60 根', dayHint: '日K 约 3 个月 · 周K 约 14 个月', weekHint: '' },
  { value: 120, label: '120 根', dayHint: '日K 约半年 · 周K 约 2.3 年', weekHint: '' },
  { value: 250, label: '250 根', dayHint: '日K 约 1 年 · 周K 约 4.8 年', weekHint: '' },
  { value: 'unlimited', label: '不限', dayHint: '走到数据末尾', weekHint: '' },
]

export default function StartConfigModal({ onCancel, onStart }: Props) {
  const [cfg, setCfg] = useState<SessionConfig>({
    stepLimit: 120, pool: 'all', era: 'after2015', freq: 'D',
    contextBars: 120, sampleMode: 'random', rulePreset: 'default',
  })
  const [estimate, setEstimate] = useState<PoolEstimate | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)

  // 回填上次选择
  useEffect(() => {
    call<any>('settings:get').then((s) => {
      if (s.defaultConfig) setCfg({ ...cfg, ...s.defaultConfig })
      setRemember(s.rememberLastConfig ?? true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 池内估算（配置变化即刷新）
  useEffect(() => {
    call<PoolEstimate>('pool:estimate', cfg).then(setEstimate).catch(() => setEstimate(null))
  }, [cfg.pool, cfg.era, cfg.eraFrom, cfg.eraTo])

  const set = <K extends keyof SessionConfig>(k: K, v: SessionConfig[K]) =>
    setCfg((c) => ({ ...c, [k]: v }))

  const start = () => {
    setBusy(true)
    if (remember) {
      // 保存默认配置（读取-合并-写回），下次开局自动回填
      call<any>('settings:get').then((s) => {
        return call('settings:save', { ...s, defaultConfig: cfg, rememberLastConfig: remember })
      }).finally(() => {
        onStart(cfg)
      })
    } else {
      onStart(cfg)
    }
  }

  const curStep = STEP_OPTIONS.find((o) => o.value === cfg.stepLimit) ?? STEP_OPTIONS[1]

  return (
    <div className="modal-mask" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 14 }}>开局配置</h2>

        <div className="est-line">
          {estimate
            ? estimate.count > 0
              ? `当前池内可练标的约 ${estimate.count} 只${estimate.reasons.length ? `（${estimate.reasons.join('；')}）` : ''}`
              : `⚠ 当前池内可练标的 0 只${estimate.reasons.length ? `（${estimate.reasons.join('；')}）` : '——本地暂无行情数据，请先到「设置 → 数据」填写 Token 并全量同步'}`
            : '正在估算池内标的...'}
        </div>

        <div className="form-row">
          <label>本局长度</label>
          <select value={String(cfg.stepLimit)} onChange={(e) => set('stepLimit', e.target.value === 'unlimited' ? 'unlimited' : +e.target.value)}>
            {STEP_OPTIONS.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
          </select>
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{curStep.dayHint}</span>
        </div>

        <div className="form-row">
          <label>标的池</label>
          <select value={cfg.pool} onChange={(e) => set('pool', e.target.value as SessionConfig['pool'])}>
            <option value="all">全部</option>
            <option value="broad">仅宽基</option>
            <option value="industry">仅行业·主题</option>
            <option value="crossborder">仅跨境·商品</option>
            <option value="watchlist">自选池</option>
          </select>
        </div>

        <div className="form-row">
          <label>历史时间段</label>
          <select value={cfg.era} onChange={(e) => set('era', e.target.value as SessionConfig['era'])}>
            <option value="all">全部</option>
            <option value="y3">近 3 年</option>
            <option value="y5">近 5 年</option>
            <option value="after2015">2015 年后</option>
            <option value="custom">自定义</option>
          </select>
          {cfg.era === 'custom' && (
            <>
              <input style={{ width: 80 }} placeholder="起始年" value={cfg.eraFrom ?? ''}
                onChange={(e) => set('eraFrom', e.target.value)} />
              <span>→</span>
              <input style={{ width: 80 }} placeholder="截止年" value={cfg.eraTo ?? ''}
                onChange={(e) => set('eraTo', e.target.value)} />
            </>
          )}
        </div>

        <div className="form-row">
          <label>开局周期</label>
          <select value={cfg.freq} onChange={(e) => set('freq', e.target.value as 'D' | 'W')}>
            <option value="D">日 K</option>
            <option value="W">周 K</option>
          </select>
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>进入训练后仍可切换</span>
        </div>

        <div className="form-row">
          <label>上下文根数</label>
          <select value={cfg.contextBars} onChange={(e) => set('contextBars', +e.target.value)}>
            <option value={60}>60 根</option>
            <option value={120}>120 根</option>
            <option value={250}>250 根</option>
          </select>
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>起点前预先展示的背景 K 线</span>
        </div>

        <div className="form-row">
          <label>抽样方式</label>
          <select value={cfg.sampleMode} onChange={(e) => set('sampleMode', e.target.value as 'random' | 'balanced')}>
            <option value="random">纯随机</option>
            <option value="balanced">平衡抽样（涨/跌/震荡分层）</option>
          </select>
        </div>

        <span className="advanced-toggle" onClick={() => setAdvanced(!advanced)}>
          {advanced ? '▾' : '▸'} 高级选项
        </span>
        {advanced && (
          <div className="advanced">
            <div className="form-row">
              <label>随机种子</label>
              <input type="number" placeholder="留空随机；填上次 seed 可复现同一局"
                value={cfg.seed ?? ''} onChange={(e) => set('seed', e.target.value === '' ? undefined : +e.target.value)} />
            </div>
            <div className="form-row">
              <label>交易规则档位</label>
              <select value={cfg.rulePreset} onChange={(e) => set('rulePreset', e.target.value as SessionConfig['rulePreset'])}>
                <option value="default">默认</option>
                <option value="simple">极简（免佣、无滑点）</option>
                <option value="real">真实（含佣金、滑点、下根开盘撮合）</option>
              </select>
            </div>
          </div>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '12px 0', fontSize: 13, color: 'var(--text-dim)', cursor: 'pointer' }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          沿用上次选择（保存为全局默认，下次自动回填）
        </label>

        <div className="btn-row">
          <button onClick={onCancel}>取消</button>
          <button className="primary" disabled={busy || estimate?.count === 0} onClick={start}>
            {busy ? '出题中...' : '开始训练'}
          </button>
        </div>
      </div>
    </div>
  )
}
