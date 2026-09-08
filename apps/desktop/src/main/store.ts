import { app, safeStorage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { defaultSettings, projectSchema, type Project, type SaveSettingsOptions, type Settings } from '@golive/core'
interface DiskState { settings: Settings; projects: Project[]; encrypted?: string }
const blank = (): DiskState => ({ settings: { ...defaultSettings }, projects: [] })
let current: DiskState | undefined
function filename() { return path.join(app.getPath('userData'), 'golive.json') }
export async function readState(): Promise<DiskState> {
  if (current) return current
  try {
    const raw = JSON.parse(await fs.readFile(filename(), 'utf8')) as DiskState
    current = { settings: { ...defaultSettings, ...raw.settings, accessKeySecret: '', token: '' }, projects: (raw.projects || []).map(p => projectSchema.parse(p)), encrypted: raw.encrypted }
    if (raw.encrypted) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统钥匙串不可用，无法读取已保存的凭据')
      const secrets = JSON.parse(safeStorage.decryptString(Buffer.from(raw.encrypted, 'base64')))
      current.settings.accessKeySecret = secrets.accessKeySecret || ''
      current.settings.token = secrets.token || ''
    }
    return current
  } catch (error) {
    current = undefined
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { current = blank(); return current }
    throw error
  }
}
async function persist(next: DiskState) {
  const { accessKeySecret, token, ...publicSettings } = next.settings
  let encrypted: string | undefined
  if (accessKeySecret || token) {
    if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw new Error('系统安全存储不可用，无法保存凭据。请启用系统钥匙串。')
    encrypted = safeStorage.encryptString(JSON.stringify({ accessKeySecret, token })).toString('base64')
  }
  await fs.mkdir(path.dirname(filename()), { recursive: true })
  const tmp = `${filename()}.tmp`
  await fs.writeFile(tmp, JSON.stringify({ settings: publicSettings, projects: next.projects, encrypted }, null, 2), { mode: 0o600 })
  await fs.rename(tmp, filename())
  current = { ...next, encrypted }
}
// Serialize writes so project/settings saves never overwrite each other.
let writes = Promise.resolve()
function enqueue(action: () => Promise<void>) {
  const next = writes.then(action)
  writes = next.catch(() => {})
  return next
}
export function saveProject(project: Project) {
  return enqueue(async () => {
    const state = await readState()
    await persist({ ...state, projects: [project, ...state.projects.filter(p => p.source !== project.source)].slice(0, 12) })
  })
}
export function saveSettings(settings: Settings, options?: SaveSettingsOptions) {
  return enqueue(async () => {
    const state = await readState()
    // Blank secret fields mean "keep existing" unless explicitly cleared; the renderer never receives saved secrets.
    const keep = (value: string, existing: string) => (options?.clearSecrets ? '' : value || existing)
    await persist({
      ...state,
      settings: { ...settings, accessKeySecret: keep(settings.accessKeySecret, state.settings.accessKeySecret), token: keep(settings.token, state.settings.token) }
    })
  })
}
export async function publicState() {
  const state = await readState()
  return { settings: { ...state.settings, accessKeySecret: '', token: '' }, projects: state.projects, hasSecrets: Boolean(state.settings.accessKeySecret), hasToken: Boolean(state.settings.token) }
}
