import fs from 'node:fs/promises'
import path from 'node:path'
import { load } from 'cheerio'
import type { Project } from '@golive/core'
import { assetUrl } from '@golive/core'

const ignored = new Set(['node_modules', '.git', '.DS_Store', '.env', '.npmrc', '.yarnrc', '.pnpm-store'])
export interface UploadFile { absolute: string; key: string; size: number }
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
    if (!/\.html?$/i.test(target)) throw new Error('单文件发布仅支持 HTML')
    const html = await fs.readFile(target, 'utf8')
    const $ = load(html)
    const localAssets = $('[src],link[href]').toArray().some(el => {
      const value = $(el).attr('src') || $(el).attr('href') || ''
      return value && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)
    }) || /url\(\s*['"]?(?!data:|https?:|\/\/|#)[^)'"\s]+/i.test(html)
    if (localAssets) throw new Error('这个 HTML 引用了本地资源。请改选包含 JS、CSS、图片的整个文件夹，并指定入口文件。')
    return { files: [{ absolute: target, key: 'index.html', size: targetStat.size }], entryKey: 'index.html' }
  }
  if (!targetStat.isDirectory()) throw new Error('上传内容必须是文件夹或 HTML 文件')
  const root = await fs.realpath(target)
  const entry = path.resolve(root, project.entry)
  if (!inside(root, entry) || !/\.html?$/i.test(entry)) throw new Error('入口必须是上传目录内的 HTML 文件')
  async function walk(dir: string) {
    const children = await fs.readdir(dir, { withFileTypes: true })
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignored.has(child.name) || child.name.startsWith('.env') || child.name.startsWith('.')) continue
      const absolute = path.join(dir, child.name)
      if (child.isSymbolicLink()) throw new Error(`上传目录包含符号链接：${path.relative(root, absolute)}。请移除链接或选择实际产物目录。`)
      if (child.isDirectory()) await walk(absolute)
      else if (child.isFile()) files.push({ absolute, key: path.relative(root, absolute).split(path.sep).join('/'), size: (await fs.stat(absolute)).size })
      if (files.length > 30000) throw new Error('文件过多，请确认选择的是构建产物目录')
    }
  }
  await walk(root)
  const entryKey = path.relative(root, entry).split(path.sep).join('/')
  if (!files.some(file => file.key === entryKey)) throw new Error(`未找到入口文件：${project.entry}`)
  return { files, entryKey }
}
// Gateway serves the HTML at its own domain. Rebase asset references without modifying local files.
export function prepareHtml(html: string, fileKey: string, publicRoot: string): string {
  const $ = load(html)
  const documentUrl = assetUrl(publicRoot, fileKey)
  const oldBase = $('base[href]').first().attr('href')
  const relativeBase = oldBase ? new URL(oldBase, documentUrl).href : new URL('.', documentUrl).href
  $('base').remove()
  $('head').prepend($('<base>').attr('href', relativeBase))
  const rebaseRoot = (value: string) => value.startsWith('/') && !value.startsWith('//') ? `${publicRoot.replace(/\/$/, '')}${value}` : value
  $('[src],[href],[poster],[data]').each((_, el) => {
    const node = $(el)
    for (const attr of ['src', 'href', 'poster', 'data']) {
      if (node.is('a,base') && attr === 'href') continue
      const value = node.attr(attr)
      if (value) node.attr(attr, rebaseRoot(value))
    }
  })
  $('[srcset]').each((_, el) => {
    const node = $(el), value = node.attr('srcset')!
    if (!value.includes('data:')) node.attr('srcset', value.replace(/(^|,)(\s*)(\/[^/\s,][^\s,]*)/g, (_, a, b, c) => `${a}${b}${rebaseRoot(c)}`))
  })
  $('style').each((_, el) => { $(el).text(prepareCss($(el).text(), publicRoot)) })
  $('[style]').each((_, el) => { $(el).attr('style', prepareCss($(el).attr('style')!, publicRoot)) })
  return $.html()
}
export function prepareCss(css: string, publicRoot: string): string {
  return css.replace(/url\(\s*(['"]?)(\/[^/][^)'"\s]*)\1\s*\)/g, (_, quote, value) => `url(${quote}${publicRoot.replace(/\/$/, '')}${value}${quote})`)
    .replace(/(@import\s+['"])(\/[^/][^'"]*)(['"])/g, (_, a, b, c) => `${a}${publicRoot.replace(/\/$/, '')}${b}${c}`)
}
