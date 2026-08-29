import type { ProviderKind } from '@shared/types.js'
import { anthropicProvider } from './anthropic.js'
import { openAICompatibleProvider } from './openaiCompatible.js'
import type { ModelProvider } from './types.js'

const providers: Record<ProviderKind, ModelProvider> = {
  anthropic: anthropicProvider,
  'openai-compatible': openAICompatibleProvider
}

export function getProvider(kind: ProviderKind): ModelProvider {
  return providers[kind]
}
