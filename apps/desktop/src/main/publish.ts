import fs from 'node:fs/promises'
import {
  CancelledError,
  assetUrl,
  deployedUrl,
  projectSchema,
  safeVersion,
  type AppEntry,
  type Progress,
  type Project,
  type PublishOutcome,
  type Settings
} from '@golive/core'
import { collectFiles, prepareCss, prepareHtml } from './files'
import { NetworkError, type GatewayClient } from './gateway'
import type { ScriptRunner } from './scripts'
import { nodeScriptRunner } from './scripts'
import type { OssUploader } from './upload'

const UPLOAD_CONCURRENCY = 4

export interface PublishServices {
  gateway: GatewayClient
  uploader: OssUploader
  runScript?: ScriptRunner
  secrets: string[]
  now?: () => number
  delay?: (ms: number) => Promise<void>
}

export interface PublishController {
  publish(project: unknown, settings: Settings, services: PublishServices, onProgress: (progress: Progress) => void): Promise<PublishOutcome>
  cancel(): void
  isBusy(): boolean
}

interface ActiveTask {
  cancelled: boolean
  stage: Progress['stage']
  killScript?: () => void
}

function missingConnection(settings: Settings): string | null {
  const required: Array<[string, string]> = [
    ['网关 API 基础地址', settings.apiUrl],
    ['OSS Bucket', settings.bucket],
    ['OSS AccessKey ID', settings.accessKeyId],
    ['OSS AccessKey Secret', settings.accessKeySecret],
    ['OSS/CDN 公共访问根地址', settings.publicBaseUrl]
  ]
  const missing = required.filter(([, value]) => !value.trim()).map(([label]) => label)
  return missing.length ? `全局连接配置未完成，缺少：${missing.join('、')}。请在设置中补全后再发布。` : null
}

