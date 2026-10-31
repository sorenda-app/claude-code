/**
 * Reads a Claude Code session transcript (JSONL) and reconstructs the readable
 * conversation behind it.
 *
 * The on-disk format is internal to Claude Code and can change between
 * releases, so everything here is defensive: unknown record types, unknown
 * content blocks and unparseable lines are skipped rather than fatal. The worst
 * outcome of a format change must be a thinner note, never a broken session.
 */

import { formatToolUse } from './tools.mjs'
import { escapeRoleHeadings, renderTranscript } from './transcript.mjs'

/** Server-side cap on `note.text` — backend/internal/notes/notes.go:311. */
export const MAX_TEXT_BYTES = 100_000

/** Marker left behind when the head of a long session had to be dropped. */
export const TRUNCATION_MARKER = '_…beginning of conversation omitted…_'

const MAX_TITLE_LEN = 120

/**
 * @typedef {import('./transcript.mjs').ChatTurn} ChatTurn
 * @typedef {{
 *   turns: ChatTurn[],
 *   title: string,
 *   model: string,
 *   sessionId: string,
 *   cwd: string,
 * }} ParsedSession
 */

/**
 * Strips the wrappers Claude Code injects into user messages. These are
 * machinery, not something the user said.
 *
 * @param {string} text
 * @returns {string}
 */
function stripInjected(text) {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
    .replace(/<local-command-stderr>[\s\S]*?<\/local-command-stderr>/g, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
}

/**
 * Our own slash commands (commands/save.md, commands/autosave.md,
 * commands/login.md). Invoking any of them is talking to the plugin, not to
 * Claude, so neither the invocation nor its result belongs in the saved
 * conversation — otherwise saving a chat leaves a trace of itself in the next
 * save, and turning autosave on shows up as a turn in every save from then on.
 * `login` matters most: its arguments are an email address and, on the second
 * call, the one-time code from that email — neither should ever reach a
 * stored note.
 */
const OWN_COMMANDS = new Set(['save', 'autosave', 'login'])

/**
 * @param {string} name raw `<command-name>` contents, e.g. "/save" or "/sorenda:save"
 * @returns {boolean}
 */
function isOwnCommand(name) {
  const bare = name.trim().replace(/^\//, '').split(':').pop()
  return OWN_COMMANDS.has(bare)
}

/**
 * Rewrites a slash-command invocation into what the user actually typed:
 * `<command-name>/foo</command-name><command-args>bar</command-args>` → `/foo bar`.
 * Returns null for our own commands, so the caller can drop the turn entirely.
 *
 * @param {string} text
 * @returns {string | null}
 */
function unwrapCommand(text) {
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)
  if (!name) return text
  if (isOwnCommand(name[1])) return null
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)
  const contents = /<command-contents>([\s\S]*?)<\/command-contents>/.exec(text)
  const invocation = [name[1].trim(), args ? args[1].trim() : ''].filter(Boolean).join(' ')
  const rest = text
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
    .replace(/<command-contents>[\s\S]*?<\/command-contents>/g, '')
    .trim()
  // command-contents is the expanded prompt body, which the user never sees.
  void contents
  return [invocation, rest].filter(Boolean).join('\n\n')
}

/**
 * Whether a tool_use block is our own command running its script — the Bash
 * call that `commands/save.md` / `commands/autosave.md` / `commands/login.md`
 * make. A second, independent check from `isOwnCommand`: the user-turn text
 * can be spoofed or missing, but the actual script path cannot.
 *
 * @param {{ name?: string, input?: Record<string, unknown> }} block
 * @returns {boolean}
 */
function isOwnScriptCall(block) {
  if (block?.name !== 'Bash') return false
  const command = block.input?.command
  return typeof command === 'string' && /\bscripts\/(save|autosave|login)\.mjs\b/.test(command)
}

/**
 * @param {unknown} content
 * @returns {string}
 */
function userText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

/**
 * Text and tool calls of one assistant record, in the order they were emitted.
 * `thinking` blocks are deliberately dropped — they are not part of the answer.
 *
 * Consecutive tool lines are kept on adjacent lines rather than separate
 * paragraphs, so a burst of calls reads as one block of activity.
 *
 * @param {unknown} content
 * @param {string} [cwd]
 * @returns {string}
 */
function assistantParts(content, cwd) {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''

  /** @type {{ tool: boolean, text: string }[]} */
  const parts = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      parts.push({ tool: false, text: block.text.trim() })
    } else if (block.type === 'tool_use' && !isOwnScriptCall(block)) {
      parts.push({ tool: true, text: formatToolUse(block, cwd) })
    }
  }

  return parts.reduce((acc, part, index) => {
    if (index === 0) return part.text
    const separator = part.tool && parts[index - 1].tool ? '\n' : '\n\n'
    return acc + separator + part.text
  }, '')
}

/**
 * @param {unknown} content
 * @returns {boolean}
 */
function isToolResultOnly(content) {
  if (!Array.isArray(content)) return false
  return content.length > 0 && content.every((block) => block?.type === 'tool_result')
}

