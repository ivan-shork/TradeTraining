export {}

declare global {
  interface Window {
    tt: {
      invoke: (channel: string, payload?: unknown) => Promise<unknown>
      onSyncProgress?: (
        onProgress: (p: unknown) => void,
        onLog: (m: string) => void,
      ) => () => void
    }
  }
}
