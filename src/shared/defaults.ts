import type { Settings } from './types.js'

/**
 * Stand-in the renderer receives instead of a stored API key. Sending it back
 * on save means "keep the key you already have"; an empty string clears it.
 * Real keys never leave the main process.
 */
export const STORED_KEY = '__stored__'

/**
 * Preset endpoints. Everything except Anthropic goes through the single
 * openai-compatible adapter — only the baseURL differs.
 */
export const DEFAULT_SETTINGS: Settings = {
  activeProviderId: 'anthropic',
  maxIterations: 10,
  providers: [
    {
      id: 'anthropic',
      label: 'Anthropic',
      kind: 'anthropic',
      model: 'claude-opus-5',
      requiresKey: true,
      allowAmbientAuth: true
    },
    {
      id: 'openai',
      label: 'OpenAI',
      kind: 'openai-compatible',
      model: 'gpt-4.1',
      requiresKey: true
    },
    {
      id: 'ollama',
      label: 'Ollama (local)',
      kind: 'openai-compatible',
      model: 'qwen3:8b',
      baseURL: 'http://localhost:11434/v1',
      requiresKey: false
    },
    {
      id: 'lmstudio',
      label: 'LM Studio (local)',
      kind: 'openai-compatible',
      model: 'local-model',
      baseURL: 'http://localhost:1234/v1',
      requiresKey: false
    },
    {
      id: 'together',
      label: 'Together AI',
      kind: 'openai-compatible',
      model: 'Qwen/Qwen3-235B-A22B-Instruct-2507-tput',
      baseURL: 'https://api.together.xyz/v1',
      requiresKey: true
    },
    {
      id: 'huggingface',
      label: 'Hugging Face Router',
      kind: 'openai-compatible',
      model: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
      baseURL: 'https://router.huggingface.co/v1',
      requiresKey: true
    }
  ]
}
