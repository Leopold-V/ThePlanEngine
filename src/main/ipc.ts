import { ipcMain } from 'electron'
import type { RobotProfile } from '@shared/profile.js'
import type { RunRecord } from '@shared/scenario.js'
import type { ModelReply, SendRequest, Settings } from '@shared/types.js'
import { getProfile, resetProfile, saveProfile } from './profile.js'
import { clearRuns, getRuns, saveRun } from './runs.js'
import { getProvider } from './providers/registry.js'
import { getSettings, resolveProvider, saveSettings } from './settings.js'

export const CHANNELS = {
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  profileGet: 'profile:get',
  profileSave: 'profile:save',
  profileReset: 'profile:reset',
  runsGet: 'runs:get',
  runsSave: 'runs:save',
  runsClear: 'runs:clear',
  modelSend: 'model:send'
} as const

export function registerIpc(): void {
  ipcMain.handle(CHANNELS.settingsGet, (): Settings => getSettings())

  ipcMain.handle(CHANNELS.settingsSave, (_e, incoming: Settings): Settings =>
    saveSettings(incoming)
  )

  ipcMain.handle(CHANNELS.profileGet, (): RobotProfile => getProfile())

  ipcMain.handle(CHANNELS.profileSave, (_e, incoming: RobotProfile): RobotProfile =>
    saveProfile(incoming)
  )

  ipcMain.handle(CHANNELS.profileReset, (): RobotProfile => resetProfile())

  ipcMain.handle(CHANNELS.runsGet, (): RunRecord[] => getRuns())

  ipcMain.handle(CHANNELS.runsSave, (_e, record: RunRecord): RunRecord[] => saveRun(record))

  ipcMain.handle(CHANNELS.runsClear, (): RunRecord[] => clearRuns())

  ipcMain.handle(CHANNELS.modelSend, async (_e, req: SendRequest): Promise<ModelReply> => {
    const settings = resolveProvider(req.providerId)
    if (!settings) {
      return {
        text: null,
        toolCalls: [],
        stopReason: 'error',
        error: `Unknown provider "${req.providerId}".`
      }
    }
    if (settings.requiresKey && !settings.apiKey && !settings.allowAmbientAuth) {
      return {
        text: null,
        toolCalls: [],
        stopReason: 'error',
        error: `No API key set for ${settings.label}. Add one in Settings.`
      }
    }

    return getProvider(settings.kind).send({
      settings,
      system: req.system,
      messages: req.messages,
      tools: req.tools
    })
  })
}