/**
 * @param {string} jsonl raw file contents
 * @returns {ParsedSession}
 */
export function parseSession(jsonl) {
  /** @type {ChatTurn[]} */
  const turns = []
  let customTitle = ''
  let model = ''
  let sessionId = ''
  let cwd = ''

  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (!record || typeof record !== 'object') continue

    if (typeof record.sessionId === 'string' && record.sessionId) sessionId = record.sessionId
    // The first cwd is the project root; later records may carry a directory
    // the shell wandered into, which would make tool paths look absolute again.
    if (!cwd && typeof record.cwd === 'string' && record.cwd) cwd = record.cwd

    if (record.type === 'custom-title' && typeof record.customTitle === 'string') {
      customTitle = record.customTitle.trim()
      continue
    }
    if (record.type !== 'user' && record.type !== 'assistant') continue
    // Subagent conversations live in the same file; the parent session already
    // shows them as a `→ Agent(...)` line.
    if (record.isSidechain) continue
    if (record.isMeta) continue

    const message = record.message
    if (!message || typeof message !== 'object') continue

    if (record.type === 'user') {
      if (isToolResultOnly(message.content)) continue
      const unwrapped = unwrapCommand(stripInjected(userText(message.content)))
      if (unwrapped === null) continue
      const text = unwrapped.trim()
      if (!text) continue
      push(turns, 'user', text)
    } else {
      if (typeof message.model === 'string' && message.model) model = message.model
      const text = assistantParts(message.content, cwd)
      if (!text) continue
      push(turns, 'assistant', text)
    }
  }

  return { turns, title: customTitle || inferTitle(turns), model, sessionId, cwd }
}

/**
 * Claude Code writes one record per content block group, so a single answer
 * arrives as several assistant records. Merge same-role neighbours back into
 * one turn — the stored format has one heading per turn.
 *
 * @param {ChatTurn[]} turns
 * @param {import('./transcript.mjs').ChatRole} role
 * @param {string} content
 */
function push(turns, role, content) {
  const last = turns[turns.length - 1]
  if (last && last.role === role) {
    // Tool lines meeting across a record boundary stay in the same block.
    const glue = isToolLine(lastLine(last.content)) && isToolLine(content.split('\n')[0]) ? '\n' : '\n\n'
    last.content = `${last.content}${glue}${content}`
    return
  }
  turns.push({ role, content })
}

/**
 * @param {string} content
 * @returns {string}
 */
function lastLine(content) {
  const lines = content.split('\n')
  return lines[lines.length - 1]
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isToolLine(line) {
  return /^`→ /.test(line ?? '')
}

/**
 * Falls back to the first thing the user asked when the session has no title.
 *
 * @param {ChatTurn[]} turns
 * @returns {string}
 */
export function inferTitle(turns) {
  const first = turns.find((turn) => turn.role === 'user')
  if (!first) return ''
  const line = first.content
    .split('\n')
    .map((it) => it.trim())
    .find((it) => it !== '')
  if (!line) return ''
  return line.length > MAX_TITLE_LEN ? `${line.slice(0, MAX_TITLE_LEN - 1)}…` : line
}

/**
 * Renders turns into the stored markdown, dropping the oldest ones until the
 * result fits the server's text budget. The tail is what still matters, so it
 * is what survives.
 *
 * @param {ChatTurn[]} turns
 * @param {{ maxBytes?: number }} [options]
 * @returns {{ text: string, turns: ChatTurn[], truncated: boolean }}
 */
export function renderTurns(turns, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_TEXT_BYTES
  const safe = turns
    .map((turn) => ({ role: turn.role, content: escapeRoleHeadings(turn.content).trim() }))
    .filter((turn) => turn.content !== '')

  let kept = safe
  let text = renderTranscript(kept)
  if (byteLength(text) <= maxBytes) return { text, turns: kept, truncated: false }

  while (kept.length > 1) {
    kept = kept.slice(1)
    text = `${TRUNCATION_MARKER}\n\n${renderTranscript(kept)}`
    if (byteLength(text) <= maxBytes) return { text, turns: kept, truncated: true }
  }

  // A single turn over budget: cut it at a whole character boundary.
  const head = `${TRUNCATION_MARKER}\n\n`
  const body = renderTranscript(kept)
  return {
    text: head + clipBytes(body, maxBytes - byteLength(head)),
    turns: kept,
    truncated: true,
  }
}

/**
 * @param {string} value
 * @returns {number}
 */
export function byteLength(value) {
  return Buffer.byteLength(value, 'utf8')
}

/**
 * Truncates to a byte budget without splitting a multi-byte character.
 *
 * @param {string} value
 * @param {number} maxBytes
 * @returns {string}
 */
function clipBytes(value, maxBytes) {
  if (maxBytes <= 0) return ''
  const buffer = Buffer.from(value, 'utf8')
  if (buffer.length <= maxBytes) return value
  const decoder = new TextDecoder('utf-8', { fatal: false })
  return decoder.decode(buffer.subarray(0, maxBytes)).replace(/�$/, '')
}
