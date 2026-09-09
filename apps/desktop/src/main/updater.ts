/**
 * 自动更新：检测 GitHub Release 中的新版本，提示用户前往下载。
 * 仅在打包后生效（isPackaged），开发模式跳过。
 */
import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { log } from './logger'
import type { ElectronLog } from 'electron-log'

// electron-updater v5 的类型定义与 Electron 37 不完全兼容，通过类型断言旁路，运行时 API 正常
const updater = autoUpdater as unknown as {
  logger: ElectronLog
  autoDownload: boolean
  on(event: string, listener: (...args: any[]) => void): void
  checkForUpdates(): Promise<unknown>
}

let updateWindow: BrowserWindow | null = null

function send(channel: string, ...args: unknown[]) {
  if (updateWindow?.isDestroyed() === false) {
    updateWindow.webContents.send(channel, ...args)
  }
}

export function initAutoUpdater(win: BrowserWindow) {
  updateWindow = win

  // 开发模式不检查更新（未打包的 Electron 没有 update 配置）
  if (!app.isPackaged) return

  updater.logger = log
  updater.autoDownload = false

  updater.on('update-available', (info: { version: string }) => {
    log.info(`发现新版本 v${info.version}，当前版本 v${app.getVersion()}`)
    send('update:status', 'available', { version: info.version })
  })

  updater.on('update-not-available', () => {
    log.info('当前已是最新版本')
  })

  updater.on('error', (error: Error) => {
    log.error('自动更新检查失败：', error.message)
  })

  // 启动后延迟 5 秒检查更新
  setTimeout(() => {
    updater.checkForUpdates().catch((error: Error) => {
      log.error('自动更新检查失败：', error.message)
    })
  }, 5000)
}