/** 首页（/）：选择入口 —— 拖入 / 选择 / 最近项目；发布进行中锁定并给出查看进度入口 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Folder, FolderOpen, Settings as SettingsIcon } from 'lucide-react'
import { useMemoizedFn } from 'ahooks'
import { api } from '../api'
import { useApp } from '../appModel'

export default function HomePage() {
  const { projects, activePublishProjectId, openSettings, notice, setNotice, addProject } = useApp()
  const navigate = useNavigate()
  const [over, setOver] = useState(false)

  const openSource = useMemoizedFn(async (source: string) => {
    setNotice(null)
    try {
      await addProject(source)
    } catch (error) {
      setNotice((error as Error).message)
    }
  })

  const pickSource = useMemoizedFn(async (kind: 'folder' | 'html') => {
    const path = await api.select(kind)
    if (path) void openSource(path)
  })

  const dropFiles = useMemoizedFn((files: File[]) => {
    if (files.length) void openSource(api.pathForFile(files[0]))
  })

  // 发布中锁定：隐藏选择入口，保留查看进度的入口
  const locked = activePublishProjectId !== null
  const running = projects.find(p => p.id === activePublishProjectId)
  const recents = projects.filter(p => p.id).slice(0, 5)

  return (
    <>
      <header className="header">
        <div style={{ width: 28 }} />
        <h1>GoLive</h1>
        <button className="icon-btn" title="全局设置" onClick={() => openSettings()}>
          <SettingsIcon size={17} />
        </button>
      </header>
      <div className="content">
        {notice && <div className="banner warn">{notice}</div>}

        {locked && (
          <div className="banner info">
            正在发布「{running?.appId ?? ''}」，已锁定项目选择。
            {running?.id && (
              <button className="link-btn" onClick={() => navigate(`/detail/${running.id}`)}>查看进度</button>
            )}
          </div>
        )}

        {!locked && (
          <>
            <div
              className={`dropzone${over ? ' over' : ''}`}
              onDragOver={event => {
                event.preventDefault()
                setOver(true)
              }}
              onDragLeave={() => setOver(false)}
              onDrop={event => {
                event.preventDefault()
                setOver(false)
                dropFiles(Array.from(event.dataTransfer.files))
              }}
            >
              <FolderOpen size={40} strokeWidth={1.4} color="#98a2b3" />
              <div>拖入项目、文件夹或 HTML</div>
              <div className="pickers">
                <button className="link-btn" onClick={() => pickSource('folder')}>选择文件夹</button>
                <button className="link-btn" onClick={() => pickSource('html')}>选择 HTML</button>
              </div>
            </div>
            <div className="view-sub" style={{ textAlign: 'center' }}>源码项目填构建脚本，成品页面留空即可</div>
            {recents.length > 0 && (
              <>
                <div className="section-title">最近项目</div>
                <div className="card">
                  {recents.map(item => (
                    <button key={item.id} className="recent-item" onClick={() => navigate(`/detail/${item.id}`)}>
                      <Folder size={17} color="#98a2b3" />
                      <span className="grow" style={{ flex: 1, minWidth: 0 }}>
                        <div className="name">{item.appId}</div>
                        <div className="path">{item.source}</div>
                      </span>
                      <ChevronRight size={15} color="#98a2b3" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}
