/**
 * 本地持久化：
 * - 文件位于 userData/golive.json，全部配置（含 OSS 凭据）明文存放——纯本机工具，凭据不出本机；
 * - 渲染进程与本机同源，凭据明文可读（设置页直接回显）；
 * - 写入串行化 + 临时文件 rename 原子替换，避免并发保存互相覆盖；
 * - 旧版本的 safeStorage 加密字段在读取时一次性解密迁移为明文。
 */
import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { defaultSettings, projectSchema, type Project, type Settings } from '@golive/core'

interface DiskState { settings: Settings; projects: Project[]; encrypted?: string }
const blank = (): DiskState => ({ settings: { ...defaultSettings }, projects: [] })
let current: DiskState | undefined
function filename() { return path.join(app.getPath('userData'), 'golive.json') }
export async function readState(): Promise<DiskState> {
  if (current) return current
  try {
    const raw = JSON.parse(await fs.readFile(filename(), 'utf8')) as DiskState
    const settings: Settings = { ...defaultSettings, ...raw.settings }
    const projects = (raw.projects || []).map(p => projectSchema.parse({ ...p, id: p?.id || randomUUID() }))
    if (raw.encrypted) {
      // 旧版加密凭据一次性迁移为明文；解不开（如应用名变更导致钥匙串失效）就丢弃，Secret 需重新填写
      try {
        const secrets = JSON.parse(safeStorage.decryptString(Buffer.from(raw.encrypted, 'base64')))
        settings.accessKeySecret = settings.accessKeySecret || secrets.accessKeySecret || ''
      } catch {
        // 忽略：继续以明文字段为准
      }
      current = { settings, projects }
      void persist(current)
    } else {
      current = { settings, projects }
    }
    return current
  } catch (error) {
    current = undefined
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { current = blank(); return current }
    throw error
  }
}
// 明文写入；先写临时文件再 rename 原子生效，0600 权限限制文件可读范围
async function persist(next: DiskState) {
  await fs.mkdir(path.dirname(filename()), { recursive: true })
  const tmp = `${filename()}.tmp`
  await fs.writeFile(tmp, JSON.stringify({ settings: next.settings, projects: next.projects }, null, 2), { mode: 0o600 })
  await fs.rename(tmp, filename())
  current = { settings: next.settings, projects: next.projects }
}
// 所有写操作排队串行执行；单个失败不阻断后续排队任务
let writes = Promise.resolve()
function enqueue<T>(action: () => Promise<T>): Promise<T> {
  const next = writes.then(action)
  writes = next.then(() => undefined, () => undefined)
  return next
}
// 保存/更新项目配置：按 source 去重并置顶，最多保留 12 条作为“最近项目”。
// 同一 source 复用既有 id（重新拖入同目录不会换 id，/detail/:id 链接保持有效）；
// 返回落盘后的完整记录（含 id），供调用方跳转详情页。
export function saveProject(input: unknown): Promise<Project> {
  return enqueue(async () => {
    const incoming = projectSchema.parse(input)
    const state = await readState()
    const existing = state.projects.find(p => p.source === incoming.source)
    const project: Project = { ...incoming, id: existing?.id ?? incoming.id ?? randomUUID() }
    await persist({ ...state, projects: [project, ...state.projects.filter(p => p.source !== project.source)].slice(0, 12) })
    return project
  })
}
// 删除本机项目记录（仅移除本机记忆，不影响服务端应用）；id 不存在时静默返回
export function removeProject(id: string) {
  return enqueue(async () => {
    const state = await readState()
    if (!state.projects.some(p => p.id === id)) return
    await persist({ ...state, projects: state.projects.filter(p => p.id !== id) })
  })
}
// 整体保存设置：凭据即表单内容（明文），清空后保存即删除
export function saveSettings(settings: Settings) {
  return enqueue(async () => {
    const state = await readState()
    await persist({ ...state, settings })
  })
}
// 提供给渲染进程的完整视图（含明文凭据），设置页直接回显编辑
export async function publicState() {
  const state = await readState()
  return { settings: state.settings, projects: state.projects, version: app.getVersion() }
}