async function pool(items: number, worker: (index: number) => Promise<void>, limit = UPLOAD_CONCURRENCY): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items) }, async () => {
    while (next < items) {
      const index = next++
      await worker(index)
    }
  })
  await Promise.all(runners)
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export function createPublishController(): PublishController {
  let active: ActiveTask | null = null

  function cancel() {
    if (!active || active.stage === 'deploy') return
    active.cancelled = true
    active.killScript?.()
  }

  async function publish(
    rawProject: unknown,
    settings: Settings,
    services: PublishServices,
    onProgress: (progress: Progress) => void
  ): Promise<PublishOutcome> {
    if (active) throw new Error('已有发布任务在进行中，请等待完成或取消')
    const project: Project = projectSchema.parse(rawProject)
    active = { cancelled: false, stage: 'prepare' }
    const emit = (progress: Progress) => onProgress(progress)
    const checkCancelled = () => {
      if (active?.cancelled) throw new CancelledError()
    }
    try {
      const connectionProblem = missingConnection(settings)
      if (connectionProblem) throw new Error(connectionProblem)

      emit({ stage: 'prepare', message: '正在查询现有应用…' })
      const existing = await services.gateway.getApp(project.appId)
      checkCancelled()
      if (existing && !existing.enable) {
        throw new Error('该应用已在服务端停用，请先在服务端启用后再发布')
      }
      if (existing?.domain && existing.domain !== project.domain) {
        emit({ stage: 'prepare', message: `已有应用，将沿用服务端域名 ${existing.domain}` })
      }
      const version = safeVersion(services.now?.() ?? Date.now(), existing?.currentVersion)
      const publicRoot = settings.publicBaseUrl.replace(/\/+$/, '')
      const assetBase = `${publicRoot}/${project.appId}/${version}/`

      if (project.script.trim()) {
        active.stage = 'build'
        emit({ stage: 'build', message: '正在执行发布前脚本…' })
        const runner = services.runScript ?? nodeScriptRunner
        const run = runner.run({
          script: project.script,
          cwd: project.cwd,
          env: {
            GOLIVE_APP_ID: project.appId,
            GOLIVE_VERSION: String(version),
            GOLIVE_ASSET_BASE: assetBase
          },
          secrets: services.secrets,
          onLog: chunk => emit({ stage: 'build', message: '正在执行发布前脚本…', log: chunk })
        })
        active.killScript = run.cancel
        try {
          await run.done
        } finally {
          active.killScript = undefined
        }
        checkCancelled()
      }

      emit({ stage: 'prepare', message: '正在扫描上传内容…' })
      const { files, entryKey } = await collectFiles(project)
      const total = files.length
      emit({ stage: 'upload', message: '准备上传副本…', done: 0, total })

      const inputs = await Promise.all(
        files.map(async file => {
          const key = `${project.appId}/${version}/${file.key}`
          if (/\.(html?|css)$/i.test(file.key)) {
            const raw = await fs.readFile(file.absolute, 'utf8')
            const contentType = /\.css$/i.test(file.key) ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8'
            const fullKey = `${project.appId}/${version}/${file.key}`
            const body = Buffer.from(/\.css$/i.test(file.key) ? prepareCss(raw, publicRoot) : prepareHtml(raw, fullKey, publicRoot))
            return { absolute: file.absolute, key, size: file.size, body, contentType }
          }
          return { ...file, key }
        })
      )
      checkCancelled()

      active.stage = 'upload'
      let done = 0
      let lastEmit = 0
      let firstError: Error | null = null
      await pool(total, async index => {
        if (firstError || active?.cancelled) return
        checkCancelled()
        try {
          await services.uploader.upload(inputs[index])
          done++
          const now = Date.now()
          if (done === total || now - lastEmit > 150) {
            lastEmit = now
            emit({ stage: 'upload', message: `已完成 ${done} / ${total} 个文件`, done, total })
          }
        } catch (error) {
          if (!firstError) firstError = error as Error
        }
      })
      checkCancelled()
      if (firstError) {
        throw new Error(`有文件上传失败（已完成 ${done}/${total}）：${(firstError as Error).message}。本次发布已停止，未登记新版本。`)
      }

      active.stage = 'deploy'
      const ossIndexUrl = assetUrl(publicRoot, `${project.appId}/${version}/${entryKey}`)
      emit({ stage: 'deploy', message: '正在登记发布…' })
      const payload = {
        id: project.appId,
        version,
        ossIndexUrl,
        domain: existing ? undefined : project.domain,
        note: project.note || undefined
      }
      const verify = async (): Promise<AppEntry | null> => {
        const delay = services.delay ?? sleep
        for (let attempt = 1; attempt <= 3; attempt++) {
          await delay(1500 * attempt)
          try {
            const app = await services.gateway.getApp(project.appId)
            if (app && app.currentVersion === version && app.ossIndexUrl === ossIndexUrl) return app
          } catch {
            // 查询失败继续退避重试，最终进入 uncertain
          }
        }
        return null
      }
      let entry: AppEntry
      try {
        entry = await services.gateway.deploy(payload)
      } catch (error) {
        if (error instanceof NetworkError) {
          const confirmed = await verify()
          if (confirmed) {
            const url = deployedUrl(confirmed, settings.protocol)
            emit({ stage: 'done', message: '发布登记已确认', url })
            return { status: 'published', url, version, ossIndexUrl }
          }
          emit({ stage: 'uncertain', message: '发布结果待确认' })
          return { status: 'uncertain', version, ossIndexUrl, message: '发布请求未收到成功响应，查询服务端也未能确认，结果待确认。请稍后核对服务端记录，不要立即重发，避免版本冲突。' }
        }
        throw error
      }
      if (entry.id !== project.appId || entry.currentVersion !== version || entry.ossIndexUrl !== ossIndexUrl) {
        emit({ stage: 'uncertain', message: '发布结果待确认' })
        return {
          status: 'uncertain',
          version,
          ossIndexUrl,
          message: `服务端返回与本次发布不一致（id=${entry.id}，version=${entry.currentVersion}）。请核对服务端记录后再操作。`
        }
      }
      const url = deployedUrl(entry, settings.protocol)
      emit({ stage: 'done', message: '发布成功', url })
      return { status: 'published', url, version, ossIndexUrl }
    } catch (error) {
      if (error instanceof CancelledError) {
        emit({ stage: 'cancelled', message: '已取消' })
        return { status: 'cancelled' }
      }
      emit({ stage: 'error', message: (error as Error).message })
      throw error
    } finally {
      active = null
    }
  }

  return { publish, cancel, isBusy: () => active !== null }
}
