import { CheckCircle2 } from 'lucide-react'

interface SuccessProps {
  url: string
  appId: string
  onCopy(): void
  onOpen(): void
  onRepublish(): void
  onChange(): void
}

export function SuccessView({ url, appId, onCopy, onOpen, onRepublish, onChange }: SuccessProps) {
  return (
    <>
      <header className="header">
        <div style={{ width: 28 }} />
        <h1>GoLive</h1>
        <div style={{ width: 28 }} />
      </header>
      <div className="content">
        <div className="success-hero">
          <CheckCircle2 size={56} strokeWidth={1.6} color="#12b76a" />
          <h2>发布成功</h2>
          <div className="app-name">{appId}</div>
        </div>
        <div className="url-card">
          <div className="url-text">{url}</div>
          <button className="btn" onClick={onCopy}>复制链接</button>
          <button className="btn secondary" onClick={onOpen}>打开网站</button>
        </div>
      </div>
      <div className="footer stack">
        <button className="btn ghost" onClick={onRepublish}>再次发布</button>
        <button className="btn ghost" onClick={onChange}>更换项目</button>
      </div>
    </>
  )
}
