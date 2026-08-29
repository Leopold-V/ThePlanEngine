import { ipcMain } from 'electron'
import type { ModelReply, SendRequest, Settings } from '@shared/types.js'
import { getProvider } from './providers/registry.js'
import { getSettings, resolveProvider, saveSettings } from './settings.js'

export const CHANNELS = {
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  modelSend: 'model:send'
} as const

export function registerIpc(): void {
  ipcMain.handle(CHANNELS.settingsGet, (): Settings => getSettings())

  ipcMain.handle(CHANNELS.settingsSave, (_e, incoming: Settings): Settings =>
    saveSettings(incoming)
  )

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
    if (settings.requiresKey && !settings.apiKey) {
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
