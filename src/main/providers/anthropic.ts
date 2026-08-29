import Anthropic from '@anthropic-ai/sdk'
import type { Message, ModelReply, StopReason, ToolCall } from '@shared/types.js'
import { errorReply, type ModelProvider, type SendArgs } from './types.js'

const MAX_TOKENS = 2048

function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.parts.map((p) => {
      switch (p.type) {
        case 'text':
          return { type: 'text' as const, text: p.text }
        case 'tool_call':
          return { type: 'tool_use' as const, id: p.id, name: p.name, input: p.args }
        case 'tool_result':
          return {
            type: 'tool_result' as const,
            tool_use_id: p.id,
            content: p.content,
            is_error: p.isError ?? false
          }
      }
    })
  }))
}

function toStopReason(reason: string | null): StopReason {
  if (reason === 'tool_use') return 'tool_calls'
  if (reason === 'max_tokens') return 'max_tokens'
  return 'end'
}

export const anthropicProvider: ModelProvider = {
  kind: 'anthropic',

  async send({ settings, system, messages, tools }: SendArgs): Promise<ModelReply> {
    try {
      const client = new Anthropic({
        apiKey: settings.apiKey ?? '',
        ...(settings.baseURL ? { baseURL: settings.baseURL } : {})
      })

      const response = await client.messages.create({
        model: settings.model,
        max_tokens: MAX_TOKENS,
        system,
        messages: toAnthropicMessages(messages),
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Tool.InputSchema
        }))
      })

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()

      const toolCalls: ToolCall[] = response.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, args: (b.input ?? {}) as Record<string, unknown> }))

      return {
        text: text.length > 0 ? text : null,
        toolCalls,
        stopReason: toStopReason(response.stop_reason),
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens
        }
      }
    } catch (err) {
      return errorReply(err)
    }
  }
}
