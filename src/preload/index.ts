import { contextBridge, ipcRenderer } from 'electron'
import type { ModelReply, SendRequest, Settings } from '@shared/types.js'

/** The only surface the renderer has into the main process. */
const api = {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Settings): Promise<Settings> =>
    ipcRenderer.invoke('settings:save', settings),
  send: (req: SendRequest): Promise<ModelReply> => ipcRenderer.invoke('model:send', req)
}

export type PlanEngineApi = typeof api

contextBridge.exposeInMainWorld('planEngine', api)
