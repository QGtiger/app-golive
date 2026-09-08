import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AssetRefError, collectFiles, inspectSource } from '../apps/desktop/src/main/files'

async function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'golive-test-'))
}

async function write(root: string, relative: string, content: string) {
  const target = path.join(root, relative)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content)
  return target
}

test('含 build script 的项目建议包管理器构建命令与 dist 目录', async () => {
  const root = await tmp()
  await write(root, 'package.json', JSON.stringify({ name: '@scope/My App', scripts: { build: 'vite build' } }))
  await write(root, 'pnpm-lock.yaml', '')
  const project = await inspectSource(root, 'lightfish.top')
  assert.equal(project.appId, 'my-app')
  assert.equal(project.script, 'pnpm run build')
  assert.equal(project.upload, 'dist')
  assert.equal(project.entry, 'index.html')
  assert.equal(project.domain, 'my-app.lightfish.top')
})

test('无 package.json 的目录直接上传', async () => {
  const root = await tmp()
  await write(root, 'index.html', '<h1>hi</h1>')
  const project = await inspectSource(root, 'lightfish.top')
  assert.equal(project.script, '')
  assert.equal(project.upload, '.')
})

test('自包含 HTML 单文件发布入口为 index.html', async () => {
  const root = await tmp()
  const file = await write(root, 'page.html', '<!doctype html><title>t</title><h1>ok</h1>')
  const project = await inspectSource(file, 'lightfish.top')
  assert.equal(project.entry, 'index.html')
  assert.equal(project.upload, await fs.realpath(file))
  const { files, entryKey } = await collectFiles(project)
  assert.deepEqual(files.map(f => f.key), ['index.html'])
  assert.equal(entryKey, 'index.html')
})

test('引用本地资源的 HTML 拒绝单文件发布', async () => {
  const root = await tmp()
  const file = await write(root, 'page.html', '<!doctype html><script src="app.js"></script>')
  const project = await inspectSource(file, 'lightfish.top')
  await assert.rejects(collectFiles(project), /本地资源/)
})

test('远程与 data 资源不触发本地资源判定', async () => {
  const root = await tmp()
  const file = await write(
    root,
    'page.html',
    '<!doctype html><script src="https://cdn.example.com/a.js"></script><img src="data:image/png;base64,AAAA"><a href="#top">x</a>'
  )
  const project = await inspectSource(file, 'lightfish.top')
  const { files } = await collectFiles(project)
  assert.equal(files.length, 1)
})

test('目录扫描排除隐藏文件与 node_modules，支持子目录入口', async () => {
  const root = await tmp()
  await write(root, 'dist/index.html', '<h1>entry</h1>')
  await write(root, 'dist/assets/a.js', 'x')
  await write(root, 'dist/.hidden', 'x')
  await write(root, 'dist/.env', 'SECRET=1')
  await write(root, 'dist/node_modules/pkg/i.js', 'x')
  await write(root, 'other.html', 'x')
  const project = { ...(await inspectSource(root, 'lightfish.top')), upload: 'dist', entry: 'index.html', script: '', appId: 'x', domain: 'x.top', note: '' }
  const { files, entryKey } = await collectFiles(project)
  assert.deepEqual(files.map(f => f.key).sort(), ['assets/a.js', 'index.html'])
  assert.equal(entryKey, 'index.html')
  const sub = { ...project, entry: 'assets/a.js' }
  await assert.rejects(collectFiles(sub), /入口必须是上传目录内的 HTML 文件/)
})

test('拒绝越界入口与符号链接', async () => {
  const root = await tmp()
  await write(root, 'dist/index.html', '<h1>entry</h1>')
  const outside = await write(root, 'outside.html', 'x')
  const jsFile = await write(root, 'outside.js', 'x')
  const project = { ...(await inspectSource(root, 'lightfish.top')), upload: 'dist', script: '', appId: 'x', domain: 'x.top', note: '' }
  await assert.rejects(collectFiles({ ...project, entry: '../outside.html' }), /入口/)
  await assert.rejects(collectFiles({ ...project, upload: jsFile }), /仅支持 HTML/)
  const withLink = { ...project, upload: 'dist', entry: 'index.html' }
  await fs.symlink(outside, path.join(root, 'dist', 'link.html'))
  await assert.rejects(collectFiles(withLink), /符号链接/)
})

test('上传内容不存在时给出具体路径', async () => {
  const root = await tmp()
  const project = { ...(await inspectSource(root, 'lightfish.top')), upload: 'nowhere', script: '', appId: 'x', domain: 'x.top', note: '', entry: 'index.html' }
  await assert.rejects(collectFiles(project), /上传内容不存在/)
})

test('HTML 相对与根路径资源引用导致校验失败并提示资源基址', async () => {
  const root = await tmp()
  const project = { ...(await inspectSource(root, 'lightfish.top')), upload: 'dist', entry: 'index.html', script: '', appId: 'x', domain: 'x.top', note: '' }
  await write(root, 'dist/index.html', '<!doctype html><script src="/assets/a.js"></script>')
  await assert.rejects(collectFiles(project), (error: unknown) => error instanceof AssetRefError && /404/.test((error as Error).message))
  await write(root, 'dist/index.html', '<!doctype html><script src="./assets/a.js"></script>')
  await assert.rejects(collectFiles(project), (error: unknown) => error instanceof AssetRefError)
})

test('HTML 完整 URL 与 data 引用通过校验', async () => {
  const root = await tmp()
  await write(
    root,
    'dist/index.html',
    '<!doctype html><script src="https://cdn.example.com/a.js"></script>' +
    '<img src="data:image/png;base64,AA"><img srcset="https://cdn.example.com/a.png 2x">' +
    '<link rel="stylesheet" href="https://cdn.example.com/s.css"><a href="/next">n</a>'
  )
  const project = { ...(await inspectSource(root, 'lightfish.top')), upload: 'dist', entry: 'index.html', script: '', appId: 'x', domain: 'x.top', note: '' }
  const { files } = await collectFiles(project)
  assert.equal(files.length, 1)
})

test('CSS 相对引用放行，根路径 url 与 @import 拒绝', async () => {
  const root = await tmp()
  await write(root, 'dist/index.html', '<h1>ok</h1>')
  await write(root, 'dist/css/a.css', 'a{background:url(../img/y.png)}')
  const project = { ...(await inspectSource(root, 'lightfish.top')), upload: 'dist', entry: 'index.html', script: '', appId: 'x', domain: 'x.top', note: '' }
  const { files } = await collectFiles(project)
  assert.equal(files.length, 2)
  await write(root, 'dist/css/a.css', 'a{background:url(/img/y.png)}@import "/other.css";')
  await assert.rejects(collectFiles(project), /url\(\/img\/y\.png\)/)
})
