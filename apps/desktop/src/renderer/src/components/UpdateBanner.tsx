/**
 * 自动更新横幅：全局挂载在根布局，检测到新版本时显示。
 * 开发模式不显示（api.onUpdateStatus 不会触发）。
 *
 * 状态流转：
 * checking → available（显示下载按钮）→ downloading（显示进度）→ downloaded（显示安装按钮）
 */
import { useEffect, useState } from 'react'
import { Download, Rocket } from 'lucide-react'
import { api } from '../api'

type UpdateState =
  | { kind: 'hidden' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'downloaded'; version: string }

export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ kind: 'hidden' })

  useEffect(() => {
    const unsubs = [
      api.onUpdateStatus((status: string, info?: { version: string; releaseDate: string }) => {
        if (status === 'available' && info) {
          setState({ kind: 'available', version: info.version })
        }
      }),
      api.onUpdateProgress((percent: number) => {
        setState(prev => (prev.kind === 'downloading' ? { kind: 'downloading', version: prev.version, percent } : { kind: 'downloading', version: '', percent }))
      }),
      api.onUpdateDownloaded((version: string) => {
        setState({ kind: 'downloaded', version })
      })
    ]
    return () => unsubs.forEach(fn => fn())
  }, [])

  if (state.kind === 'hidden') return null

  return (
    <div className="update-banner">
      {state.kind === 'available' && (
        <>
          <span>发现新版本 v{state.version}</span>
          <button className="link-btn" onClick={() => { void api.downloadUpdate() }}>
            <Download size={13} />
            下载
          </button>
        </>
      )}
      {state.kind === 'downloading' && (
        <div className="update-progress">
          <span className="label">正在下载 v{state.version}…</span>
          <div className="bar"><div className="fill" style={{ width: `${state.percent}%` }} /></div>
        </div>
      )}
      {state.kind === 'downloaded' && (
        <>
          <span>v{state.version} 已就绪</span>
          <button className="link-btn" onClick={() => { void api.installUpdate() }}>
            <Rocket size={13} />
            安装并重启
          </button>
        </>
      )}
    </div>
  )
}