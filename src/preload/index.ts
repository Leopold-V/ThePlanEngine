import { contextBridge, ipcRenderer } from 'electron'
import type { RobotProfile } from '@shared/profile.js'
import type { RunRecord } from '@shared/scenario.js'
import type { ModelReply, SendRequest, Settings } from '@shared/types.js'

/** The only surface the renderer has into the main process. */
const api = {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Settings): Promise<Settings> =>
    ipcRenderer.invoke('settings:save', settings),
  getProfile: (): Promise<RobotProfile> => ipcRenderer.invoke('profile:get'),
  saveProfile: (profile: RobotProfile): Promise<RobotProfile> =>
    ipcRenderer.invoke('profile:save', profile),
  resetProfile: (): Promise<RobotProfile> => ipcRenderer.invoke('profile:reset'),
  getRuns: (): Promise<RunRecord[]> => ipcRenderer.invoke('runs:get'),
  saveRun: (record: RunRecord): Promise<RunRecord[]> => ipcRenderer.invoke('runs:save', record),
  clearRuns: (): Promise<RunRecord[]> => ipcRenderer.invoke('runs:clear'),
  send: (req: SendRequest): Promise<ModelReply> => ipcRenderer.invoke('model:send', req)
}

export type PlanEngineApi = typeof api

contextBridge.exposeInMainWorld('planEngine', api)
