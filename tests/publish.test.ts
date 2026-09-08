import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AppEntry, DeployPayload, Progress, Settings } from '@golive/core'
import { ApiError, NetworkError } from '../apps/desktop/src/main/gateway'
import { createPublishController, type PublishServices } from '../apps/desktop/src/main/publish'
import type { UploadInput } from '../apps/desktop/src/main/upload'
import type { ScriptRunner } from '../apps/desktop/src/main/scripts'

const NOW = 1788782400000

const settings: Settings = {
  apiUrl: 'https://gw.example.com',
  region: 'oss-cn-test',
  bucket: 'bucket',
  accessKeyId: 'ak',
  accessKeySecret: 'sk-secret-value',
  publicBaseUrl: 'https://static.example.com',
  domainSuffix: 'lightfish.top',
  protocol: 'https'
}

async function makeProject(script = 'pnpm run build', note = 'first release') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'golive-pub-'))
  await fs.mkdir(path.join(root, 'dist', 'assets'), { recursive: true })
  const html = '<!doctype html><html><head><script src="https://cdn.example.com/a.js"></script></head><body>hi</body></html>'
  await fs.writeFile(path.join(root, 'dist', 'index.html'), html)
  await fs.writeFile(path.join(root, 'dist', 'assets', 'a.js'), 'console.log(1)')
  return {
    root,
    htmlOnDisk: html,
    project: {
      source: root,
      appId: 'my-app',
      script,
      cwd: root,
      upload: 'dist',
      entry: 'index.html',
      domain: 'my-app.lightfish.top',
      note
    }
  }
}

interface Fixture {
  events: string[]
  appQueue: Array<AppEntry | null | Error>
  gets: string[]
  deploys: DeployPayload[]
  deployResult: AppEntry | Error
  uploads: Array<{ key: string }>
  failOn?: (input: UploadInput) => boolean
  scriptResult?: 'ok' | 'fail' | 'cancel'
  scriptEnvs?: Array<Record<string, string>>
}

function makeServices(fix: Fixture): PublishServices {
  const uploader: PublishServices['uploader'] = {
    async upload(input) {
      fix.events.push(`upload:${input.key}`)
      if (fix.failOn?.(input)) throw new Error('mock oss 请求失败')
      fix.uploads.push({ key: input.key })
    }
  }
  return {
    gateway: {
      async getApp(id) {
        fix.events.push('get')
        fix.gets.push(id)
        const next = fix.appQueue.shift()
        if (next instanceof Error) throw next
        return next ?? null
      },
      async deploy(payload) {
        fix.events.push('deploy')
        fix.deploys.push(payload)
        if (fix.deployResult instanceof Error) throw fix.deployResult
        return fix.deployResult
      }
    },
    uploader,
    secrets: ['sk-secret-value'],
    now: () => NOW,
    delay: async () => {}
  }
}

function scriptRunner(fix: Fixture): ScriptRunner {
  return {
    run({ env }) {
      fix.events.push('script')
      fix.scriptEnvs = [...(fix.scriptEnvs ?? []), env]
      if (fix.scriptResult === 'fail') {
        return { done: Promise.reject(new Error('脚本执行失败，退出码 2')), cancel: () => {} }
      }
      return { done: Promise.resolve(), cancel: () => {} }
    }
  }
}

function entryFixture(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    id: 'my-app',
    domain: 'my-app.lightfish.top',
    enable: true,
    currentVersion: NOW,
    ossIndexUrl: `https://static.example.com/my-app/${NOW}/index.html`,
    ...overrides
  }
}

async function runPublish(fix: Fixture, project: unknown, script: ScriptRunner | undefined) {
  const controller = createPublishController()
  const services = makeServices(fix)
  if (script) services.runScript = script
  const progress: Progress[] = []
  const outcome = await controller.publish(project, settings, services, p => progress.push(p))
  return { outcome, progress, controller }
}

