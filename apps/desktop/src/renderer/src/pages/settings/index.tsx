/** 全局设置页（/settings）：连接配置与凭据管理 */
import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { settingsSchema, type Settings } from '@golive/core'
import { useApp } from '../../appModel'

export default function SettingsPage() {
  const { settings, hint, persistSettings, dismissHint, goHome } = useApp()
  const [draft, setDraft] = useState<Settings | null>(settings)
  const [error, setError] = useState<string | null>(null)
  // 保存成功的即时反馈：按钮短暂变为“已保存”
  const [saved, setSaved] = useState(false)

  if (!settings || !draft) return null
  const set = (patch: Partial<Settings>) => setDraft(prev => (prev ? { ...prev, ...patch } : prev))

  const submit = () => {
    setError(null)
    try {
      const parsed = settingsSchema.parse(draft)
      persistSettings(parsed).then(
        () => {
          setSaved(true)
          window.setTimeout(() => setSaved(false), 2000)
        },
        (reason: Error) => setError(reason.message)
      )
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  return (
    <>
      <header className="header">
        <div className="back-row" style={{ padding: 0 }}>
          <button
            onClick={() => {
              dismissHint()
              goHome()
            }}
          >
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
          <input type="text" value={draft.accessKeySecret} onChange={event => set({ accessKeySecret: event.target.value })} />
          <span className="note">明文保存在本机 golive.json，与 AccessKey ID 一样可直接编辑</span>
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
      <div className="footer">
        <button className="btn" onClick={submit}>{saved ? '已保存 ✓' : '保存设置'}</button>
      </div>
    </>
  )
}
