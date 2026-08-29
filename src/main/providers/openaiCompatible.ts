import OpenAI from 'openai'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import type { Message, ModelReply, StopReason, ToolCall } from '@shared/types.js'
import { errorReply, type ModelProvider, type SendArgs } from './types.js'

/**
 * Covers OpenAI, Ollama, LM Studio, Together, Hugging Face, vLLM — every server
 * that speaks /chat/completions. Only `baseURL` distinguishes them.
 */

function toOpenAIMessages(system: string, messages: Message[]): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [{ role: 'system', content: system }]

  for (const m of messages) {
    // Tool results are their own `tool` role messages here, not user content.
    const toolResults = m.parts.filter((p) => p.type === 'tool_result')
    for (const r of toolResults) {
      out.push({ role: 'tool', tool_call_id: r.id, content: r.content })

      // A `tool` message may only carry text on this API, so a photo has to
      // follow as a user turn rather than sit inside the result.
      if (r.image) {
        out.push({
          role: 'user',
          content: [
            { type: 'text', text: `Photo returned by ${r.id}:` },
            {
              type: 'image_url',
              image_url: { url: `data:${r.image.mediaType};base64,${r.image.base64}` }
            }
          ]
        })
      }
    }

    const text = m.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
    const calls = m.parts.filter((p) => p.type === 'tool_call')

    if (m.role === 'assistant') {
      if (text.length === 0 && calls.length === 0) continue
      out.push({
        role: 'assistant',
        content: text.length > 0 ? text : null,
        ...(calls.length > 0
          ? {
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: 'function' as const,
                function: { name: c.name, arguments: JSON.stringify(c.args) }
              }))
            }
          : {})
      })
    } else if (text.length > 0) {
      out.push({ role: 'user', content: text })
    }
  }

  return out
}

function toStopReason(reason: string | null | undefined): StopReason {
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_calls'
  if (reason === 'length') return 'max_tokens'
  return 'end'
}

/** Small models sometimes emit invalid JSON here; surface it rather than crashing. */
function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || '{}')
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return { __parseError: raw }
  }
}

export const openAICompatibleProvider: ModelProvider = {
  kind: 'openai-compatible',

  async send({ settings, system, messages, tools }: SendArgs): Promise<ModelReply> {
    try {
      const client = new OpenAI({
        // Local servers ignore the key but the SDK requires a non-empty string.
        apiKey: settings.apiKey || 'not-needed',
        ...(settings.baseURL ? { baseURL: settings.baseURL } : {})
      })

      const openAITools: ChatCompletionTool[] = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters }
      }))

      const response = await client.chat.completions.create({
        model: settings.model,
        messages: toOpenAIMessages(system, messages),
        tools: openAITools
      })

      const choice = response.choices[0]
      const message = choice?.message

      const toolCalls: ToolCall[] = (message?.tool_calls ?? [])
        .filter((c) => c.type === 'function')
        .map((c) => ({
          id: c.id,
          name: c.function.name,
          args: parseArgs(c.function.arguments)
        }))

      const text = message?.content?.trim() ?? ''

      return {
        text: text.length > 0 ? text : null,
        toolCalls,
        stopReason: toStopReason(choice?.finish_reason),
        ...(response.usage
          ? {
              usage: {
                inputTokens: response.usage.prompt_tokens,
                outputTokens: response.usage.completion_tokens
              }
            }
          : {})
      }
    } catch (err) {
      return errorReply(err)
    }
  }
}