test('新应用完整链路：顺序、直传、登记字段与访问地址', async () => {
  const { root, htmlOnDisk, project } = await makeProject()
  const fix: Fixture = {
    events: [],
    appQueue: [],
    gets: [],
    deploys: [],
    deployResult: entryFixture(),
    uploads: [],
    scriptResult: 'ok',
    scriptEnvs: []
  }
  const { outcome } = await runPublish(fix, project, scriptRunner(fix))
  assert.deepEqual(fix.events.slice(0, 1), ['script'])
  assert.deepEqual(fix.events.filter(e => e.startsWith('upload:')).sort(), [`upload:my-app/${NOW}/assets/a.js`, `upload:my-app/${NOW}/index.html`])
  assert.equal(fix.events[fix.events.length - 1], 'deploy')
  assert.deepEqual(fix.deploys[0], {
    id: 'my-app',
    version: NOW,
    ossIndexUrl: 'https://static.example.com/my-app/1788782400000/index.html',
    domain: 'my-app.lightfish.top',
    note: 'first release'
  })
  assert.deepEqual(fix.scriptEnvs?.[0], {
    GOLIVE_APP_ID: 'my-app',
    GOLIVE_VERSION: String(NOW),
    GOLIVE_ASSET_BASE: 'https://static.example.com/my-app/1788782400000/'
  })
  // 按原始路径直传、内容零改写
  assert.deepEqual(fix.uploads.map(u => u.key).sort(), [`my-app/${NOW}/assets/a.js`, `my-app/${NOW}/index.html`])
  assert.equal(await fs.readFile(path.join(root, 'dist', 'index.html'), 'utf8'), htmlOnDisk)
  assert.deepEqual(outcome, {
    status: 'published',
    url: 'https://my-app.lightfish.top/',
    version: NOW,
    ossIndexUrl: 'https://static.example.com/my-app/1788782400000/index.html'
  })
  await fs.rm(root, { recursive: true, force: true })
})

test('已有应用重复发布：请求始终携带建议域名，访问地址以服务端返回为准', async () => {
  const { project } = await makeProject('', '')
  const fix: Fixture = {
    events: [],
    appQueue: [],
    gets: [],
    deploys: [],
    deployResult: entryFixture({ domain: 'real.example.com', currentVersion: NOW, ossIndexUrl: `https://static.example.com/my-app/${NOW}/index.html` }),
    uploads: []
  }
  const { outcome } = await runPublish(fix, project, undefined)
  assert.equal(fix.deploys[0].domain, 'my-app.lightfish.top')
  assert.equal(fix.deploys[0].version, NOW)
  assert.deepEqual(outcome, { status: 'published', url: 'https://real.example.com/', version: NOW, ossIndexUrl: `https://static.example.com/my-app/${NOW}/index.html` })
})

test('脚本失败不上传不登记', async () => {
  const { project } = await makeProject()
  const fix: Fixture = { events: [], appQueue: [], gets: [], deploys: [], deployResult: entryFixture(), uploads: [], scriptResult: 'fail', scriptEnvs: [] }
  const controller = createPublishController()
  const services = makeServices(fix)
  services.runScript = scriptRunner(fix)
  await assert.rejects(controller.publish(project, settings, services, () => {}), /退出码 2/)
  assert.deepEqual(fix.events, ['script'])
  assert.equal(fix.deploys.length, 0)
})

test('部分上传失败不登记新版本', async () => {
  const { project } = await makeProject('')
  const fix: Fixture = {
    events: [],
    appQueue: [],
    gets: [],
    deploys: [],
    deployResult: entryFixture(),
    uploads: [],
    failOn: input => input.key.endsWith('a.js')
  }
  const controller = createPublishController()
  const services = makeServices(fix)
  await assert.rejects(controller.publish(project, settings, services, () => {}), /未登记新版本/)
  assert.equal(fix.deploys.length, 0)
  assert.equal(fix.uploads.length, 1)
})

test('停用应用：deploy 成功但生成访问地址失败并提示停用', async () => {
  const { project } = await makeProject()
  const fix: Fixture = {
    events: [],
    appQueue: [],
    gets: [],
    deploys: [],
    deployResult: entryFixture({ enable: false }),
    uploads: [],
    scriptResult: 'ok',
    scriptEnvs: []
  }
  const controller = createPublishController()
  const services = makeServices(fix)
  services.runScript = scriptRunner(fix)
  await assert.rejects(controller.publish(project, settings, services, () => {}), /停用/)
  assert.equal(fix.deploys.length, 1)
})

