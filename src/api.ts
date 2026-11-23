/** IPC 调用封装：统一走 preload 暴露的 window.tt.invoke */

export interface IpcResult<T> {
  ok: boolean
  data?: T
  error?: string
}

export async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const res = (await window.tt.invoke(channel, payload)) as IpcResult<T>
  if (!res.ok) throw new Error(res.error || '调用失败')
  return res.data as T
}

export interface SyncProgressMsg {
  phase: 'fund_basic' | 'kline' | 'done'
  current: number
  total: number
  code?: string
  message: string
}

export function onSyncProgress(cb: (p: SyncProgressMsg) => void, onLog: (m: string) => void) {
  // preload 已剥掉 event，这里只收单参数
  window.tt.onSyncProgress?.(cb as (p: unknown) => void, onLog)
}
