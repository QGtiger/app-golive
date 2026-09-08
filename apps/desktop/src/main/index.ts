import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { httpUrl, projectSchema, settingsSchema, type Progress } from '@golive/core'
import { inspectSource } from './files'
import { createGateway } from './gateway'
import { createPublishController } from './publish'
import { publicState, saveProject, saveSettings } from './store'
import { createOssUploader } from './upload'

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = process.env.VITE_PUBLIC || path.join(__dirname, process.env.ELECTRON_RENDERER_URL ? '../public' : '../dist')

let win: BrowserWindow | null = null
const publishController = createPublishController()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

function sendProgress(progress: Progress) {
  win?.webContents.send('publish:progress', progress)
}

async function publishServices() {
  const state = await publicState()
  return {
    gateway: createGateway(state.settings),
    uploader: createOssUploader(state.settings),
    secrets: [state.settings.accessKeySecret, state.settings.token]
  }
}

function registerIpc() {
  ipcMain.handle('state:load', () => publicState())
  ipcMain.handle('dialog:select', async (_event, kind: 'source' | 'folder' | 'html') => {
    const result = await dialog.showOpenDialog(win!, {
      properties: [kind === 'html' ? 'openFile' : 'openDirectory'],
      filters: kind === 'html' ? [{ name: 'HTML', extensions: ['html', 'htm'] }] : undefined
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('project:inspect', async (_event, source: string) => {
    if (typeof source !== 'string' || !source) throw new Error('路径无效')
    const state = await publicState()
    return inspectSource(source, state.settings.domainSuffix)
  })
  ipcMain.handle('project:save', (_event, project: unknown) => saveProject(projectSchema.parse(project)))
  ipcMain.handle('settings:save', (_event, settings: unknown, options?: { clearSecrets?: boolean }) =>
    saveSettings(settingsSchema.parse(settings), options)
  )
  ipcMain.handle('publish:start', async (_event, project: unknown) => {
    const services = await publishServices()
    try {
      const outcome = await publishController.publish(project, (await publicState()).settings, services, sendProgress)
      if (outcome.status === 'published') {
        try {
          await saveProject(projectSchema.parse(project))
        } catch (error) {
          sendProgress({ stage: 'done', message: '发布成功', log: `\n[提示] 保存本机项目配置失败：${(error as Error).message}\n` })
        }
      }
      return outcome
    } catch (error) {
      throw new Error((error as Error).message)
    }
  })
  ipcMain.handle('publish:cancel', () => publishController.cancel())
  ipcMain.handle('util:copy', (_event, text: string) => {
    if (typeof text !== 'string') throw new Error('内容无效')
    clipboard.writeText(text)
  })
  ipcMain.handle('util:open', async (_event, url: string) => {
    await shell.openExternal(httpUrl(url).href)
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 420,
    height: 680,
    minWidth: 380,
    minHeight: 560,
    title: 'GoLive',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false
    }
  })
  win.on('closed', () => {
    win = null
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      void shell.openExternal(httpUrl(url).href)
    } catch {
      // 忽略非 HTTP(S) 链接
    }
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.on('close', event => {
    if (!publishController.isBusy()) return
    event.preventDefault()
    void dialog
      .showMessageBox(win!, {
        type: 'warning',
        message: '发布正在进行',
        detail: '退出会取消当前的发布任务，已上传的临时版本文件可能保留在服务端。',
        buttons: ['取消发布并退出', '继续发布'],
        defaultId: 1,
        cancelId: 1
      })
      .then(({ response }) => {
        if (response === 0) {
          publishController.cancel()
          win?.destroy()
          win = null
        }
      })
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  publishController.cancel()
  app.quit()
})
