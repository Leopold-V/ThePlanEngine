import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { z } from 'zod'
import type { Message, ModelReply, ToolCall, ToolSchema } from '@shared/types.js'
import { errorReply, type ModelProvider, type SendArgs } from './types.js'

/**
 * Drives the locally installed Claude Code CLI as a model backend, so the app
 * runs on an existing Claude Code login instead of an API key.
 *
 * Claude Code has no custom-tool-schema flag, so tool calling is done by
 * contract: the schemas go into the system prompt and the model is asked for a
 * single JSON object. That keeps this inside the normal `ModelProvider`
 * interface — the engine and the skills are untouched.
 *
 * The isolation flags below are not optional. Without them Claude Code loads
 * the user's plugins, skills and MCP servers into every call: measured at
 * ~110k tokens and 16s per request, versus ~0 and 5s with them. It will also
 * try to call unrelated MCP tools mid-run.
 *
 * `--bare` looks like the right flag here and is not: it forces auth to
 * ANTHROPIC_API_KEY and never reads the OAuth login, which defeats the point.
 */

const TIMEOUT_MS = 120_000

const replySchema = z.object({
  text: z.string().nullable().optional(),
  tool_calls: z
    .array(z.object({ name: z.string(), args: z.record(z.string(), z.unknown()).default({}) }))
    .default([])
})

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Claude Code ships as a real executable, which lets us spawn it with no shell.
 * That matters: the system prompt goes through argv, and shell interpolation of
 * multi-line text on Windows is a quoting minefield.
 *
 * On Windows only the npm shims (`claude`, `claude.cmd`, `claude.ps1`) are on
 * PATH — the executable lives inside the package. Spawning the `.cmd` is not an
 * option: Node refuses it without `shell: true` (EINVAL), and turning the shell
 * on would put a multi-line system prompt through cmd.exe parsing.
 */
function resolveBinary(explicit?: string): string {
  if (explicit) return explicit
  if (process.platform !== 'win32') return 'claude'

  const packaged = join('node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')

  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue
    for (const candidate of [join(dir, 'claude.exe'), join(dir, packaged)]) {
      if (isExecutable(candidate)) return candidate
    }
  }

  throw new Error(
    'Could not find claude.exe. Claude Code is installed, but only its shims are on ' +
      'PATH — set the full path to claude.exe in Settings.'
  )
}

function buildSystemPrompt(system: string, tools: ToolSchema[]): string {
  const rendered = tools
    .map((t) => `### ${t.name}\n${t.description}\nParameters (JSON Schema):\n${JSON.stringify(t.parameters)}`)
    .join('\n\n')

  return `${system}

## Available tools

${rendered}

## Response format

Reply with exactly ONE JSON object and nothing else. No prose before or after it,
no markdown code fences.

{"text": string | null, "tool_calls": [{"name": string, "args": object}]}

- Put the tools you want to run, in order, in "tool_calls".
- "args" must satisfy that tool's JSON Schema.
- When the task is finished, return "tool_calls": [] and put your summary in "text".`
}

/** The CLI is stateless per invocation, so the whole exchange is replayed as text. */
function renderConversation(messages: Message[]): string {
  const lines: string[] = []

  for (const message of messages) {
    for (const part of message.parts) {
      switch (part.type) {
        case 'text':
          lines.push(`[${message.role}] ${part.text}`)
          break
        case 'tool_call':
          lines.push(`[you called] ${part.name}(${JSON.stringify(part.args)})`)
          break
        case 'tool_result':
          lines.push(`[result${part.isError ? ' — FAILED' : ''}] ${part.content}`)
          break
      }
    }
  }

  return `${lines.join('\n')}\n\nRespond with the JSON object now.`
}

/** Models sometimes wrap the object in prose or fences despite the instruction. */
function extractJson(raw: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)
  const text = (fenced?.[1] ?? raw).trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  return text.slice(start, end + 1)
}

function run(bin: string, args: string[], stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // shell: false — argv is passed straight through, so the system prompt
    // needs no escaping and cannot be reinterpreted by a shell.
    const child = spawn(bin, args, { shell: false, windowsHide: true })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Claude Code did not respond within ${TIMEOUT_MS / 1000}s.`))
    }, TIMEOUT_MS)

    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))

    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(
        err.code === 'ENOENT'
          ? new Error(
              `Could not find the Claude Code CLI ("${bin}"). Install it, or set the ` +
                'command path in Settings.'
            )
          : err
      )
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `Claude Code exited with code ${code}.`))
    })

    child.stdin.end(stdin)
  })
}

export const claudeCliProvider: ModelProvider = {
  kind: 'claude-cli',

  async send({ settings, system, messages, tools }: SendArgs): Promise<ModelReply> {
    try {
      const args = [
        '--print',
        '--output-format',
        'json',
        // No built-in tools: this must not touch the filesystem or run commands.
        '--tools',
        '',
        // Ignore the user's MCP servers, plugins, skills and CLAUDE.md files.
        '--strict-mcp-config',
        '--setting-sources',
        '',
        '--model',
        settings.model,
        '--system-prompt',
        buildSystemPrompt(system, tools)
      ]

      const raw = await run(resolveBinary(settings.command), args, renderConversation(messages))

      const envelope = JSON.parse(raw) as {
        is_error?: boolean
        result?: string
        usage?: { input_tokens?: number; output_tokens?: number }
      }

      if (envelope.is_error || typeof envelope.result !== 'string') {
        return errorReply(new Error(envelope.result ?? 'Claude Code returned an error.'))
      }

      const json = extractJson(envelope.result)
      if (!json) {
        return errorReply(
          new Error(`Claude Code did not return JSON. It said: ${envelope.result.slice(0, 200)}`)
        )
      }

      const parsed = replySchema.safeParse(JSON.parse(json))
      if (!parsed.success) {
        return errorReply(new Error(`Unexpected reply shape: ${parsed.error.issues[0]?.message}`))
      }

      // The CLI has no notion of tool-call ids; the engine only needs them to be
      // unique and stable within this exchange.
      const toolCalls: ToolCall[] = parsed.data.tool_calls.map((c) => ({
        id: `cc_${randomId()}`,
        name: c.name,
        args: c.args
      }))

      const text = parsed.data.text?.trim()

      return {
        text: text ? text : null,
        toolCalls,
        stopReason: toolCalls.length > 0 ? 'tool_calls' : 'end',
        ...(envelope.usage
          ? {
              usage: {
                inputTokens: envelope.usage.input_tokens ?? 0,
                outputTokens: envelope.usage.output_tokens ?? 0
              }
            }
          : {})
      }
    } catch (err) {
      return errorReply(err)
    }
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10)
}
