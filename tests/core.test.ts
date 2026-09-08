import test from 'node:test'
import assert from 'node:assert/strict'
import { assetUrl, deployedUrl, httpUrl, safeVersion } from '@golive/core'

test('httpUrl 拒绝非 HTTP 与带凭据的地址', () => {
  assert.throws(() => httpUrl('ftp://example.com'))
  assert.throws(() => httpUrl('https://u:p@example.com'))
  assert.equal(httpUrl('https://example.com/x').protocol, 'https:')
})

test('assetUrl 保留对象层级并对片段编码', () => {
  assert.equal(assetUrl('https://static.example.com/', 'app/1/a b.js'), 'https://static.example.com/app/1/a%20b.js')
  assert.equal(assetUrl('https://static.example.com', 'app/1/index.html'), 'https://static.example.com/app/1/index.html')
})

test('safeVersion 单调递增且为安全整数', () => {
  assert.equal(safeVersion(1000, 1000), 1001)
  assert.equal(safeVersion(1000, 5), 1000)
  assert.equal(safeVersion(1000), 1000)
  assert.throws(() => safeVersion(Number.MAX_SAFE_INTEGER + 10))
})

test('deployedUrl 依据服务端记录生成访问地址', () => {
  const app = { id: 'a', domain: 'a.example.com', enable: true, currentVersion: 1, ossIndexUrl: 'https://x/a/1/index.html' }
  assert.equal(deployedUrl(app, 'https'), 'https://a.example.com/')
  assert.equal(deployedUrl({ ...app, path: 'v2/' }, 'https'), 'https://a.example.com/v2/')
  assert.throws(() => deployedUrl({ ...app, enable: false }, 'https'), /停用/)
  assert.throws(() => deployedUrl({ ...app, domain: undefined }, 'https'), /域名/)
})
