import { httpUrl, appEntrySchema, type AppEntry, type DeployPayload, type Settings } from '@golive/core'

export class NetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NetworkError'
  }
}

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

const TIMEOUT_MS = 15000

function base(settings: Settings): string {
  return httpUrl(settings.apiUrl).href.replace(/\/$/, '')
}

function headers(settings: Settings): Record<string, string> {
  const result: Record<string, string> = { 'Content-Type': 'application/json' }
  if (settings.token) result.Authorization = `Bearer ${settings.token}`
  return result
}

async function post(settings: Settings, path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  let response: Response
  try {
    response = await fetch(`${base(settings)}${path}`, {
      method: 'POST',
      headers: headers(settings),
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
  if (!response.ok) {
    const message =
      (json && typeof json === 'object' && 'message' in json && String((json as { message: unknown }).message)) ||
      `网关返回 ${response.status}`
    throw new ApiError(String(message), response.status)
  }
  return { status: response.status, json }
}

function parseEntry(json: unknown, context: string): AppEntry {
  const parsed = appEntrySchema.safeParse(json)
  if (!parsed.success) throw new ApiError(`网关${context}响应格式不符合应用记录契约`, 200)
  return { ...parsed.data, enable: parsed.data.enable ?? true }
}

export function createGateway(settings: Settings): GatewayClient {
  return {
    async getApp(id) {
      const { status, json } = await post(settings, '/routers/app/get', { id })
      if (status === 404) {
        const message = json && typeof json === 'object' && 'message' in json ? String((json as { message: unknown }).message) : ''
        if (message.includes(`未找到 app: ${id}`)) return null
        throw new ApiError(`网关路径可能配置错误：${message || `HTTP 404（${settings.apiUrl}/routers/app/get）`}`, 404)
      }
      return parseEntry(json, '查询')
    },
    async deploy(payload) {
      const { status, json } = await post(settings, '/routers/app/deploy', payload)
      if (status === 404) {
        const message = json && typeof json === 'object' && 'message' in json ? String((json as { message: unknown }).message) : ''
        throw new ApiError(`网关路径可能配置错误：${message || 'HTTP 404'}`, 404)
      }
      return parseEntry(json, '发布')
    }
  }
}
