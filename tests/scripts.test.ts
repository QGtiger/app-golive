import test from 'node:test'
import assert from 'node:assert/strict'
import { CancelledError } from '@golive/core'
import { redact, nodeScriptRunner } from '../apps/desktop/src/main/scripts'

test('redact 隐藏凭据片段', () => {
  assert.equal(redact('token=abc123 and abc123', ['abc123']), 'token=******** and ********')
  assert.equal(redact('short ok', ['abc']), 'short ok')
})

test('脚本成功正常退出并输出日志', async () => {
  const chunks: string[] = []
  const run = nodeScriptRunner.run({
    script: 'echo hello-golive',
    cwd: process.cwd(),
    env: {},
    secrets: [],
    onLog: chunk => chunks.push(chunk)
  })
  await run.done
  assert.ok(chunks.join('').includes('hello-golive'))
})

test('脚本非零退出码向上传递', async () => {
  const run = nodeScriptRunner.run({ script: 'exit 3', cwd: process.cwd(), env: {}, secrets: [], onLog: () => {} })
  await assert.rejects(run.done, /退出码 3/)
})

test('取消脚本终止进程并标记取消', async () => {
  const run = nodeScriptRunner.run({ script: 'sleep 30', cwd: process.cwd(), env: {}, secrets: [], onLog: () => {} })
  run.cancel()
  await assert.rejects(run.done, (error: unknown) => error instanceof CancelledError)
})

test('多行命令在前一条失败时停止后续执行', async () => {
  const chunks: string[] = []
  const run = nodeScriptRunner.run({
    script: 'echo first\necho will-not-run-after-false\nfalse\necho after-failure',
    cwd: process.cwd(),
    env: {},
    secrets: [],
    onLog: chunk => chunks.push(chunk)
  })
  await assert.rejects(run.done, /退出码 1/)
  const log = chunks.join('')
  assert.ok(log.includes('first'))
  assert.ok(!log.includes('after-failure'))
})
