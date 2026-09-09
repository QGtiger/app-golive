/**
 * 统一日志模块：封装 electron-log，落盘到 ~/Library/Logs/GoLive/main.log。
 * 最大 1MB，自动轮转（main.log → main.old.log）。
 *
 * 使用约定：
 * - info：关键节点（启动、发布开始/完成、更新检查）
 * - warn：非致命异常（保存失败、脚本超时、结果待确认）
 * - error：失败（发布报错、更新失败、OSS 错误）
 * - debug：调试细节（仅开发模式，生产环境抑制）
 */
import log from 'electron-log'

// 开发模式判断：测试环境（无 app）或未打包均为开发模式
const isDev = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron')
    return !app.isPackaged
  } catch {
    return true
  }
})()

// 脱敏：凭据只显示前 4 位
function maskSecret(value: string): string {
  return value ? `${value.slice(0, 4)}***` : '(空)'
}

// 发布日志脱敏：替换凭据片段
function redactLine(line: string, secrets: string[]): string {
  let result = line
  for (const secret of secrets) {
    if (secret) result = result.replaceAll(secret, `${secret.slice(0, 4)}***`)
  }
  return result
}

export { log, maskSecret, redactLine }

// 仅在开发模式下输出 debug 日志
if (!isDev) {
  log.transports.console.level = 'info'
}