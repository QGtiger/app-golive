/**
 * 输入识别与上传内容收集：
 * - inspectSource：拖入/选择时运行，识别三种输入并生成配置建议（不执行任何项目代码）；
 * - collectFiles：发布时扫描上传清单，完成安全、入口与资源引用校验；
 * - 不改写任何文件内容（含 HTML/CSS）：产物必须自洽——HTML 资源引用需要完整 URL，
 *   由业务构建时注入资源基址（如 vite build --base "$GOLIVE_ASSET_BASE"）保证。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { load } from 'cheerio'
import type { Project } from '@golive/core'

// 扫描时排除的目录/文件名（隐藏文件与 .env* 在 walk 内另行过滤）
const ignored = new Set(['node_modules', '.git', '.DS_Store', '.env', '.npmrc', '.yarnrc', '.pnpm-store'])
export interface UploadFile { absolute: string; key: string }
export async function exists(file: string): Promise<boolean> {
  try { await fs.access(file); return true } catch { return false }
}
export function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
export async function inspectSource(source: string, suffix: string): Promise<Project> {
  source = await fs.realpath(source)
  const stat = await fs.stat(source)
  if (!stat.isDirectory() && (!stat.isFile() || !/\.html?$/i.test(source))) throw new Error('请选择项目文件夹、构建产物文件夹或 HTML 文件')
  const cwd = stat.isDirectory() ? source : path.dirname(source)
  let name = path.basename(source, path.extname(source)), script = '', upload = stat.isDirectory() ? '.' : source
  if (stat.isDirectory()) name = path.basename(source)
  const pkgPath = path.join(cwd, 'package.json')
  if (stat.isDirectory() && await exists(pkgPath)) {
    let pkg: { name?: string; scripts?: Record<string, string> }
    try { pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) } catch { throw new Error('package.json 格式不正确，请修复后重试') }
    name = pkg.name?.replace(/^@[^/]+\//, '') || name
    if (pkg.scripts?.build) {
      const manager = await exists(path.join(cwd, 'pnpm-lock.yaml')) ? 'pnpm' : await exists(path.join(cwd, 'yarn.lock')) ? 'yarn' : await exists(path.join(cwd, 'bun.lock')) || await exists(path.join(cwd, 'bun.lockb')) ? 'bun' : 'npm'
      script = `${manager} run build`
      upload = 'dist'
    }
  }
  const appId = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'my-web-app'
  return { source, appId, cwd, script, upload, entry: 'index.html', domain: `${appId}.${suffix}`, note: '' }
}
export async function collectFiles(project: Project): Promise<{ files: UploadFile[]; entryKey: string }> {
  const target = path.resolve(project.cwd, project.upload)
  const targetStat = await fs.lstat(target).catch(() => { throw new Error(`上传内容不存在：${target}。请检查发布前脚本和产物目录。`) })
  if (targetStat.isSymbolicLink()) throw new Error('上传目标不能是符号链接，请选择实际文件或目录')
  const files: UploadFile[] = []
  if (targetStat.isFile()) {
    // 单文件模式：检测明显的本地资源依赖（相对 src/href、本地 url()），
    // 有依赖就提示改选完整文件夹，避免发布后页面资源 404（PRODUCT §4）
    if (!/\.html?$/i.test(target)) throw new Error('单文件发布仅支持 HTML')
    const html = await fs.readFile(target, 'utf8')
    const $ = load(html)
    const localAssets = $('[src],link[href]').toArray().some(el => {
      const value = $(el).attr('src') || $(el).attr('href') || ''
      return value && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)
    }) || /url\(\s*['"]?(?!data:|https?:|\/\/|#)[^)'"\s]+/i.test(html)
    if (localAssets) throw new Error('这个 HTML 引用了本地资源。请改选包含 JS、CSS、图片的整个文件夹，并指定入口文件。')
    files.push({ absolute: target, key: 'index.html' })
    await assertBundledRefs(files)
    return { files, entryKey: 'index.html' }
  }
  if (!targetStat.isDirectory()) throw new Error('上传内容必须是文件夹或 HTML 文件')
  const root = await fs.realpath(target)
  // 入口必须位于上传目录内（拒绝越界）且是 HTML，可指向子目录
  const entry = path.resolve(root, project.entry)
  if (!inside(root, entry) || !/\.html?$/i.test(entry)) throw new Error('入口必须是上传目录内的 HTML 文件')
  // 递归扫描：跳过排除项与隐藏文件；符号链接直接报错（不跟随）；
  // 文件数量设上限，防止误选整个用户目录
  async function walk(dir: string) {
    const children = await fs.readdir(dir, { withFileTypes: true })
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignored.has(child.name) || child.name.startsWith('.env') || child.name.startsWith('.')) continue
      const absolute = path.join(dir, child.name)
      if (child.isSymbolicLink()) throw new Error(`上传目录包含符号链接：${path.relative(root, absolute)}。请移除链接或选择实际产物目录。`)
      if (child.isDirectory()) await walk(absolute)
      else if (child.isFile()) files.push({ absolute, key: path.relative(root, absolute).split(path.sep).join('/') })
      if (files.length > 30000) throw new Error('文件过多，请确认选择的是构建产物目录')
    }
  }
  await walk(root)
  const entryKey = path.relative(root, entry).split(path.sep).join('/')
  if (!files.some(file => file.key === entryKey)) throw new Error(`未找到入口文件：${project.entry}`)
  await assertBundledRefs(files)
  return { files, entryKey }
}

// —— 资源引用校验：不改写文件，只检查构建产物是否自洽 ——

/** HTML 引用必须完整指向最终地址（完整 URL / 协议相对 / data: 等协议）；相对与根路径在网关域名下会 404 */
function badHtmlRef(value: string): boolean {
  const trimmed = value.trim()
  return Boolean(trimmed) && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(trimmed)
}

