/**
 * Preload 桥接层：通过 contextBridge 向渲染进程暴露固定的 DesktopAPI。
 * 安全边界（docs/TECHNICAL.md §3）：
 * - 只暴露业务方法，不暴露 ipcRenderer 原始对象或任意通道，
 *   渲染进程无法绕过主进程的参数校验直接访问文件/shell/OSS；
 * - 本机工具：凭据明文随配置读写（仅存于本机文件）；
 * - pathForFile 用 webUtils 把拖入的 File 还原为本地绝对路径（沙箱下 renderer 拿不到真实路径）。
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopAPI, Progress, Project, PublishOutcome, Settings } from '@golive/core'

const api: DesktopAPI = {
  // 读取本机保存的状态（全局设置含明文凭据 + 最近项目列表）
  load: () => ipcRenderer.invoke('state:load'),

  // 打开系统对话框选择内容：kind = 'folder' 选目录 / 'html' 选单个 HTML 文件。
  // 取消时返回 null。
  select: kind => ipcRenderer.invoke('dialog:select', kind),

  // 让主进程识别选中的路径（源码项目 / 构建产物目录 / 单 HTML），
  // 返回带自动建议（应用名、构建命令、上传目录、域名）的 Project 配置。
  // 只读取元信息，不会执行项目里的任何代码。
  inspect: source => ipcRenderer.invoke('project:inspect', source),

  // 把拖拽进来的 File 对象还原成本地绝对路径。
  // 沙箱模式下渲染进程拿不到真实路径，必须借主进程的 webUtils 转换。
  pathForFile: file => webUtils.getPathForFile(file),

  // 保存当前项目配置到本机（按项目路径记忆，用于重启后恢复 / 最近项目列表）。
  // 保存前主进程会重新做 zod 校验。
  saveProject: (project: Project) => ipcRenderer.invoke('project:save', project),

  // 删除本机保存的项目记录（最近项目列表），不影响服务端应用
  removeProject: (id: string) => ipcRenderer.invoke('project:remove', id),

  // 保存全局连接设置（网关地址、OSS 凭据等，明文整体落盘）
  saveSettings: (settings: Settings) => ipcRenderer.invoke('settings:save', settings),

  // 发布链路总入口：主进程执行「查应用 → 跑脚本 → 上传 → 登记」全流程，
  // 过程中通过 onProgress 持续回推进度；最终返回三态结果：
  // published（成功，带访问地址）/ uncertain（结果待确认）/ cancelled（已取消）。
  // 失败时 promise 直接 reject，错误信息供界面展示。
  publish: (project: Project): Promise<PublishOutcome> => ipcRenderer.invoke('publish:start', project),

  // 取消进行中的发布任务（终止脚本进程、停止后续上传）。
  // 登记发布阶段不可取消，调用会被安全忽略。
  cancel: () => ipcRenderer.invoke('publish:cancel'),

  // 用系统默认浏览器打开网址；主进程校验必须是 HTTP(S)，防止任意协议调用。
  open: url => ipcRenderer.invoke('util:open', url),

  // 写入系统剪贴板（复制访问链接、诊断信息用）。
  copy: text => ipcRenderer.invoke('util:copy', text),

  // 打开持久化文件所在目录（Finder / 资源管理器）
  openDataDir: () => ipcRenderer.invoke('util:open-data-dir'),

  // 订阅发布进度事件（阶段切换 / 上传计数 / 脚本日志 / 失败信息）。
  // 返回解绑函数，组件卸载时调用以移除监听。
  onProgress: (callback: (progress: Progress) => void) => {
    const listener = (_event: unknown, progress: Progress) => callback(progress)
    ipcRenderer.on('publish:progress', listener)
    return () => ipcRenderer.removeListener('publish:progress', listener)
  },

  // macOS：接收主进程转发的 open-file（拖到 Dock 图标 / 访达“打开方式”）
  onOpenPath: (callback: (path: string) => void) => {
    const listener = (_event: unknown, path: string) => callback(path)
    ipcRenderer.on('project:open-path', listener)
    return () => ipcRenderer.removeListener('project:open-path', listener)
  },

  // 自动更新：订阅状态 / 下载进度 / 完成事件
  onUpdateStatus: (callback: (status: string, info?: { version: string; releaseDate: string }) => void) => {
    const listener = (_event: unknown, status: string, info: unknown) => callback(status, info as { version: string; releaseDate: string } | undefined)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },
  onUpdateProgress: (callback: (percent: number) => void) => {
    const listener = (_event: unknown, percent: number) => callback(percent)
    ipcRenderer.on('update:download-progress', listener)
    return () => ipcRenderer.removeListener('update:download-progress', listener)
  },
  onUpdateDownloaded: (callback: (version: string) => void) => {
    const listener = (_event: unknown, version: string) => callback(version)
    ipcRenderer.on('update:downloaded', listener)
    return () => ipcRenderer.removeListener('update:downloaded', listener)
  },
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install')
}

contextBridge.exposeInMainWorld('golive', api)
