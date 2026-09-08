/**
 * 网关 API 客户端，对应服务端契约（docs/TECHNICAL.md §5）：
 * - POST /routers/app/get     查询应用；"未找到 app: <id>" 视为应用不存在
 * - POST /routers/app/deploy  登记发布，返回应用记录
 *
 * 网关有全局响应包装（已实测确认）：
 * - 成功：{ success: true, data: <payload> }
 * - 业务错误：HTTP 200 + { success: false, code: 404, message: "未找到 app: xxx" }
 */
import { httpUrl, appEntrySchema, type AppEntry, type DeployPayload, type Settings } from '@golive/core'

/** 网络层失败（超时/断网）：发布请求可能已送达，需走“结果确认”流程而非直接重试 */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NetworkError'
  }
}

/** 服务端明确返回的错误（含业务状态码）：视为确定性失败，不自动重试 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface GatewayClient {
  getApp(id: string): Promise<AppEntry | null>
  deploy(payload: DeployPayload): Promise<AppEntry>
}

// 单请求 15s 超时：超时抛 NetworkError，让发布流程进入结果确认而不是无限等待
const TIMEOUT_MS = 15000

function base(settings: Settings): string {
  return httpUrl(settings.apiUrl).href.replace(/\/$/, '')
}

function headers(): Record<string, string> {
  return { 'Content-Type': 'application/json' }
}

interface GatewayEnvelope {
  success?: boolean
  code?: number
  message?: string
  data?: unknown
}

/**
 * 解包网关响应：业务错误（HTTP 非 2xx 或 success:false，业务码取 envelope.code）抛 ApiError；
 * 成功时剥掉 { success, data } 信封，没有信封则原样返回。
 */
export function unwrapGatewayResponse(json: unknown, httpStatus: number): { status: number; json: unknown } {
  const envelope = json && typeof json === 'object' ? (json as GatewayEnvelope) : {}
  if (!json || httpStatus < 200 || httpStatus >= 300 || envelope.success === false) {
    const status = typeof envelope.code === 'number' ? envelope.code : httpStatus
    const message = envelope.message || `网关返回 ${httpStatus}`
    throw new ApiError(String(message), status)
  }
  const payload = envelope.data !== undefined ? envelope.data : json
  return { status: httpStatus, json: payload }
}

async function post(settings: Settings, path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  let response: Response
  try {
    response = await fetch(`${base(settings)}${path}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (error) {
    throw new NetworkError(`无法连接网关：${(error as Error).message}`)
  }
  const text = await response.text()
  let json: unknown = undefined
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    if (response.ok) throw new ApiError('网关返回了无法解析的响应', response.status)
  }
  return unwrapGatewayResponse(json, response.status)
}

// 用 zod 校验服务端响应结构；字段不符时带上具体差异，避免脏数据流入发布流程
function parseEntry(json: unknown, context: string): AppEntry {
  const parsed = appEntrySchema.safeParse(json)
  if (!parsed.success) {
    const detail = parsed.error.issues.map(issue => `${issue.path.join('.') || '(根)'} ${issue.message}`).join('；')
    throw new ApiError(`网关${context}响应格式不符合应用记录契约：${detail}`, 200)
  }
  return { ...parsed.data, enable: parsed.data.enable ?? true }
}

export function createGateway(settings: Settings): GatewayClient {
  return {
    async getApp(id) {
      const { json } = await post(settings, '/routers/app/get', { id })
      // 不能把所有 404 都当“应用不存在”：只有错误消息匹配服务端文案才是新应用，
      // 其余 404 说明 API 路径配置错误，直接报错提示
      try {
        return parseEntry(json, '查询')
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          if (error.message.includes(`未找到 app: ${id}`)) return null
          throw new ApiError(`网关路径可能配置错误：${error.message}`, 404)
        }
        throw error
      }
    },
    async deploy(payload) {
      // 服务端会拒绝重复版本号等冲突；错误通过 ApiError 原样上抛展示
      const { json } = await post(settings, '/routers/app/deploy', payload)
      return parseEntry(json, '发布')
    }
  }
}
