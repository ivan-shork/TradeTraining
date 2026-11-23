/** 全局设置：存 app_settings 表；Token 仅存本地库 */
import { getDb } from './db'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/types'

export function getSettings(): AppSettings {
  const db = getDb()
  const row = db.prepare(`SELECT value FROM app_settings WHERE key='settings'`).get() as
    | { value: string }
    | undefined
  if (!row) return { ...DEFAULT_SETTINGS }
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: AppSettings): void {
  const db = getDb()
  db.prepare(
    `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('settings', ?)`,
  ).run(JSON.stringify(s))
}

/** 数据导出/备份不含 token（需求第 8 节·安全） */
export function sanitizeForExport(s: AppSettings): AppSettings {
  return { ...s, token: '' }
}
