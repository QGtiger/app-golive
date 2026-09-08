import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopAPI, Progress, Project, PublishOutcome, SaveSettingsOptions, Settings } from '@golive/core'

const api: DesktopAPI = {
  load: () => ipcRenderer.invoke('state:load'),
  select: kind => ipcRenderer.invoke('dialog:select', kind),
  inspect: source => ipcRenderer.invoke('project:inspect', source),
  pathForFile: file => webUtils.getPathForFile(file),
  saveProject: (project: Project) => ipcRenderer.invoke('project:save', project),
  saveSettings: (settings: Settings, options?: SaveSettingsOptions) => ipcRenderer.invoke('settings:save', settings, options),
  publish: (project: Project): Promise<PublishOutcome> => ipcRenderer.invoke('publish:start', project),
  cancel: () => ipcRenderer.invoke('publish:cancel'),
  open: url => ipcRenderer.invoke('util:open', url),
  copy: text => ipcRenderer.invoke('util:copy', text),
  onProgress: (callback: (progress: Progress) => void) => {
    const listener = (_event: unknown, progress: Progress) => callback(progress)
    ipcRenderer.on('publish:progress', listener)
    return () => ipcRenderer.removeListener('publish:progress', listener)
  }
}

contextBridge.exposeInMainWorld('golive', api)
