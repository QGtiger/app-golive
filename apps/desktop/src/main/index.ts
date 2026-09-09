/**
 * 主进程入口：窗口生命周期 + IPC 注册。
 *
 * 进程边界（docs/TECHNICAL.md §3）：
 * - Renderer 只通过 preload 暴露的固定方法与这里通信；
 * - 所有 IPC 入参在这里二次校验，不信任渲染进程；
 * - 凭据明文存放于本机 golive.json，仅用于设置页回显；发布日志输出前脱敏。
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { httpUrl, projectSchema, settingsSchema, type Progress } from '@golive/core'
import { inspectSource } from './files'
import { createGateway } from './gateway'
import { createPublishController } from './publish'
import { initAutoUpdater, downloadUpdate, installUpdate } from './updater'
import { publicState, removeProject, saveProject, saveSettings } from './store'
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

// 开发模式下 dock/任务栏显示默认 Electron 图标；打包后由 bundle 内的 icns 提供，无需设置
if (!app.isPackaged && process.platform === 'darwin' && app.dock) {
  app.dock.setIcon(path.join(__dirname, '../../build/icon.png'))
}

// 开发模式统一应用名与 userData 目录（与打包一致为 GoLive），避免 dev/prod 数据分离；
// 旧开发目录（@golive/desktop）的数据一次性迁移过来
if (!app.isPackaged) {
  app.setName('GoLive')
  app.setPath('userData', path.join(app.getPath('appData'), 'GoLive'))
  const legacyFile = path.join(app.getPath('appData'), '@golive', 'desktop', 'golive.json')
  const targetFile = path.join(app.getPath('userData'), 'golive.json')
  if (!existsSync(targetFile) && existsSync(legacyFile)) {
    mkdirSync(app.getPath('userData'), { recursive: true })
    copyFileSync(legacyFile, targetFile)
  }
}

// macOS 菜单栏：显示应用名 + 标准编辑/窗口角色；dev 额外提供刷新与调试入口
function buildAppMenu() {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' },
    { role: 'windowMenu' },
    ...(!app.isPackaged ? [{ role: 'viewMenu' as const }] : [])
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// macOS：从 Dock 图标或访达“打开方式”打开项目文件/目录；窗口未就绪时先暂存
let pendingOpenPath: string | null = null
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (win && !win.webContents.isLoading()) {
    win.webContents.send('project:open-path', filePath)
  } else {
    pendingOpenPath = filePath
  }
})

function sendProgress(progress: Progress) {
  win?.webContents.send('publish:progress', progress)
}

// 每次发布前现读磁盘设置并构建客户端，保证设置修改后立即生效；
// secrets 用于构建日志脱敏（见 scripts.ts 的 redact），避免凭据泄漏到输出。
async function publishServices() {
  const state = await publicState()
  return {
    gateway: createGateway(state.settings),
    uploader: createOssUploader(state.settings),
    secrets: [state.settings.accessKeySecret]
  }
}

function registerIpc() {
  // 读取本机状态：全局设置（含明文凭据）+ 最近项目列表
  ipcMain.handle('state:load', () => publicState())
  // 系统对话框选择：kind 决定选目录还是 HTML 文件
  ipcMain.handle('dialog:select', async (_event, kind: 'source' | 'folder' | 'html') => {
    const result = await dialog.showOpenDialog(win!, {
      properties: [kind === 'html' ? 'openFile' : 'openDirectory'],
      filters: kind === 'html' ? [{ name: 'HTML', extensions: ['html', 'htm'] }] : undefined
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  // 识别拖入/选中的路径并生成配置建议（只读文件元信息，不执行任何项目代码）
  ipcMain.handle('project:inspect', async (_event, source: string) => {
    if (typeof source !== 'string' || !source) throw new Error('路径无效')
    const state = await publicState()
    return inspectSource(source, state.settings.domainSuffix)
  })
  // 保存前用 zod 重新校验；返回落盘记录（含 id）供渲染进程跳转 /detail/:id
  ipcMain.handle('project:save', (_event, project: unknown) => saveProject(project))
  // 参数为项目记录的 id；仅删除本机记录，不涉及服务端
  ipcMain.handle('project:remove', (_event, id: string) => {
    if (typeof id !== 'string' || !id) throw new Error('参数无效')
    return removeProject(id)
  })
  // 保存前用 zod 重新校验；凭据明文随配置一起落盘
  ipcMain.handle('settings:save', (_event, settings: unknown) => saveSettings(settingsSchema.parse(settings)))
  // 发布链路总入口：调用发布协调器；成功后顺手保存项目配置，
  // 保存失败只提示、不掩盖“远程已发布成功”的结果
  ipcMain.handle('publish:start', async (_event, project: unknown) => {
    const services = await publishServices()
    try {
      const outcome = await publishController.publish(project, (await publicState()).settings, services, sendProgress)
      if (outcome.status === 'published') {
        try {
          const parsed = projectSchema.parse(project)
          await saveProject({ ...parsed, url: outcome.url })
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
  // 打开持久化文件所在目录（Finder / 资源管理器）
  ipcMain.handle('util:open-data-dir', () => shell.openPath(app.getPath('userData')))
  // 自动更新：用户确认下载或安装
  ipcMain.handle('update:download', () => downloadUpdate())
  ipcMain.handle('update:install', () => installUpdate())
}

function createWindow() {
  win = new BrowserWindow({
    width: 420,
    height: 680,
    minWidth: 380,
    minHeight: 560,
    title: 'GoLive',
    backgroundColor: '#f5f6f8',
    // 安全基线：contextIsolation + sandbox 开启、nodeIntegration 关闭、禁用 webview
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
  // 拦截 window.open / 新窗口：仅允许 HTTP(S) 链接交给系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      void shell.openExternal(httpUrl(url).href)
    } catch {
      // 忽略非 HTTP(S) 链接
    }
    return { action: 'deny' }
  })
  // 阻止窗口内任意导航：界面只加载本地页面或开发服务器
  win.webContents.on('will-navigate', event => event.preventDefault())
  // 发布进行中时先询问：确认后取消任务再退出，避免遗留构建子进程
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
  // 窗口就绪后补发启动阶段收到的 open-file（macOS 双击/拖 Dock 启动）
  win.webContents.on('did-finish-load', () => {
    if (pendingOpenPath) {
      win?.webContents.send('project:open-path', pendingOpenPath)
      pendingOpenPath = null
    }
  })
}

app.whenReady().then(() => {
  buildAppMenu()
  app.setAboutPanelOptions({
    applicationName: 'GoLive',
    applicationVersion: app.getVersion(),
    copyright: '© Lightfish'
  })
  registerIpc()
  createWindow()
  initAutoUpdater(win!)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // 退出前终止进行中的发布任务，不留孤儿脚本进程
  publishController.cancel()
  // macOS 惯例：窗口全部关闭后应用驻留 Dock，通过 activate 再开窗
  if (process.platform !== 'darwin') app.quit()
})
