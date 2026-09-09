import { z } from 'zod'

export const projectSchema = z.object({
  // 客户端生成的稳定 ID（/detail/:id 路由与最近项目的键）；由 store 落盘时兜底生成
  id: z.string().min(1).optional(),
  source: z.string().min(1),
  appId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, '应用名称只能包含小写字母、数字和连字符'),
  script: z.string().max(20000),
  cwd: z.string().min(1),
  upload: z.string().min(1),
  entry: z.string().min(1),
  domain: z.string().regex(/^([a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+(?::\d+)?$/, '请输入域名，不包含 https:// 或路径'),
  note: z.string().default(''),
  /** 上次发布成功后的访问地址 */
  url: z.string().optional()
})
export type Project = z.infer<typeof projectSchema>

export const settingsSchema = z.object({
  apiUrl: z.string().url(),
  region: z.string().min(1),
  bucket: z.string().min(1),
  accessKeyId: z.string(),
  accessKeySecret: z.string(),
  publicBaseUrl: z.string().url(),
  domainSuffix: z.string().min(1),
  protocol: z.enum(['https', 'http'])
})
export type Settings = z.infer<typeof settingsSchema>

export const defaultSettings: Settings = {
  apiUrl: '',
  region: 'oss-cn-hangzhou',
  bucket: '',
  accessKeyId: '',
  accessKeySecret: '',
  publicBaseUrl: '',
  domainSuffix: 'lightfish.top',
  protocol: 'https'
}

export interface AppEntry {
  id: string
  domain?: string
  path?: string
  enable: boolean
  currentVersion: number
  ossIndexUrl: string
}

export const appEntrySchema = z.object({
  id: z.string(),
  domain: z.string().optional(),
  path: z.string().optional(),
  enable: z.boolean().optional(),
  currentVersion: z.number(),
  ossIndexUrl: z.string()
})

export interface DeployPayload {
  id: string
  version: number
  ossIndexUrl: string
  domain?: string
  note?: string
}

export type Stage = 'prepare' | 'build' | 'upload' | 'deploy' | 'done' | 'error' | 'cancelled' | 'uncertain'

export interface Progress {
  stage: Stage
  message: string
  done?: number
  total?: number
  log?: string
  url?: string
}

export type PublishOutcome =
  | { status: 'published'; url: string; version: number; ossIndexUrl: string }
  | { status: 'uncertain'; version: number; ossIndexUrl: string; message: string }
  /** 确定性失败以结果返回（不走 reject），code 供界面给出针对性修复引导 */
  | { status: 'failed'; code: 'asset-base'; message: string }
  | { status: 'cancelled' }

export interface SavedState {
  settings: Settings
  projects: Project[]
}

export interface DesktopAPI {
  load(): Promise<SavedState>
  select(kind: 'source' | 'folder' | 'html'): Promise<string | null>
  inspect(path: string): Promise<Project>
  pathForFile(file: File): string
  saveProject(project: Project): Promise<Project>
  /** 删除本机保存的项目记录（不影响服务端应用） */
  removeProject(id: string): Promise<void>
  /** 保存全局连接设置（含明文凭据，整体落盘） */
  saveSettings(settings: Settings): Promise<void>
  publish(project: Project): Promise<PublishOutcome>
  cancel(): Promise<void>
  open(url: string): Promise<void>
  copy(text: string): Promise<void>
  onProgress(callback: (progress: Progress) => void): () => void
  /** macOS：从 Dock 图标或访达“打开方式”打开项目文件/目录 */
  onOpenPath(callback: (path: string) => void): () => void
  /** 自动更新：订阅状态变化 */
  onUpdateStatus(callback: (status: string, info?: { version: string; releaseDate: string }) => void): () => void
  /** 自动更新：下载进度 */
  onUpdateProgress(callback: (percent: number) => void): () => void
  /** 自动更新：下载完成 */
  onUpdateDownloaded(callback: (version: string) => void): () => void
  /** 自动更新：确认下载 */
  downloadUpdate(): Promise<void>
  /** 自动更新：安装并重启 */
  installUpdate(): Promise<void>
}

export class CancelledError extends Error {
  constructor() {
    super('已取消')
    this.name = 'CancelledError'
  }
}

export function httpUrl(raw: string): URL {
  const url = new URL(raw)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('地址必须为 HTTP(S)，且不能包含用户名或密码')
  }
  return url
}

export function assetUrl(base: string, key: string): string {
  return `${httpUrl(base).href.replace(/\/$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`
}

export function safeVersion(now: number, existing?: number): number {
  const version = Math.max(now, (existing ?? 0) + 1)
  if (!Number.isSafeInteger(version)) throw new Error('生成的版本号不是安全整数')
  return version
}

export function deployedUrl(app: AppEntry, protocol: string): string {
  if (app.enable === false) throw new Error('发布记录已保存，但应用当前已停用，请在服务端启用')
  if (!app.domain) throw new Error('发布记录已保存，但服务端未配置访问域名')
  const suffix = app.path ? '/' + app.path.replace(/^\/+/, '').replace(/\/+$/, '') + '/' : '/'
  return httpUrl(`${protocol}://${app.domain}${suffix}`).href
}
