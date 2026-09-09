/**
 * 发布任务协调器。一次完整发布的顺序：
 * 执行发布前脚本 → 扫描上传内容（含资源引用校验）→ 并发直传 → 登记发布 → 校验响应。
 * 对应 docs/TECHNICAL.md §6 与 docs/PRODUCT.md §5.3-§5.5。
 *
 * 不做发布前预查：deploy 本身语义就是“没有则创建、有则追加版本”（服务端保证），
 * domain 仅新建应用时生效，已有应用由服务端忽略，客户端无需区分新旧应用。
 *
 * 关键约束：
 * - 同一时刻只允许一个发布任务（active 单例锁）；
 * - 脚本失败或部分上传失败都不会调用 deploy，旧线上版本不受影响；
 * - deploy 阶段不可取消；网络失败时用 app/get 复核，仍无法确认则返回 uncertain。
 */
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
import { collectFiles, AssetRefError } from './files'
import { log } from './logger'
import { NetworkError, type GatewayClient } from './gateway'
import type { ScriptRunner } from './scripts'
import { nodeScriptRunner } from './scripts'
import type { OssUploader } from './upload'

// 上传并发上限：控制带宽占用，也避免触发 OSS 限流
const UPLOAD_CONCURRENCY = 4

// 发布依赖全部通过该接口注入：生产用真实网关/OSS/子进程，
// 测试注入假实现来验证调用顺序、部分失败与错误分支
export interface PublishServices {
  /** 网关客户端：查询应用 / 登记发布 */
  gateway: GatewayClient
  /** OSS 上传适配器 */
  uploader: OssUploader
  /** 脚本执行器；缺省用 nodeScriptRunner，测试可注入避免真实 spawn */
  runScript?: ScriptRunner
  /** 需要在日志中脱敏的凭据 */
  secrets: string[]
  now?: () => number
  delay?: (ms: number) => Promise<void>
}

export interface PublishController {
  publish(project: unknown, settings: Settings, services: PublishServices, onProgress: (progress: Progress) => void): Promise<PublishOutcome>
  cancel(): void
  isBusy(): boolean
}

/** 运行中的任务：取消标记 + 当前阶段 + 脚本进程终止器 */
interface ActiveTask {
  cancelled: boolean
  stage: Progress['stage']
  killScript?: () => void
}

// 发布前检查必填连接项；缺任何一项都直接失败，不发起半配置的发布
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

