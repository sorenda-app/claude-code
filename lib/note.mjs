/**
 * Builds the Sorenda note payload for a Claude Code session.
 *
 * The note type is `aichat`, shared with the Raycast extension — see
 * backend/internal/plugins/aichat/aichat.go for the fields `data` may carry.
 * Anything else in `data` is silently dropped by the server.
 */

import { createHash } from 'node:crypto'
import { config, parseTags } from './api.mjs'
import { renderTurns } from './session.mjs'

export const NOTE_TYPE = 'aichat'
export const SOURCE = 'claude-code'

/** `claude:` + a 36-char uuid = 43 chars, inside the server's 64-char cap. */
const CLIENT_ID_PREFIX = 'claude:'

/**
 * Unlike the Raycast extension, the clientId is derived from the session rather
 * than from the transcript hash: a growing session must keep updating one note
 * instead of leaving a trail of copies. When local state is lost, POSTing the
 * same clientId returns the existing note with HTTP 200 and we recover from it.
 *
 * @param {string} sessionId
 * @returns {string}
 */
export function clientIdFor(sessionId) {
  const id = String(sessionId || '').trim()
  if (id) return `${CLIENT_ID_PREFIX}${id}`.slice(0, 64)
  return `${CLIENT_ID_PREFIX}${createHash('sha256').update(String(Date.now())).digest('hex').slice(0, 40)}`
}

/**
 * @param {import('./session.mjs').ParsedSession} session
 * @param {{ title?: string, tags?: string[], maxBytes?: number }} [overrides]
 * @returns {{ input: Record<string, unknown>, text: string, messageCount: number, truncated: boolean }}
 */
export function buildNoteInput(session, overrides = {}) {
  const { text, turns, truncated } = renderTurns(session.turns, { maxBytes: overrides.maxBytes })
  const title = (overrides.title ?? session.title ?? '').trim()
  const tags = [...new Set([...parseTags(config().defaultTags), ...(overrides.tags ?? [])])]

  /** @type {Record<string, unknown>} */
  const data = {
    source: SOURCE,
    messageCount: turns.length,
    capturedAt: new Date().toISOString(),
  }
  if (title) data.chatTitle = title
  if (session.model) data.model = session.model

  return {
    input: {
      type: NOTE_TYPE,
      title: title || undefined,
      text,
      tags,
      data,
      clientId: clientIdFor(session.sessionId),
    },
    text,
    messageCount: turns.length,
    truncated,
  }
}

/**
 * Splits `$ARGUMENTS` into a topic and extra tags: `#word` anywhere is a tag,
 * everything else forms the topic.
 *
 * @param {string} raw
 * @returns {{ title: string, tags: string[] }}
 */
export function parseArguments(raw) {
  const tokens = String(raw || '').trim().split(/\s+/).filter(Boolean)
  const tags = tokens.filter((token) => token.startsWith('#'))
  const title = tokens.filter((token) => !token.startsWith('#')).join(' ')
  return { title, tags: parseTags(tags.join(',')) }
}

/**
 * @param {string} text
 * @returns {string}
 */
export function hashText(text) {
  return createHash('sha256').update(text).digest('hex')
}
