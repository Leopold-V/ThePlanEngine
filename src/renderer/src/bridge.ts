import { DEFAULT_SETTINGS } from '@shared/defaults.js'
import type { ModelReply, SendRequest, Settings } from '@shared/types.js'

/**
 * The preload bridge, with a fallback for when the renderer is opened directly
 * in a browser (`vite` without the Electron shell). The simulation still runs
 * there, which makes iterating on skills and rendering much faster; only model
 * calls are unavailable, since they need the main process.
 */
const browserFallback = {
  getSettings: (): Promise<Settings> => Promise.resolve(DEFAULT_SETTINGS),
  saveSettings: (settings: Settings): Promise<Settings> => Promise.resolve(settings),
  send: (_req: SendRequest): Promise<ModelReply> =>
    Promise.resolve({
      text: null,
      toolCalls: [],
      stopReason: 'error',
      error: 'Model calls need the Electron shell. Run `npm run dev` instead of opening the page directly.'
    })
}

export const bridge = typeof window !== 'undefined' && window.planEngine ? window.planEngine : browserFallback

export const isElectron = typeof window !== 'undefined' && Boolean(window.planEngine)
