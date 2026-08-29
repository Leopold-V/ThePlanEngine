import type { Message, ModelReply, ProviderSettings, ToolSchema } from '@shared/types.js'

export interface SendArgs {
  settings: ProviderSettings
  system: string
  messages: Message[]
  tools: ToolSchema[]
}

/**
 * The whole contract for talking to a model. Adding a vendor means adding one
 * file that satisfies this and registering it — the engine never changes.
 */
export interface ModelProvider {
  kind: ProviderSettings['kind']
  send(args: SendArgs): Promise<ModelReply>
}

/** Providers must never throw; failures come back as a reply the UI can show. */
export function errorReply(err: unknown): ModelReply {
  const message = err instanceof Error ? err.message : String(err)
  return { text: null, toolCalls: [], stopReason: 'error', error: message }
}
