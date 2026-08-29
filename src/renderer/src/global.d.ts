import type { RobotProfile } from '@shared/profile.js'
import type { ModelReply, SendRequest, Settings } from '@shared/types.js'

declare global {
  interface Window {
    /** Injected by the preload script. Absent when the page runs outside Electron. */
    planEngine?: {
      getSettings: () => Promise<Settings>
      saveSettings: (settings: Settings) => Promise<Settings>
      getProfile: () => Promise<RobotProfile>
      saveProfile: (profile: RobotProfile) => Promise<RobotProfile>
      resetProfile: () => Promise<RobotProfile>
      send: (req: SendRequest) => Promise<ModelReply>
    }
  }
}

export {}