// 有限并发池：limit 个 worker 共享一个递增下标，直到取完所有任务
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
    // deploy 开始后不再允许取消：服务端可能已写入新版本，
    // 把可能成功的请求显示成“已取消”会误导用户
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
    // 单任务锁：第一版一次只运行一个发布任务（PRODUCT §5.3）
    if (active) throw new Error('已有发布任务在进行中，请等待完成或取消')
    // IPC 传来的数据重新过 zod 校验
    const project: Project = projectSchema.parse(rawProject)
    active = { cancelled: false, stage: 'prepare' }
    const emit = (progress: Progress) => onProgress(progress)
    // 各阶段间检查取消标记；触发即抛 CancelledError，最终以 cancelled 结果返回
    const checkCancelled = () => {
      if (active?.cancelled) throw new CancelledError()
    }
    try {
      const connectionProblem = missingConnection(settings)
      if (connectionProblem) throw new Error(connectionProblem)

      log.info(`── 开始发布 ${project.appId} ──`)
      log.debug(`项目配置：source=${project.source} cwd=${project.cwd} upload=${project.upload} entry=${project.entry}`)

      // ① 生成版本号：Date.now()（安全整数校验）；跨端冲突由服务端重复版本拒绝兜底
      const version = safeVersion(services.now?.() ?? Date.now())
      const publicRoot = settings.publicBaseUrl.replace(/\/+$/, '')
      const assetBase = `${publicRoot}/${project.appId}/${version}/`
      log.info(`版本号：${version}`)

      // ③ 执行发布前脚本：注入 GOLIVE_* 环境变量、日志脱敏后实时转发；非零退出即终止
      if (project.script.trim()) {
        active.stage = 'build'
        emit({ stage: 'build', message: '正在执行发布前脚本…' })
        log.info(`① 执行发布前脚本（${project.script.trim().split('\n')[0]}）`)
        log.debug(`注入环境变量：GOLIVE_APP_ID=${project.appId} GOLIVE_VERSION=${version} GOLIVE_ASSET_BASE=${assetBase}`)
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
          log.info('✓ 脚本退出码 0')
        } finally {
          active.killScript = undefined
        }
        checkCancelled()
      }

      // ④ 扫描上传内容：排除规则、入口校验、符号链接拒绝与资源引用校验都在 collectFiles 内完成
      emit({ stage: 'prepare', message: '正在扫描上传内容…' })
      log.info('② 扫描上传内容…')
      const { files, entryKey } = await collectFiles(project)
      const total = files.length
      log.debug(`扫描完成：${total} 个文件`)
      emit({ stage: 'upload', message: '准备上传…', done: 0, total })

      // ⑤ 直传清单：文件按原始路径上传（键 = 应用/版本/相对路径），
      //    资源正确性由构建期 $GOLIVE_ASSET_BASE 保证，引用校验已在 collectFiles 完成
      const inputs = files.map(file => ({ absolute: file.absolute, key: `${project.appId}/${version}/${file.key}` }))
      checkCancelled()

      // ⑥ 并发上传：任一文件失败即记下首个错误、停止派发新文件，且不进入登记
      active.stage = 'upload'
      log.info(`③ 开始上传 ${total} 个文件（并发 ${UPLOAD_CONCURRENCY}）`)
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
        const err = firstError as Error
        log.error(`✗ 上传失败：${err.message}（已完成 ${done}/${total}）`)
        throw new Error(`有文件上传失败（已完成 ${done}/${total}）：${err.message}。本次发布已停止，未登记新版本。`)
      }
      log.info(`✓ 上传完成 ${done}/${total}`)

      // ⑦ 登记发布：无此 id 则新建（domain 生效），有则追加版本（服务端忽略 domain）
      active.stage = 'deploy'
      const ossIndexUrl = assetUrl(publicRoot, `${project.appId}/${version}/${entryKey}`)
      emit({ stage: 'deploy', message: '正在登记发布…' })
      log.info('④ 登记发布（deploy）')
      log.debug(`deploy payload: id=${project.appId} version=${version} ossIndexUrl=${ossIndexUrl} domain=${project.domain}`)
      const payload = {
        id: project.appId,
        version,
        ossIndexUrl,
        domain: project.domain,
        note: project.note || undefined
      }
      // 确认兜底：deploy 网络失败时服务端可能已写入。带退避重查 app/get，
      // 版本与入口 URL 都一致才能认定“登记已保存”
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
        // 网络失败 → 先复核；确认成功按成功处理，否则返回“结果待确认”，不自动重发
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
      // 校验响应确实对应本次发布（id/版本/入口一致），防止把别的记录误当成功
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
      log.info(`✓ 发布成功 —— ${url}`)
      return { status: 'published', url, version, ossIndexUrl }
    } catch (error) {
      // 取消是正常结果之一；资源引用校验失败以 failed 结果返回（不走 reject），
      // 供界面展示针对性修复引导（可复制的 Prompt）
      if (error instanceof CancelledError) {
        emit({ stage: 'cancelled', message: '已取消' })
        log.info('用户取消发布')
        return { status: 'cancelled' }
      }
      if (error instanceof AssetRefError) {
        emit({ stage: 'error', message: error.message })
        log.error(`✗ 资源引用校验失败：${error.message}`)
        return { status: 'failed', code: 'asset-base', message: error.message }
      }
      emit({ stage: 'error', message: (error as Error).message })
      log.error(`✗ 发布失败：${(error as Error).message}`)
      throw error
    } finally {
      // 无论成败都释放任务锁
      active = null
    }
  }

  return { publish, cancel, isBusy: () => active !== null }
}
