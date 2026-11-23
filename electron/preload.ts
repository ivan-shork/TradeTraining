import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

/**
 * 渲染进程可用的 API。
 * invoke：请求-响应式调用主进程
 * onSyncProgress：订阅数据同步进度/日志推送
 */
const api = {
  invoke: (channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload),
  onSyncProgress: (
    onProgress: (p: unknown) => void,
    onLog: (m: string) => void,
  ) => {
    const p1 = (_e: IpcRendererEvent, p: unknown) => onProgress(p)
    const p2 = (_e: IpcRendererEvent, m: string) => onLog(m)
    ipcRenderer.on('sync:progress', p1)
    ipcRenderer.on('sync:log', p2)
    return () => {
      ipcRenderer.removeListener('sync:progress', p1)
      ipcRenderer.removeListener('sync:log', p2)
    }
  },
}

contextBridge.exposeInMainWorld('tt', api)
