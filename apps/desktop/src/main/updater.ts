/**
 * 自动更新：检测 GitHub Release 中的新版本，下载并提示安装。
 * 仅在打包后生效（isPackaged），开发模式跳过。
 *
 * 交互流程：
 * 1. 启动时静默检查 → 有更新则通知渲染进程
 * 2. 用户点击下载 → 显示进度条
 * 3. 下载完成 → 提示"安装并重启"
 * 4. 确认安装 → 退出应用，updater 安装新版本后自动重启
 */
import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

// electron-updater v5 的类型定义与 Electron 37 不完全兼容，通过类型断言旁路，运行时 API 正常
const updater = autoUpdater as unknown as {
  logger: typeof console
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: string, listener: (...args: any[]) => void): void
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<void>
  quitAndInstall(): void
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

  updater.logger = console
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = true

  updater.on('checking-for-update', () => {
    console.log('[updater] 正在检查更新…')
  })

  updater.on('update-available', (info: { version: string; releaseDate: string }) => {
    console.log(`[updater] 发现新版本 v${info.version}`)
    send('update:status', 'available', { version: info.version, releaseDate: info.releaseDate })
  })

  updater.on('update-not-available', () => {
    send('update:status', 'not-available')
  })

  updater.on('download-progress', (progress: { percent: number }) => {
    send('update:download-progress', Math.round(progress.percent))
  })

  updater.on('update-downloaded', (info: { version: string }) => {
    send('update:downloaded', info.version)
  })

  updater.on('error', (error: Error) => {
    console.error('[updater] 更新检查失败：', error.message)
    send('update:status', 'error')
  })

  // 启动后延迟 5 秒检查更新
  setTimeout(() => {
    updater.checkForUpdates().catch((error: Error) => {
      console.error('[updater] 更新检查失败：', error.message)
    })
  }, 5000)
}

/** 用户确认下载更新 */
export function downloadUpdate() {
  updater.downloadUpdate().catch((error: Error) => {
    console.error('[updater] 下载更新失败：', error.message)
  })
}

/** 用户确认安装：退出并安装 */
export function installUpdate() {
  updater.quitAndInstall()
}