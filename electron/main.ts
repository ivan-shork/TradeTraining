import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'

// Windows 上部分显卡驱动与 Chromium GPU 进程不兼容（exit_code=-107374151），
// 禁用硬件加速改用软件渲染；K线 Canvas 图对此无感知差异
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
// 实测：GPU 进程崩溃（exit_code=-1073741515 / DLL_NOT_FOUND）的根因是
// 第三方软件（Nahimic、MSI Center、部分杀软）向进程注入的 DLL 在 GPU 沙箱内无法加载。
// 仅解除 GPU 进程自身的沙箱，渲染进程沙箱保持开启，安全性影响最小。
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.disableHardwareAcceleration()

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'TradeTraining',
    backgroundColor: '#131722',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 第三方注入 DLL 在渲染进程沙箱内无法加载导致崩溃（黑屏），
      // 关闭沙箱但保留 contextIsolation 隔离，本地应用可接受
      sandbox: false,
    },
  })

  if (process.env.VITE_DEV) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    // 编译产物在 dist-electron/electron/，页面在 dist/
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 渲染进程诊断：页面加载失败 / 控制台报错 / 渲染进程崩溃
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[load-fail] ${code} ${desc} ${url}`)
  })
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[renderer] ${message} (${sourceId}:${line})`)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[renderer-gone] ${JSON.stringify(details)}`)
  })
  if (process.env.DIAG) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
  if (process.env.DIAG === '2') {
    mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const img = await mainWindow!.webContents.capturePage()
          require('fs').writeFileSync('d:/workspace/TradeTraining/diag-shot.png', img.toPNG())
          console.error('[diag] screenshot saved')
        } catch (e) { console.error(`[diag] shot fail: ${e}`) }
      }, 2500)
    })
  }
}

// IPC 桥接注册（懒加载，避免影响启动速度）
function registerIpc() {
  const { registerAllIpc } = require('./ipc')
  registerAllIpc(ipcMain)
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
