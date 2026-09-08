/**
 * 项目维度 model：/detail/:id 的发布状态机与动作。
 * 挂载于本目录 layout；发布期间锁定导航，页内状态不会因切页丢失。
 *
 * publish 由 useRequest 承载（loading / onError）；
 * 进度事件（onProgress 全局广播）与阶段/日志由订阅驱动，两条线在本 model 汇合。
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { createCustomModel } from '@lightfish/react-model'
import { useMemoizedFn, useRequest } from 'ahooks'
import type { Progress, Project, PublishOutcome, Stage } from '@golive/core'
import { api, connectionIncomplete } from '../../../api'
import { useApp } from '../../../appModel'

// 与主进程 Progress.stage 对应的界面阶段条（build 仅在有脚本时展示）
export const stageLabels: Array<[Stage, string]> = [
  ['prepare', '检查配置'],
  ['build', '执行脚本'],
  ['upload', '上传文件'],
  ['deploy', '登记发布']
]

export type PublishState =
  | { kind: 'idle' }
  | { kind: 'running'; stage: string; message: string; done?: number; total?: number; logs: string[] }
  | { kind: 'published'; url: string }
  | { kind: 'failed'; code?: string; message: string; logs: string[] }
  | { kind: 'cancelled'; logs: string[] }
  | { kind: 'uncertain'; outcome: { version: number; ossIndexUrl: string; message: string }; logs: string[] }

export interface ProjectModel {
  project: Project | null
  publishState: PublishState
  /** 本项目是否正在发布（阶段条/日志/取消按钮的依据） */
  isPublishing: boolean
  /** 其他项目有发布任务进行中（本页发布按钮需禁用，主进程单任务锁兜底） */
  lockedByOther: boolean
  publish(): void
  cancelPublish(): void
  saveDraft(draft: Project): Promise<void>
}

function useProjectModel(): ProjectModel {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { projects, settings, activePublishProjectId, setActivePublishProjectId, openSettings, refreshProjects } = useApp()
  const project = projects.find(p => p.id === id) ?? null

  const [publishState, setPublishState] = useState<PublishState>({ kind: 'idle' })

  // 全局 progress 广播归到本项目；非 running 态直接忽略（保留终态不被覆盖）
  useEffect(() => api.onProgress((progress: Progress) => {
    setPublishState(prev => {
      if (prev.kind !== 'running') return prev
      return {
        ...prev,
        stage: progress.stage,
        message: progress.message,
        done: progress.done,
        total: progress.total,
        logs: progress.log ? [...prev.logs, progress.log] : prev.logs
      }
    })
  }), [])

  // 卸载时注销活动发布标记（终态回调里已注销，这里是切页兜底）
  useEffect(() => () => setActivePublishProjectId(null), [setActivePublishProjectId])

  const publishRequest = useRequest((): Promise<PublishOutcome> => {
    if (!project) return Promise.reject(new Error('项目不存在或已删除'))
    return api.publish(project)
  }, {
    manual: true,
    onSuccess: outcome => {
      setActivePublishProjectId(null)
      if (outcome.status === 'published') {
        setPublishState({ kind: 'published', url: outcome.url })
        void refreshProjects()
      } else if (outcome.status === 'failed') {
        // 确定性失败（如资源引用校验）：不走 reject，由 onSuccess 处理
        setPublishState(prev => ({ kind: 'failed', code: outcome.code, message: outcome.message, logs: prev.kind === 'running' ? prev.logs : [] }))
      } else if (outcome.status === 'uncertain') {
        // 结果待确认：保留运行日志供诊断，不自动重发
        setPublishState(prev => ({ kind: 'uncertain', outcome, logs: prev.kind === 'running' ? prev.logs : [] }))
      } else {
        setPublishState({ kind: 'cancelled', logs: [] })
      }
    },
    onError: error => {
      setActivePublishProjectId(null)
      setPublishState(prev => ({ kind: 'failed', message: error.message, logs: prev.kind === 'running' ? prev.logs : [] }))
    }
  })

  const publish = useMemoizedFn(() => {
    if (!project?.id || !settings) return
    // 未完成连接配置：不执行脚本，直接引导去设置页
    if (connectionIncomplete(settings)) {
      openSettings(true)
      return
    }
    setPublishState({ kind: 'running', stage: 'prepare', message: '正在准备发布…', logs: [] })
    setActivePublishProjectId(project.id)
    publishRequest.run()
  })

  const cancelPublish = useMemoizedFn(() => void api.cancel())

  // 保存发布配置（入参已经过页面侧 zod 校验），刷新全局列表让详情页读到新值
  const saveDraft = useMemoizedFn(async (draft: Project) => {
    await api.saveProject(draft)
    await refreshProjects()
  })

  return {
    project,
    publishState,
    isPublishing: project?.id != null && activePublishProjectId === project.id,
    lockedByOther: activePublishProjectId != null && activePublishProjectId !== project?.id,
    publish,
    cancelPublish,
    saveDraft
  }
}

// hook 无参数 → Provider 不需要 value；useProject 在 Provider 外调用会抛错
export const { Provider: ProjectModelProvider, useModel: useProject } = createCustomModel(useProjectModel)
