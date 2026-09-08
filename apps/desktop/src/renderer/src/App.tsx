import { useCallback, useEffect, useRef, useState } from 'react'
import type { Progress, Project, PublishOutcome, Settings, Stage } from '@golive/core'
import { api, connectionIncomplete } from './api'
import { HomeView, type PublishState } from './views/Home'
import { ConfigView } from './views/Config'
import { SuccessView } from './views/Success'
import { SettingsView } from './views/Settings'

type View = 'home' | 'config' | 'success' | 'settings'

interface LastResult {
  url: string
  appId: string
}

const stageLabels: Array<[Stage, string]> = [
  ['prepare', '检查配置'],
  ['build', '执行脚本'],
  ['upload', '上传文件'],
  ['deploy', '登记发布']
]

export default function App() {
  const [view, setView] = useState<View>('home')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [hasSecrets, setHasSecrets] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [publishState, setPublishState] = useState<PublishState>({ kind: 'idle' })
  const [lastResult, setLastResult] = useState<LastResult | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const settingsHint = useRef(false)

  useEffect(() => {
    void api.load().then(state => {
      setSettings(state.settings)
      setHasSecrets(state.hasSecrets)
      setProjects(state.projects)
    })
  }, [])

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

  const refreshProjects = useCallback(() => {
    void api.load().then(state => {
      setProjects(state.projects)
      setHasSecrets(state.hasSecrets)
    })
  }, [])

  const pickSource = useCallback(async (kind: 'folder' | 'html') => {
    setNotice(null)
    const path = await api.select(kind)
    if (!path) return
    try {
      setProject(await api.inspect(path))
    } catch (error) {
      setNotice((error as Error).message)
    }
  }, [])

  const dropFiles = useCallback(async (files: File[]) => {
    setNotice(null)
    if (!files.length) return
    try {
      const path = api.pathForFile(files[0])
      setProject(await api.inspect(path))
    } catch (error) {
      setNotice((error as Error).message)
    }
  }, [])

  const publish = useCallback(async () => {
    if (!project || !settings) return
    if (connectionIncomplete(settings)) {
      settingsHint.current = true
      setNotice('发布前需要完成全局连接配置')
      setView('settings')
      return
    }
    setNotice(null)
    setPublishState({ kind: 'running', stage: 'prepare', message: '正在准备发布…', logs: [] })
    try {
      const outcome: PublishOutcome = await api.publish(project)
      if (outcome.status === 'published') {
        setLastResult({ url: outcome.url, appId: project.appId })
        setView('success')
        refreshProjects()
      } else if (outcome.status === 'uncertain') {
        setPublishState({ kind: 'uncertain', outcome, logs: [] })
      } else {
        setPublishState({ kind: 'cancelled', logs: [] })
      }
    } catch (error) {
      setPublishState(prev => ({ kind: 'failed', message: (error as Error).message, logs: prev.kind === 'running' ? prev.logs : [] }))
    }
  }, [project, settings, refreshProjects])

  const resetToHome = useCallback((clearProject = false) => {
    setPublishState({ kind: 'idle' })
    if (clearProject) setProject(null)
    setView('home')
    refreshProjects()
  }, [refreshProjects])

  if (!settings) return null

  return (
    <div className="app">
      {view === 'home' && (
        <HomeView
          projects={projects}
          project={project}
          state={publishState}
          notice={notice}
          stageLabels={stageLabels}
          onPick={pickSource}
          onFiles={dropFiles}
          onOpenConfig={() => setView('config')}
          onOpenSettings={() => {
            settingsHint.current = false
            setView('settings')
          }}
          onPublish={publish}
          onCancel={() => void api.cancel()}
          onReset={resetToHome}
          onRecent={setProject}
          onCopy={text => void api.copy(text)}
        />
      )}
      {view === 'config' && project && (
        <ConfigView
          project={project}
          onBack={() => setView('home')}
          onSave={draft => {
            setProject(draft)
            setView('home')
            refreshProjects()
          }}
        />
      )}
      {view === 'success' && lastResult && (
        <SuccessView
          url={lastResult.url}
          appId={lastResult.appId}
          onCopy={() => void api.copy(lastResult.url)}
          onOpen={() => void api.open(lastResult.url)}
          onRepublish={() => {
            setPublishState({ kind: 'running', stage: 'prepare', message: '正在准备发布…', logs: [] })
            setView('home')
            void publish()
          }}
          onChange={() => resetToHome(true)}
        />
      )}
      {view === 'settings' && (
        <SettingsView
          settings={settings}
          hasSecrets={hasSecrets}
          hint={settingsHint.current ? '完成连接配置后即可发布' : null}
          onBack={() => {
            settingsHint.current = false
            setView('home')
          }}
          onSave={next => {
            setSettings(next)
            settingsHint.current = false
            setView('home')
          }}
          onCleared={() => setHasSecrets(false)}
        />
      )}
    </div>
  )
}
