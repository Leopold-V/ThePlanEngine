import { DEFAULT_SETTINGS } from '@shared/defaults.js'
import { DEFAULT_PROFILE, type RobotProfile } from '@shared/profile.js'
import type { ModelReply, SendRequest, Settings } from '@shared/types.js'

/**
 * The preload bridge, with a fallback for when the renderer is opened directly
 * in a browser (`vite` without the Electron shell). The simulation still runs
 * there, which makes iterating on skills and rendering much faster; only model
 * calls are unavailable, since they need the main process.
 */
let sessionProfile: RobotProfile = DEFAULT_PROFILE

const browserFallback = {
  getSettings: (): Promise<Settings> => Promise.resolve(DEFAULT_SETTINGS),
  saveSettings: (settings: Settings): Promise<Settings> => Promise.resolve(settings),
  // Session-only: enough to exercise the robot panel in a plain browser.
  getProfile: (): Promise<RobotProfile> => Promise.resolve(sessionProfile),
  saveProfile: (profile: RobotProfile): Promise<RobotProfile> => {
    sessionProfile = { ...profile, revision: profile.revision + 1 }
    return Promise.resolve(sessionProfile)
  },
  resetProfile: (): Promise<RobotProfile> => {
    sessionProfile = { ...DEFAULT_PROFILE, revision: sessionProfile.revision }
    return Promise.resolve(sessionProfile)
  },
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
