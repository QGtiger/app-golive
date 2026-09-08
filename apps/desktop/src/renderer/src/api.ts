import type { DesktopAPI } from '@golive/core'

declare global {
  interface Window {
    golive: DesktopAPI
  }
}

export const api: DesktopAPI = window.golive

export function connectionIncomplete(settings: {
  apiUrl: string
  bucket: string
  accessKeyId: string
  accessKeySecret: string
  publicBaseUrl: string
}): boolean {
  return !settings.apiUrl.trim() || !settings.bucket.trim() || !settings.accessKeyId.trim() || !settings.publicBaseUrl.trim()
}
