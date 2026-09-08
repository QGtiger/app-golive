import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import type { Settings } from '@golive/core'
import { settingsSchema } from '@golive/core'
import { api } from '../api'

interface SettingsProps {
  settings: Settings
  hasSecrets: boolean
  hint: string | null
  onBack(): void
  onSave(next: Settings): void
  onCleared(): void
}

export function SettingsView({ settings, hasSecrets, hint, onBack, onSave, onCleared }: SettingsProps) {
  const [draft, setDraft] = useState<Settings>(settings)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<Settings>) => setDraft(prev => ({ ...prev, ...patch }))

  const submit = (options?: { clearSecrets?: boolean }) => {
    setError(null)
    try {
      const parsed = settingsSchema.parse(draft)
      void api
        .saveSettings(parsed, options)
        .then(() => {
          if (options?.clearSecrets) onCleared()
          onSave({ ...parsed, accessKeySecret: '', token: '' })
        }, (reason: Error) => setError(reason.message))
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  return (
    <>
      <header className="header">
        <div className="back-row" style={{ padding: 0 }}>
          <button onClick={onBack}>
            <ChevronLeft size={17} />
            返回
          </button>
        </div>
        <span className="view-title">全局设置</span>
        <div style={{ width: 28 }} />
      </header>
      <div className="content">
        {hint && <div className="banner info">{hint}</div>}
        {error && <div className="banner error">{error}</div>}

        <div className="field">
          <label>网关 API 基础地址</label>
          <input type="text" placeholder="https://gateway.example.com" value={draft.apiUrl} onChange={event => set({ apiUrl: event.target.value })} />
        </div>

        <div className="field">
          <label>OSS Region</label>
          <input type="text" placeholder="oss-cn-hangzhou" value={draft.region} onChange={event => set({ region: event.target.value })} />
        </div>

        <div className="field">
          <label>OSS Bucket</label>
          <input type="text" value={draft.bucket} onChange={event => set({ bucket: event.target.value })} />
        </div>

        <div className="field">
          <label>OSS AccessKey ID</label>
          <input type="text" value={draft.accessKeyId} onChange={event => set({ accessKeyId: event.target.value })} />
        </div>

        <div className="field">
          <label>OSS AccessKey Secret</label>
          <input
            type="password"
            placeholder={hasSecrets ? '已保存，留空保持不变' : ''}
            value={draft.accessKeySecret}
            onChange={event => set({ accessKeySecret: event.target.value })}
          />
          <span className="note">保存在系统安全存储中，不会回显</span>
        </div>

        <div className="field">
          <label>OSS/CDN 公共访问根地址</label>
          <input type="text" placeholder="https://static.example.com" value={draft.publicBaseUrl} onChange={event => set({ publicBaseUrl: event.target.value })} />
        </div>

        <div className="field">
          <label>默认域名后缀</label>
          <input type="text" value={draft.domainSuffix} onChange={event => set({ domainSuffix: event.target.value })} />
          <span className="note">为新项目建议访问域名</span>
        </div>

        <div className="field">
          <label>访问协议</label>
          <select value={draft.protocol} onChange={event => set({ protocol: event.target.value as Settings['protocol'] })}>
            <option value="https">HTTPS</option>
            <option value="http">HTTP（本地/测试环境）</option>
          </select>
        </div>
      </div>
      <div className="footer stack">
        <button className="btn" onClick={() => submit()}>保存设置</button>
        {hasSecrets && (
          <button className="btn danger-ghost" onClick={() => submit({ clearSecrets: true })}>清除凭据</button>
        )}
      </div>
    </>
  )
}
