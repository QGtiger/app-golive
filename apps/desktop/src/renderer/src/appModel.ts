/**
 * 全局应用状态 model（跨项目共享的域）：
 * - settings / 最近项目列表，加载与刷新共用一个 useRequest；
 * - activePublishProjectId：当前发布任务的项目 id，是导航锁定的唯一依据，
 *   由项目维度 model 在发布开始/结束时上报；
 * - 项目维度的发布状态机与动作见 pages/detail/[id]/model.ts。
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createCustomModel } from '@lightfish/react-model'
import { useMemoizedFn, useRequest } from 'ahooks'
import type { Project, Settings } from '@golive/core'
import { api } from './api'

export interface AppModel {
  /** 初始状态是否已从主进程加载完成 */
  ready: boolean
  /** 当前客户端版本号 */
  version: string
  settings: Settings | null
  projects: Project[]
  /** 有发布任务进行中时为该项目 id，否则 null */
  activePublishProjectId: string | null
  setActivePublishProjectId(id: string | null): void
  hint: string | null
  notice: string | null
  setNotice(notice: string | null): void
  goHome(): void
  openSettings(fromPublish?: boolean): void
  dismissHint(): void
  refreshProjects(): Promise<void>
  /** 统一的项目添加链路：识别 → 落盘 → 刷新 → 跳详情页；拖入/选择与 macOS open-file 共用 */
  addProject(source: string): Promise<Project | null>
  /** 删除本机项目记录（最近项目列表），不影响服务端应用 */
  removeProject(id: string): Promise<void>
  persistSettings(settings: Settings): Promise<void>
  copy(text: string): void
  openUrl(url: string): void
}

function useAppModel(): AppModel {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [activePublishProjectId, setActivePublishProjectId] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // 启动加载；refreshProjects 复用同一个请求实例
  const stateRequest = useRequest(api.load, {
    onSuccess: state => {
      setSettings(state.settings)
      setReady(true)
    }
  })

  const refreshProjects = useMemoizedFn(async () => {
    await stateRequest.refreshAsync()
  })

  // 删除本机项目记录并刷新列表
  const removeProject = useMemoizedFn(async (id: string) => {
    await api.removeProject(id)
    await refreshProjects()
  })

  // 统一的项目添加链路：识别 → 落盘（生成稳定 id）→ 刷新列表 → 跳详情页
  const addProject = useMemoizedFn(async (source: string): Promise<Project | null> => {
    const draft = await api.inspect(source)
    const saved = await api.saveProject(draft)
    await refreshProjects()
    if (saved.id) navigate(`/detail/${saved.id}`)
    return saved
  })

  // macOS：Dock 图标拖入 / 访达“打开方式”直接打开项目
  useEffect(() => api.onOpenPath(path => {
    setNotice(null)
    addProject(path).catch((error: Error) => setNotice(error.message))
  }), [addProject])

  const goHome = useMemoizedFn(() => navigate('/'))
  const openSettings = useMemoizedFn((fromPublish = false) => {
    // 由发布触发（连接配置不完整）时在设置页展示引导提示
    setHint(fromPublish ? '完成连接配置后即可发布' : null)
    navigate('/settings')
  })
  const dismissHint = useMemoizedFn(() => setHint(null))

  // 保存全局设置（凭据明文随表单整体落盘），成功后同步本地副本
  const persistSettings = useMemoizedFn(async (next: Settings) => {
    await api.saveSettings(next)
    setSettings(next)
  })

  const copy = useMemoizedFn((text: string) => void api.copy(text))
  const openUrl = useMemoizedFn((url: string) => void api.open(url))

  return {
    ready,
    version: stateRequest.data?.version ?? '0.0.0',
    settings,
    projects: stateRequest.data?.projects ?? [],
    activePublishProjectId,
    setActivePublishProjectId,
    hint,
    notice,
    setNotice,
    goHome,
    openSettings,
    dismissHint,
    refreshProjects,
    addProject,
    removeProject,
    persistSettings,
    copy,
    openUrl
  }
}

// hook 无参数 → Provider 不需要 value；useApp 在 Provider 外调用会抛错
export const { Provider: AppModelProvider, useModel: useApp } = createCustomModel(useAppModel)