/** CSS 由 OSS 直接提供，相对地址相对 CSS 文件自身解析、天然自洽；只有根路径 /... 会指向网关域名 */
function isCssRootRef(value: string): boolean {
  return /^\/(?!\/)/.test(value.trim())
}

function srcsetHasBadRef(value: string): boolean {
  return value.split(',').some(part => badHtmlRef(part.trim().split(/\s+/)[0] ?? ''))
}

function scanHtml(html: string): string[] {
  const bad: string[] = []
  for (const match of html.matchAll(/\s(src|srcset|poster)\s*=\s*(["'])(.*?)\2/gi)) {
    const name = match[1].toLowerCase()
    const value = match[3]
    if (name === 'srcset' ? srcsetHasBadRef(value) : badHtmlRef(value)) bad.push(`${name}="${value}"`)
  }
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const href = /href\s*=\s*(["'])(.*?)\1/i.exec(tag[0])?.[2]
    if (href && badHtmlRef(href)) bad.push(`link href="${href}"`)
  }
  return bad
}

function scanCss(css: string): string[] {
  const bad: string[] = []
  for (const match of css.matchAll(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)) {
    if (isCssRootRef(match[2])) bad.push(`url(${match[2]})`)
  }
  for (const match of css.matchAll(/@import\s+(['"])(.*?)\1/gi)) {
    if (isCssRootRef(match[2])) bad.push(`@import "${match[2]}"`)
  }
  return bad
}

// 校验失败即发布失败：资源正确性交还给构建侧，客户端只检查不修补
// 文案精简，修复引导由界面层的“修复 Prompt”区域承载
export class AssetRefError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssetRefError'
  }
}

async function assertBundledRefs(files: UploadFile[]): Promise<void> {
  const problems: string[] = []
  for (const file of files) {
    if (/\.html?$/i.test(file.key)) {
      const refs = scanHtml(await fs.readFile(file.absolute, 'utf8'))
      problems.push(...refs.map(ref => `${file.key} → ${ref}`))
    } else if (/\.css$/i.test(file.key)) {
      const refs = scanCss(await fs.readFile(file.absolute, 'utf8'))
      problems.push(...refs.map(ref => `${file.key} → ${ref}`))
    }
    if (problems.length >= 2) break
  }
  if (problems.length) {
    throw new AssetRefError(`产物存在未指向 OSS 的资源引用（${problems.slice(0, 2).join('；')}），发布后会 404，已停止发布`)
  }
}
