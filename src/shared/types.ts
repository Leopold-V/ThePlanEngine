/**
 * The neutral wire format shared by the renderer (engine + sim) and the main
 * process (model providers). Provider adapters translate to and from their own
 * vendor shapes; nothing outside `src/main/providers` ever sees a vendor type.
 */

export type Role = 'user' | 'assistant'

export interface TextPart {
  type: 'text'
  text: string
}

export interface ToolCallPart {
  type: 'tool_call'
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolResultPart {
  type: 'tool_result'
  id: string
  /** Serialized observation handed back to the model. */
  content: string
  isError?: boolean
}

export type Part = TextPart | ToolCallPart | ToolResultPart

export interface Message {
  role: Role
  parts: Part[]
}

/** A skill, described to the model as a callable tool. */
export interface ToolSchema {
  name: string
  description: string
  /** JSON Schema object, passed to the model verbatim. */
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export type StopReason = 'tool_calls' | 'end' | 'max_tokens' | 'error'

export interface ModelReply {
  text: string | null
  toolCalls: ToolCall[]
  stopReason: StopReason
  usage?: { inputTokens: number; outputTokens: number }
  /** Set when stopReason === 'error'. */
  error?: string
}

export interface SendRequest {
  providerId: string
  system: string
  messages: Message[]
  tools: ToolSchema[]
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Only two adapters exist. `openai-compatible` covers OpenAI, Ollama, LM Studio,
 * Together, Hugging Face router, vLLM — anything that speaks the /chat/completions
 * shape — which is why there is no separate Ollama adapter.
 */
export type ProviderKind = 'anthropic' | 'openai-compatible'

export interface ProviderSettings {
  id: string
  label: string
  kind: ProviderKind
  model: string
  /** Omitted for the vendor default (Anthropic / OpenAI). */
  baseURL?: string
  apiKey?: string
  /** Local servers (Ollama, LM Studio) need no key. */
  requiresKey: boolean
  /**
   * Provider can authenticate from the ambient environment when no key is
   * entered — `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or an OAuth profile
   * from `ant auth login`. The adapter must then omit `apiKey` entirely:
   * passing an empty string still wins its precedence slot and authenticates
   * as an empty key, shadowing every ambient credential.
   */
  allowAmbientAuth?: boolean
}

export interface Settings {
  activeProviderId: string
  providers: ProviderSettings[]
  /** Hard cap on model→tool→model round trips per user instruction. */
  maxIterations: number
}

export interface ProviderStatus {
  id: string
  label: string
  model: string
  ready: boolean
  reason?: string
}
