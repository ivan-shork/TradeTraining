/** IPC 通道注册：渲染进程所有调用入口 */
import type { IpcMain } from 'electron'
import { app, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import { getDb } from './db'
import { getSettings, saveSettings } from './settings'
import { runSync, isSyncing } from './sync'
import { testToken } from './tushare'
import {
  estimatePool, startSession, stepSession, placeOrder, finish,
  listSettlements, getSettlement, getReplayData, exportCsv,
  getSession, getState, getSessionTrades, deleteSessionData, currentCapital,
} from './engine'
import type { AppSettings, SessionConfig, OrderRequest } from '../shared/types'

export function registerAllIpc(ipcMain: IpcMain) {
  const handle = (ch: string, fn: (payload?: any) => any) => {
    ipcMain.handle(ch, async (_e, payload) => {
      try {
        return { ok: true, data: await fn(payload) }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    })
  }

  // ---------- 设置 ----------
  handle('settings:get', () => getSettings())
  handle('settings:save', (s: AppSettings) => {
    saveSettings(s)
    return true
  })
  handle('tushare:test', async (token: string) => {
    const ok = await testToken(token || getSettings().token)
    return ok
  })

  // ---------- 同步 ----------
  // 同步进度通过 event 推送，invoke 只返回最终结果
  ipcMain.handle('sync:run', async (event, mode: 'full' | 'incremental') => {
    const sender = event.sender
    try {
      await runSync(mode, (p) => {
        if (!sender.isDestroyed()) sender.send('sync:progress', p)
      }, (msg) => {
        if (!sender.isDestroyed()) sender.send('sync:log', msg)
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  handle('sync:status', () => isSyncing())

  // ---------- 标的池 ----------
  handle('pool:estimate', (config: SessionConfig) => estimatePool(config))

  /** 池内标的数量与本地数据概况（主页展示） */
  handle('pool:summary', () => {
    const db = getDb()
    const inst = db.prepare(`SELECT COUNT(*) AS c FROM instruments`).get() as { c: number }
    const kl = db.prepare(`SELECT COUNT(DISTINCT code) AS c, COUNT(*) AS rows FROM kline_cache`).get() as { c: number; rows: number }
    return { instruments: inst.c, codesWithData: kl.c, totalRows: kl.rows }
  })

  // ---------- 训练局 ----------
  handle('session:start', (config: SessionConfig) => startSession(config))
  handle('session:get', (id: number) => {
    const session = getSession(id)
    const state = getState(id)
    return {
      session,
      account: state ? {
        cash: state.cash, positionQty: state.position_qty, avgCost: state.avg_cost,
        realizedPnl: state.realized_pnl, revealedCount: state.revealed_count,
        pendingOrder: state.pending_order ? JSON.parse(state.pending_order) : null,
      } : null,
    }
  })
  handle('session:step', (id: number) => stepSession(id))
  handle('session:order', (req: OrderRequest) => placeOrder(req))
  handle('session:finish', (id: number) => finish(id))
  handle('session:trades', (id: number) => getSessionTrades(id))
  handle('session:equity', (id: number) => {
    const state = getState(id)
    return state ? JSON.parse(state.equity_curve) : []
  })

  // ---------- 画线 ----------
  handle('drawings:list', (sessionId: number) => {
    const db = getDb()
    return db.prepare(`SELECT * FROM drawings WHERE session_id = ?`).all(sessionId)
  })
  handle('drawings:save', (p: { sessionId: number; drawings: { toolType: string; pointsJson: string; styleJson: string; visible: boolean }[] }) => {
    const db = getDb()
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM drawings WHERE session_id = ?`).run(p.sessionId)
      const ins = db.prepare(`
        INSERT INTO drawings (session_id, tool_type, points_json, style_json, visible)
        VALUES (?, ?, ?, ?, ?)`)
      for (const d of p.drawings) {
        ins.run(p.sessionId, d.toolType, d.pointsJson, d.styleJson, d.visible ? 1 : 0)
      }
    })
    tx()
    return true
  })

  // ---------- 黑名单 / 自选池 ----------
  handle('instruments:list', () => {
    const db = getDb()
    return db.prepare(`
      SELECT i.*,
        (SELECT COUNT(*) FROM kline_cache k WHERE k.code = i.code) AS klineCount
      FROM instruments i ORDER BY i.code`).all()
  })
  handle('instruments:setFlag', (p: { code: string; field: 'blacklist' | 'watchlist'; value: boolean }) => {
    const db = getDb()
    const col = p.field === 'blacklist' ? 'in_blacklist' : 'in_watchlist'
    db.prepare(`UPDATE instruments SET ${col} = ? WHERE code = ?`).run(p.value ? 1 : 0, p.code)
    return true
  })

  // ---------- 复盘 ----------
  handle('replay:list', () => listSettlements())
  handle('replay:get', (id: number) => getSettlement(id))
  handle('replay:delete', (id: number) => {
    deleteSessionData(id)
    return true
  })
  handle('capital:current', () => currentCapital())
  handle('replay:data', (id: number) => getReplayData(id))
  handle('replay:stats', () => {
    const all = listSettlements()
    if (!all.length) return null
    const n = all.length
    const sum = (f: (s: typeof all[0]) => number) => all.reduce((a, s) => a + f(s), 0)
    return {
      sessions: n,
      totalPnl: sum((s) => s.pnlAmount),
      avgReturn: sum((s) => s.totalReturn) / n,
      avgWinRate: sum((s) => s.winRate) / n,
      avgHolding: sum((s) => s.avgHoldingDays) / n,
      maxSingleDrawdown: Math.min(...all.map((s) => s.maxDrawdown)),
      noteRate: sum((s) => s.noteCompleteRate) / n,
      tagDist: all.reduce<Record<string, number>>((acc, s) => {
        for (const [k, v] of Object.entries(s.tagDist)) acc[k] = (acc[k] ?? 0) + v
        return acc
      }, {}),
      sampleWarning: n < 20,
    }
  })

  // ---------- 导出 ----------
  handle('export:csv', async () => {
    const csv = exportCsv()
    const result = await dialog.showSaveDialog({
      title: '导出训练记录 CSV',
      defaultPath: path.join(app.getPath('documents'), `tradetraining-${Date.now()}.csv`),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (result.canceled || !result.filePath) return false
    fs.writeFileSync(result.filePath, csv, 'utf-8')
    return true
  })
}
