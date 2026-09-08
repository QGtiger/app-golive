import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, unwrapGatewayResponse } from '../apps/desktop/src/main/gateway'

test('成功响应解包 { success, data } 信封', () => {
  const { status, json } = unwrapGatewayResponse(
    { success: true, data: { id: 'my-app', currentVersion: 4, ossIndexUrl: 'https://x/index.html' } },
    200
  )
  assert.equal(status, 200)
  assert.deepEqual(json, { id: 'my-app', currentVersion: 4, ossIndexUrl: 'https://x/index.html' })
})

test('业务错误为 HTTP 200 + success:false，状态码取信封 code、消息透传', () => {
  assert.throws(
    () => unwrapGatewayResponse({ success: false, code: 404, message: '未找到 app: my-app' }, 200),
    (error: unknown) => error instanceof ApiError && error.status === 404 && error.message === '未找到 app: my-app'
  )
})

test('非 2xx 且无信封时回退 HTTP 状态码', () => {
  assert.throws(
    () => unwrapGatewayResponse('Internal Server Error', 500),
    (error: unknown) => error instanceof ApiError && error.status === 500 && error.message.includes('网关返回 500')
  )
})

test('无信封的裸数据原样返回', () => {
  const raw = { id: 'my-app', currentVersion: 1, ossIndexUrl: 'https://x/index.html' }
  const { json } = unwrapGatewayResponse(raw, 200)
  assert.deepEqual(json, raw)
})
