/** 项目详情（/detail/:id）：配置摘要、一键发布、阶段进度与全部发布终态 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  ExternalLink,
  FileCode,
  Folder,
  MoreHorizontal,
  Settings as SettingsIcon,
  Trash2
} from 'lucide-react'
import { useApp } from '../../../appModel'
import { stageLabels, useProject } from './model'

export default function ProjectDetailPage() {
  const { goHome, openSettings, copy, openUrl, removeProject } = useApp()
  const navigate = useNavigate()
  const { project, publishState: state, isPublishing, lockedByOther, publish, cancelPublish } = useProject()
  // 两步确认：第一次点击进入待确认，再点一次执行删除；失焦自动复位
  const [armDelete, setArmDelete] = useState(false)
  // 项目卡片「···」操作菜单
  const [menuOpen, setMenuOpen] = useState(false)
  if (!project?.id) return null
  const openConfig = () => navigate(`/detail/${project.id}/config`)
  const doDelete = () => {
    setMenuOpen(false)
    setArmDelete(false)
    void removeProject(project.id!).then(goHome)
  }

  // 点击菜单外任意位置关闭并复位确认态
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest?.('[data-menu-root]')) {
        setMenuOpen(false)
        setArmDelete(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  const stages = (() => {
    const labels = stageLabels.filter(([stage]) => stage !== 'build' || Boolean(project.script.trim()))
    const currentIndex = labels.findIndex(([stage]) => stage === (state.kind === 'running' ? state.stage : null))
    return labels.map(([stage, label], index) => ({
      stage,
      label,
      status: currentIndex < 0 ? 'pending' : index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'pending'
    }))
  })()

  const uploadLine = state.kind === 'running' && state.stage === 'upload' && state.total ? `已完成 ${state.done ?? 0} / ${state.total} 个文件` : null

  // 资源基址修复 Prompt（供复制到 Code Agent 使用）
  const assetPrompt = `配置构建的 publicPath / base，使产物资源引用指向 OSS 而非根路径。客户端会注入 GOLIVE_ASSET_BASE 环境变量（值示例：https://static.example.com/${project.appId}/{version}/），请根据项目框架自行适配。`
  return (
    <>
      <header className="header">
        <div className="back-row" style={{ padding: 0 }}>
          <button onClick={goHome}>
            <ChevronLeft size={17} />
            返回
          </button>
        </div>
        <span className="view-title">{project.appId}</span>
        <button className="icon-btn" title="全局设置" onClick={() => openSettings()}>
          <SettingsIcon size={17} />
        </button>
      </header>
      <div className="content">
        {lockedByOther && <div className="banner info">有发布任务进行中，请等待完成后再发布</div>}

        <div className="card" style={{ flexShrink: 0 }}>
          <div className="card-row">
            <Folder size={18} color="#246bfd" />
            <span className="grow">
              <div className="title">{project.appId}</div>
              <div className="sub">{project.source}</div>
            </span>
            <button
              className="icon-btn"
              data-menu-root
              title="项目操作"
              disabled={isPublishing}
              onClick={() => {
                setArmDelete(false)
                setMenuOpen(value => !value)
              }}
            >
              <MoreHorizontal size={16} />
            </button>
          </div>
          {menuOpen && (
            <button
              className="card-row danger"
              data-menu-root
              onClick={armDelete ? doDelete : () => setArmDelete(true)}
            >
              <Trash2 size={15} />
              <span className="grow" style={{ fontWeight: armDelete ? 600 : 400 }}>
                {armDelete ? '再点一次，确认删除本机记录' : '删除本机记录'}
              </span>
            </button>
          )}
          {project.url && (
            <div className="card-row">
              <ExternalLink size={16} color="#12b76a" />
              <span className="grow">
                <div className="url-text" style={{ fontSize: 12, textAlign: 'left', fontWeight: 500 }}>{project.url}</div>
              </span>
              <button className="link-btn" onClick={() => copy(project.url!)}>复制</button>
              <button className="link-btn" onClick={() => openUrl(project.url!)}>打开</button>
            </div>
          )}
          <button className="card-row" disabled={isPublishing} onClick={openConfig}>
            <FileCode size={16} />
            <span className="label">发布前执行</span>
            <span className="value grow" style={{ textAlign: 'right' }}>{project.script.trim() || '直接上传'}</span>
            <ChevronRight size={15} />
          </button>
          <button className="card-row" disabled={isPublishing} onClick={openConfig}>
            <Folder size={16} />
            <span className="label">上传内容</span>
            <span className="value grow" style={{ textAlign: 'right' }}>{project.upload}{project.upload === project.source ? '' : '/'}</span>
            <ChevronRight size={15} />
          </button>
          <button className="card-row" disabled={isPublishing} onClick={openConfig}>
            <SettingsIcon size={15} />
            <span className="grow" style={{ fontWeight: 600 }}>发布配置</span>
            <ChevronRight size={15} />
          </button>
        </div>

        {state.kind === 'running' && (
          <>
            <div className="card" style={{ padding: '6px 8px' }}>
              <div className="stages">
                {stages.map(item => (
                  <div key={item.stage} className={`stage ${item.status}`}>
                    <span className="dot">{item.status === 'done' ? '✓' : ''}</span>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
              {uploadLine && <div className="progress-line">{uploadLine}</div>}
            </div>
            {state.logs.length > 0 && (
              <details className="log">
                <summary>运行日志</summary>
                <div className="log-box">{state.logs.join('')}</div>
              </details>
            )}
          </>
        )}

        {state.kind === 'published' && (
          <>
            <div className="success-hero">
              <CheckCircle2 size={56} strokeWidth={1.6} color="#12b76a" />
              <h2>发布成功</h2>
              <div className="app-name">{project.appId}</div>
            </div>
            <div className="url-card">
              <div className="url-text">{state.url}</div>
              <button className="btn" onClick={() => copy(state.url)}>复制链接</button>
              <button className="btn secondary" onClick={() => openUrl(state.url)}>打开网站</button>
            </div>
          </>
        )}

        {state.kind === 'failed' && (
          <>
            <div className="banner error">{state.message}</div>
            {state.code === 'asset-base' && (
              <div className="card prompt-card">
                <div className="prompt-header">
                  <Clipboard size={14} />
                  <span className="grow">修复 Prompt（可复制给 Code Agent）</span>
                  <button className="icon-btn" title="复制 Prompt" onClick={() => copy(assetPrompt)}>
                    <Clipboard size={14} />
                  </button>
                </div>
                <div className="prompt-box">{assetPrompt}</div>
              </div>
            )}
            <details className="log" open>
              <summary>运行日志</summary>
              <div className="log-box">{state.logs.join('') || '（无输出）'}</div>
            </details>
          </>
        )}

        {state.kind === 'cancelled' && (
          <div className="banner info">已取消。已上传的临时版本文件可能保留，远端未登记新版本。</div>
        )}

        {state.kind === 'uncertain' && (
          <>
            <div className="banner warn">
              <AlertTriangle size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              {state.outcome.message}
            </div>
            <button
              className="btn ghost"
              onClick={() =>
                copy(
                  `version: ${state.outcome.version}\nossIndexUrl: ${state.outcome.ossIndexUrl}\n${state.outcome.message}`
                )
              }
            >
              复制诊断信息
            </button>
          </>
        )}
      </div>
      <div className="footer">
        {(state.kind === 'idle' || state.kind === 'published') && (
          <button className="btn" disabled={lockedByOther || isPublishing} onClick={publish} title={lockedByOther ? '有发布任务进行中' : undefined}>
            {state.kind === 'published' ? '再次发布' : '一键发布'}
          </button>
        )}
        {state.kind === 'running' && (
          <button className="btn secondary" disabled={state.stage === 'deploy'} onClick={cancelPublish}>
            {state.stage === 'deploy' ? '正在确认发布结果…' : '取消发布'}
          </button>
        )}
        {state.kind === 'failed' && (
          <div className="stack">
            <button className="btn" onClick={publish}>重试发布</button>
            <button className="btn ghost" onClick={goHome}>返回选择</button>
          </div>
        )}
        {state.kind === 'cancelled' && (
          <div className="stack">
            <button className="btn" onClick={publish}>再次发布</button>
            <button className="btn ghost" onClick={goHome}>更换项目</button>
          </div>
        )}
        {state.kind === 'uncertain' && (
          <button className="btn ghost" onClick={goHome}>返回选择</button>
        )}
      </div>
    </>
  )
}
