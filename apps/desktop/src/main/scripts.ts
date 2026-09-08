/**
 * 发布前脚本执行：在主进程中用用户系统 shell 运行多行命令。
 * 只有 publish 流程会调用；拖入与项目检测不会执行任何项目代码（PRODUCT §7.1）。
 */
import { spawn } from 'node:child_process'
import { CancelledError } from '@golive/core'

// 单次发布日志总量上限，超出即截断，防止海量构建输出拖垮 IPC 与内存
export const MAX_LOG_BYTES = 512 * 1024

/** 把凭据片段替换为 ********；脚本 stdout/stderr 转发前必须经过这里 */
export function redact(text: string, secrets: string[]): string {
  let out = text
  for (const secret of secrets) {
    if (secret && secret.length > 3) out = out.split(secret).join('********')
  }
  return out
}

export interface ScriptRunner {
  run(options: {
    script: string
    cwd: string
    env: Record<string, string>
    secrets: string[]
    onLog: (chunk: string) => void
  }): { done: Promise<void>; cancel: () => void }
}

export const nodeScriptRunner: ScriptRunner = {
  run({ script, cwd, env, secrets, onLog }) {
    // 登录 shell（-l）会加载用户 profile，缓解 macOS 图形界面启动时
    // PATH 与终端不一致、找不到 node/pnpm 的问题
    const shell = process.env.SHELL || '/bin/zsh'
    // detached + 进程组：取消时用 kill(-pid) 终止整棵进程树
    // （npm/pnpm run 会再派生子进程，只 kill 直接子进程会留下孤儿构建）
    const child = spawn(shell, ['-l', '-e', '-c', script], {
      cwd,
      detached: true,
      env: { ...process.env, ...env }
    })
    let cancelled = false
    let total = 0
    // 日志限流：超过总量上限后不再转发，只提示一次截断
    const forward = (chunk: Buffer) => {
      total += chunk.length
      const text = total > MAX_LOG_BYTES ? '' : chunk.toString('utf8')
      if (total > MAX_LOG_BYTES) {
        if (total - chunk.length <= MAX_LOG_BYTES) onLog('\n[日志过长，后续输出已截断]\n')
      } else {
        onLog(redact(text, secrets))
      }
    }
    child.stdout.on('data', forward)
    child.stderr.on('data', forward)
    let killer: NodeJS.Timeout | undefined
    const stop = (signal: NodeJS.Signals) => {
      try {
        process.kill(-child.pid!, signal)
      } catch {
        child.kill(signal)
      }
    }
    // 取消：先向整个进程组发 SIGTERM，3s 后仍未退出则升级 SIGKILL
    const cancel = () => {
      if (child.exitCode !== null) return
      cancelled = true
      stop('SIGTERM')
      killer = setTimeout(() => stop('SIGKILL'), 3000)
      killer.unref()
    }
    const done = new Promise<void>((resolve, reject) => {
      child.on('error', reject)
      // 退出码 0 = 成功；被取消抛 CancelledError；其余按失败处理并带上退出码
      child.on('close', (code) => {
        if (killer) clearTimeout(killer)
        if (cancelled) reject(new CancelledError())
        else if (code === 0) resolve()
        else reject(new Error(`脚本执行失败，退出码 ${code ?? 'null'}`))
      })
    })
    return { done, cancel }
  }
}
