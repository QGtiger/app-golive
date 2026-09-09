/**
 * 自动更新横幅：检测到新版本时显示，点击跳转 GitHub Releases 页面手动下载。
 * 开发模式不显示。
 */
import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { api } from '../api'

export function UpdateBanner() {
  const [info, setInfo] = useState<{ version: string } | null>(null)

  useEffect(() => {
    const unsub = api.onUpdateStatus((status: string, info?: { version: string }) => {
      if (status === 'available' && info) setInfo(info)
    })
    return unsub
  }, [])

  if (!info) return null

  return (
    <div className="update-banner">
      <span>发现新版本 v{info.version}</span>
      <button className="link-btn" onClick={() => { void api.open('https://github.com/QGtiger/app-golive/releases') }}>
        <ExternalLink size={13} />
        前往下载
      </button>
    </div>
  )
}