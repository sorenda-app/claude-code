/**
 * Local state for the plugin, under ~/.sorenda/claude-code/.
 *
 *   sessions/<session-id>.json  what we already saved for a session
 *   current/<cwd-slug>.json     which session is live in a working directory
 *   log                         hook errors, since hooks must stay silent
 *
 * Everything here degrades gracefully: a missing or corrupt file means "we know
 * nothing yet", which at worst costs one redundant POST (deduplicated by
 * `clientId` anyway).
 */

import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const STATE_DIR = join(homedir(), '.sorenda', 'claude-code')
const SESSIONS_DIR = join(STATE_DIR, 'sessions')
const CURRENT_DIR = join(STATE_DIR, 'current')
const LOG_PATH = join(STATE_DIR, 'log')

const MAX_LOG_BYTES = 256 * 1024
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * @typedef {{
 *   noteId?: string,
 *   version?: number,
 *   textHash?: string,
 *   apiUrl?: string,
 *   title?: string,
 *   autosave?: boolean,
 *   transcriptPath?: string,
 *   cwd?: string,
 *   updatedAt?: string,
 * }} SessionState
 */

/**
 * @param {string} dir
 */
function ensure(dir) {
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* best effort */
  }
}

/**
 * @param {string} path
 * @returns {Record<string, any> | null}
 */
function readJson(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * @param {string} path
 * @param {unknown} value
 */
function writeJson(path, value) {
  try {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  } catch {
    /* best effort */
  }
}

/**
 * A working directory maps to one file name, mirroring how Claude Code names
 * its own project directories.
 *
 * @param {string} cwd
 * @returns {string}
 */
export function cwdSlug(cwd) {
  const slug = String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-')
  return slug.length > 180 ? slug.slice(-180) : slug || 'unknown'
}

/**
 * @param {string} sessionId
 * @returns {SessionState}
 */
export function readSessionState(sessionId) {
  if (!sessionId) return {}
  return readJson(join(SESSIONS_DIR, `${safe(sessionId)}.json`)) ?? {}
}

/**
 * @param {string} sessionId
 * @param {SessionState} patch
 * @returns {SessionState}
 */
export function writeSessionState(sessionId, patch) {
  if (!sessionId) return {}
  ensure(SESSIONS_DIR)
  const next = { ...readSessionState(sessionId), ...patch, updatedAt: new Date().toISOString() }
  writeJson(join(SESSIONS_DIR, `${safe(sessionId)}.json`), next)
  collectGarbage()
  return next
}

/**
 * Records which session is live in a working directory. Slash commands run in a
 * fresh process with no session id of their own; the UserPromptSubmit hook fires
 * immediately before the command, so this marker is always current.
 *
 * @param {{ sessionId: string, transcriptPath: string, cwd: string }} marker
 */
export function writeCurrent(marker) {
  if (!marker.cwd || !marker.sessionId) return
  ensure(CURRENT_DIR)
  writeJson(join(CURRENT_DIR, `${cwdSlug(marker.cwd)}.json`), {
    sessionId: marker.sessionId,
    transcriptPath: marker.transcriptPath ?? '',
    cwd: marker.cwd,
    updatedAt: new Date().toISOString(),
  })
}

/**
 * @param {string} cwd
 * @returns {{ sessionId: string, transcriptPath: string, cwd: string } | null}
 */
export function readCurrent(cwd) {
  const marker = readJson(join(CURRENT_DIR, `${cwdSlug(cwd)}.json`))
  if (!marker?.sessionId) return null
  return {
    sessionId: marker.sessionId,
    transcriptPath: marker.transcriptPath ?? '',
    cwd: marker.cwd ?? cwd,
  }
}

/**
 * @param {string} message
 */
export function log(message) {
  ensure(STATE_DIR)
  try {
    if (statSync(LOG_PATH).size > MAX_LOG_BYTES) rmSync(LOG_PATH, { force: true })
  } catch {
    /* no log yet */
  }
  try {
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}\n`)
  } catch {
    /* best effort */
  }
}

/** Drops session state files older than the TTL so the directory stays small. */
function collectGarbage() {
  const cutoff = Date.now() - SESSION_TTL_MS
  try {
    for (const name of readdirSync(SESSIONS_DIR)) {
      const path = join(SESSIONS_DIR, name)
      try {
        if (statSync(path).mtimeMs < cutoff) rmSync(path, { force: true })
      } catch {
        /* skip */
      }
    }
  } catch {
    /* no directory yet */
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
function safe(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)
}
