import { spawn } from 'node:child_process'
import { CancelledError } from '@golive/core'

export const MAX_LOG_BYTES = 512 * 1024

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
    const shell = process.env.SHELL || '/bin/zsh'
    const child = spawn(shell, ['-l', '-e', '-c', script], {
      cwd,
      detached: true,
      env: { ...process.env, ...env }
    })
    let cancelled = false
    let total = 0
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
    const cancel = () => {
      if (child.exitCode !== null) return
      cancelled = true
      stop('SIGTERM')
      killer = setTimeout(() => stop('SIGKILL'), 3000)
      killer.unref()
    }
    const done = new Promise<void>((resolve, reject) => {
      child.on('error', reject)
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