test('deploy 网络失败后经查询确认登记成功', async () => {
  const { project } = await makeProject('')
  const fix: Fixture = {
    events: [],
    appQueue: [entryFixture({ currentVersion: NOW, ossIndexUrl: `https://static.example.com/my-app/${NOW}/index.html` })],
    gets: [],
    deploys: [],
    deployResult: new NetworkError('无法连接网关：timeout'),
    uploads: []
  }
  const { outcome } = await runPublish(fix, project, undefined)
  assert.deepEqual(fix.events.filter(e => e.startsWith('upload:')).sort(), [`upload:my-app/${NOW}/assets/a.js`, `upload:my-app/${NOW}/index.html`])
  assert.deepEqual(fix.events.slice(-2), ['deploy', 'get'])
  assert.deepEqual(outcome, {
    status: 'published',
    url: 'https://my-app.lightfish.top/',
    version: NOW,
    ossIndexUrl: `https://static.example.com/my-app/${NOW}/index.html`
  })
})

test('deploy 网络失败且查询无法确认时报结果待确认', async () => {
  const { project } = await makeProject('')
  const fix: Fixture = {
    events: [],
    appQueue: [null, null, null],
    gets: [],
    deploys: [],
    deployResult: new NetworkError('无法连接网关：timeout'),
    uploads: []
  }
  const { outcome } = await runPublish(fix, project, undefined)
  assert.equal(outcome.status, 'uncertain')
  if (outcome.status === 'uncertain') {
    assert.equal(outcome.version, NOW)
    assert.ok(outcome.message.includes('待确认'))
  }
  assert.deepEqual(fix.gets, ['my-app', 'my-app', 'my-app'])
})

test('deploy 响应与请求不一致时报待确认', async () => {
  const { project } = await makeProject('')
  const fix: Fixture = {
    events: [],
    appQueue: [],
    gets: [],
    deploys: [],
    deployResult: entryFixture({ currentVersion: NOW - 1 }),
    uploads: []
  }
  const { outcome } = await runPublish(fix, project, undefined)
  assert.equal(outcome.status, 'uncertain')
})

test('服务端明确拒绝发布时直接报错', async () => {
  const { project } = await makeProject('')
  const fix: Fixture = {
    events: [],
    appQueue: [],
    gets: [],
    deploys: [],
    deployResult: new ApiError(`版本号已存在，禁止重复发布: ${NOW}`, 400),
    uploads: []
  }
  const controller = createPublishController()
  await assert.rejects(controller.publish(project, settings, makeServices(fix), () => {}), /版本号已存在/)
})

test('单 HTML 文件以 index.html 入口上传', async () => {
  const { project } = await makeProject('')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'golive-one-'))
  const file = path.join(root, 'page.html')
  await fs.writeFile(file, '<!doctype html><title>t</title>ok')
  const single = { ...project, source: file, cwd: root, upload: file, entry: 'index.html', script: '' }
  const fix: Fixture = { events: [], appQueue: [], gets: [], deploys: [], deployResult: entryFixture(), uploads: [] }
  const { outcome } = await runPublish(fix, single, undefined)
  assert.deepEqual(fix.uploads.map(u => u.key), [`my-app/${NOW}/index.html`])
  assert.equal(fix.deploys[0].ossIndexUrl, `https://static.example.com/my-app/${NOW}/index.html`)
  assert.equal(outcome.status, 'published')
})

test('连接配置缺失时不发起任何请求', async () => {
  const { project } = await makeProject('')
  const fix: Fixture = { events: [], appQueue: [], gets: [], deploys: [], deployResult: entryFixture(), uploads: [] }
  const controller = createPublishController()
  await assert.rejects(
    controller.publish(project, { ...settings, apiUrl: '', accessKeySecret: '' }, makeServices(fix), () => {}),
    /全局连接配置未完成/
  )
  assert.deepEqual(fix.events, [])
})

test('资源引用校验失败以 failed 结果返回，不走 reject', async () => {
  const { root, project } = await makeProject('')
  // 写入一个包含根路径引用的 HTML（不走完整 URL），触发 AssetRefError
  await fs.writeFile(path.join(root, 'dist', 'index.html'), '<!doctype html><script src="/assets/a.js"></script>')
  const fix: Fixture = { events: [], appQueue: [], gets: [], deploys: [], deployResult: entryFixture(), uploads: [] }
  const { outcome } = await runPublish(fix, project, undefined)
  assert.equal(outcome.status, 'failed')
  if (outcome.status === 'failed') {
    assert.equal(outcome.code, 'asset-base')
    assert.ok(outcome.message.includes('404'))
  }
  assert.equal(fix.deploys.length, 0)
})
