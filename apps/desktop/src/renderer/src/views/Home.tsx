import { useState } from 'react'
import { ChevronRight, FileCode, Folder, FolderOpen, Settings as SettingsIcon } from 'lucide-react'
import type { Project } from '@golive/core'
import { api } from '../api'

export type PublishState =
  | { kind: 'idle' }
  | { kind: 'running'; stage: string; message: string; done?: number; total?: number; logs: string[] }
  | { kind: 'failed'; message: string; logs: string[] }
  | { kind: 'cancelled'; logs: string[] }
  | { kind: 'uncertain'; outcome: { version: number; ossIndexUrl: string; message: string }; logs: string[] }

interface HomeProps {
  projects: Project[]
  project: Project | null
  state: PublishState
  notice: string | null
  stageLabels: Array<[string, string]>
  onPick(kind: 'folder' | 'html'): void
  onFiles(files: File[]): void
  onOpenConfig(): void
  onOpenSettings(): void
  onPublish(): void
  onCancel(): void
  onReset(clearProject?: boolean): void
  onRecent(project: Project): void
  onCopy(text: string): void
}

export function HomeView(props: HomeProps) {
  const { projects, project, state, notice, stageLabels } = props
  const [over, setOver] = useState(false)

  const running = state.kind === 'running'
  const terminal = state.kind === 'failed' || state.kind === 'cancelled' || state.kind === 'uncertain'
  const showPublishUI = running || terminal

  const stages = (() => {
    const labels = stageLabels.filter(([stage]) => stage !== 'build' || Boolean(project?.script.trim()))
    const currentIndex = labels.findIndex(([stage]) => stage === (state.kind === 'running' ? state.stage : null))
    return labels.map(([stage, label], index) => ({
      stage,
      label,
      status: currentIndex < 0 ? 'pending' : index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'pending'
    }))
  })()

  const uploadLine = state.kind === 'running' && state.stage === 'upload' && state.total ? `已完成 ${state.done ?? 0} / ${state.total} 个文件` : null

  return (
    <>
      <header className="header">
        <div style={{ width: 28 }} />
        <h1>GoLive</h1>
        <button className="icon-btn" title="全局设置" onClick={props.onOpenSettings}>
          <SettingsIcon size={17} />
        </button>
      </header>
      <div className="content">
        {notice && <div className="banner warn">{notice}</div>}

        {!project && !showPublishUI && (
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
                props.onFiles(Array.from(event.dataTransfer.files))
              }}
            >
              <FolderOpen size={40} strokeWidth={1.4} color="#98a2b3" />
              <div>拖入项目、文件夹或 HTML</div>
              <div className="pickers">
                <button className="link-btn" onClick={() => props.onPick('folder')}>选择文件夹</button>
                <button className="link-btn" onClick={() => props.onPick('html')}>选择 HTML</button>
              </div>
            </div>
            <div className="view-sub" style={{ textAlign: 'center' }}>源码项目填构建脚本，成品页面留空即可</div>
            {projects.length > 0 && (
              <>
                <div className="section-title">最近项目</div>
                <div className="card">
                  {projects.slice(0, 5).map(item => (
                    <button key={item.source} className="recent-item" onClick={() => props.onRecent(item)}>
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

        {project && !showPublishUI && (
          <>
            <div className="card">
              <button className="card-row" onClick={props.onOpenConfig}>
                <Folder size={18} color="#246bfd" />
                <span className="grow">
                  <div className="title">{project.appId}</div>
                  <div className="sub">{project.source}</div>
                </span>
                <ChevronRight size={16} />
              </button>
              <button className="card-row" onClick={props.onOpenConfig}>
                <FileCode size={16} />
                <span className="label">发布前执行</span>
                <span className="value grow" style={{ textAlign: 'right' }}>{project.script.trim() || '直接上传'}</span>
                <ChevronRight size={15} />
              </button>
              <button className="card-row" onClick={props.onOpenConfig}>
                <Folder size={16} />
                <span className="label">上传内容</span>
                <span className="value grow" style={{ textAlign: 'right' }}>{project.upload}{project.upload === project.source ? '' : '/'}</span>
                <ChevronRight size={15} />
              </button>
              <button className="card-row" onClick={props.onOpenConfig}>
                <SettingsIcon size={15} />
                <span className="grow" style={{ fontWeight: 600 }}>发布配置</span>
                <ChevronRight size={15} />
              </button>
            </div>
          </>
        )}

        {showPublishUI && project && (
          <>
            <div className="card">
              <div className="card-row">
                <Folder size={18} color="#246bfd" />
                <span className="grow">
                  <div className="title">{project.appId}</div>
                  <div className="sub">{project.source}</div>
                </span>
              </div>
            </div>
            <div className="card" style={{ padding: '6px 8px' }}>
              <div className="stages">
                {stages.map(item => (
                  <div key={item.stage} className={`stage ${item.status}`}>
                    <span className="dot">
                      {item.status === 'done' ? '✓' : ''}
                    </span>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
              {uploadLine && <div className="progress-line">{uploadLine}</div>}
            </div>
            {state.kind === 'running' && state.logs.length > 0 && (
              <details className="log">
                <summary>运行日志</summary>
                <div className="log-box">{state.logs.join('')}</div>
              </details>
            )}
            {state.kind === 'failed' && (
              <>
                <div className="banner error">{state.message}</div>
                <details className="log" open>
                  <summary>运行日志</summary>
                  <div className="log-box">{state.logs.join('') || '（无输出）'}</div>
                </details>
              </>
            )}
            {state.kind === 'cancelled' && <div className="banner info">已取消。已上传的临时版本文件可能保留，远端未登记新版本。</div>}
            {state.kind === 'uncertain' && (
              <>
                <div className="banner warn">{state.outcome.message}</div>
                <button
                  className="btn ghost"
                  onClick={() =>
                    props.onCopy(
                      `version: ${state.outcome.version}\nossIndexUrl: ${state.outcome.ossIndexUrl}\n${state.outcome.message}`
                    )
                  }
                >
                  复制诊断信息
                </button>
              </>
            )}
          </>
        )}
      </div>
      <div className="footer">
        {!showPublishUI && (
          <button className="btn" disabled={!project || running} onClick={props.onPublish}>
            一键发布
          </button>
        )}
        {running && (
          <button className="btn secondary" disabled={state.stage === 'deploy'} onClick={props.onCancel}>
            {state.stage === 'deploy' ? '正在确认发布结果…' : '取消发布'}
          </button>
        )}
        {state.kind === 'failed' && (
          <div className="stack">
            <button className="btn" onClick={props.onPublish}>重试发布</button>
            <button className="btn ghost" onClick={() => props.onReset()}>返回选择</button>
          </div>
        )}
        {state.kind === 'cancelled' && (
          <div className="stack">
            <button className="btn" onClick={props.onPublish}>再次发布</button>
            <button className="btn ghost" onClick={() => props.onReset(true)}>更换项目</button>
          </div>
        )}
        {state.kind === 'uncertain' && (
          <button className="btn ghost" onClick={() => props.onReset()}>返回选择</button>
        )}
      </div>
    </>
  )
}
