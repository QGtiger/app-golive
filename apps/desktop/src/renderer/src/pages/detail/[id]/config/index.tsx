/** 项目发布配置（/detail/:id/config）：编辑并保存当前项目的发布配置 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Folder } from 'lucide-react'
import { projectSchema, type Project } from '@golive/core'
import { api } from '../../../../api'
import { useProject } from '../model'

export default function ProjectConfigPage() {
  const { project, saveDraft } = useProject()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<Project | null>(project)
  const [error, setError] = useState<string | null>(null)

  if (!project?.id || !draft) return null
  const back = () => navigate(`/detail/${project.id}`)
  const set = (patch: Partial<Project>) => setDraft(prev => (prev ? { ...prev, ...patch } : prev))

  const pickDir = async (field: 'cwd' | 'upload') => {
    const path = await api.select('folder')
    if (path) set({ [field]: path } as Partial<Project>)
  }

  const save = () => {
    setError(null)
    try {
      const parsed = projectSchema.parse(draft)
      saveDraft(parsed).then(back, (reason: Error) => setError(reason.message))
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  const singleFile = draft.upload === draft.source

  return (
    <>
      <header className="header">
        <div className="back-row" style={{ padding: 0 }}>
          <button onClick={back}>
            <ChevronLeft size={17} />
            返回
          </button>
        </div>
        <span className="view-title">发布配置</span>
        <div style={{ width: 28 }} />
      </header>
      <div className="content">
        <div className="view-sub">配置会保存在本机，按项目路径记忆</div>
        {error && <div className="banner error">{error}</div>}

        <div className="field">
          <label>应用名称</label>
          <input type="text" value={draft.appId} onChange={event => set({ appId: event.target.value })} />
          <span className="note">修改应用名称会发布到另一个服务端应用，不是重命名原应用</span>
        </div>

        <div className="field">
          <label>发布前脚本（可选）</label>
          <textarea
            value={draft.script}
            placeholder="pnpm run build"
            onChange={event => set({ script: event.target.value })}
          />
          <span className="note">上传前在执行目录运行，多行命令按顺序执行，留空直接上传。构建需注入资源基址（如 vite build --base "$GOLIVE_ASSET_BASE"），否则资源引用校验会失败</span>
        </div>

        <div className="field">
          <label>执行目录</label>
          <div className="input-row">
            <input type="text" value={draft.cwd} onChange={event => set({ cwd: event.target.value })} />
            <button className="icon-btn" title="选择目录" onClick={() => void pickDir('cwd')}>
              <Folder size={16} />
            </button>
          </div>
        </div>

        <div className="field">
          <label>上传内容</label>
          <div className="input-row">
            <input type="text" value={draft.upload} onChange={event => set({ upload: event.target.value })} />
            {!singleFile && (
              <button className="icon-btn" title="选择目录" onClick={() => void pickDir('upload')}>
                <Folder size={16} />
              </button>
            )}
          </div>
          <span className="note">相对于执行目录的产物目录，或完整路径</span>
        </div>

        <div className="field">
          <label>入口文件</label>
          <input
            type="text"
            value={draft.entry}
            disabled={singleFile}
            onChange={event => set({ entry: event.target.value })}
          />
          <span className="note">{singleFile ? '单文件发布自动使用 index.html' : '上传目录内的 HTML 路径，可指向子目录'}</span>
        </div>

        <div className="field">
          <label>访问域名</label>
          <input type="text" value={draft.domain} onChange={event => set({ domain: event.target.value })} />
          <span className="note">新应用使用此域名；已有应用以服务端返回为准</span>
        </div>

        <div className="field">
          <label>发布备注（可选）</label>
          <input type="text" value={draft.note} onChange={event => set({ note: event.target.value })} />
        </div>
      </div>
      <div className="footer">
        <button className="btn" onClick={save}>保存配置</button>
      </div>
    </>
  )
}
