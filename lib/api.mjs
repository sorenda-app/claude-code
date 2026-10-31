/**
 * Minimal Sorenda REST client — the Node/no-dependency counterpart of
 * raycast/src/lib/api.ts, with the same error wording.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_API_URL = 'https://sorenda.app'
export const DEFAULT_TAGS = 'ai-chat, claude-code'

/** Path of the user-owned config file, shared with any future CLI. */
export const CONFIG_PATH = join(homedir(), '.sorenda', 'config.json')

export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   */
  constructor(status, message, body = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/**
 * @returns {Record<string, unknown>}
 */
export function readConfigFile() {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Environment wins over the config file so a single session can be pointed at a
 * local stack without editing anything.
 *
 * @returns {{ apiKey: string, apiUrl: string, defaultTags: string, autosave: boolean }}
 */
export function config() {
  const file = readConfigFile()
  const apiKey = (process.env.SORENDA_API_KEY || file.apiKey || '').trim()
  const apiUrl = (process.env.SORENDA_API_URL || file.apiUrl || DEFAULT_API_URL)
    .trim()
    .replace(/\/+$/, '')
  const defaultTags = process.env.SORENDA_TAGS || file.defaultTags || DEFAULT_TAGS
  return { apiKey, apiUrl, defaultTags, autosave: file.autosave === true }
}

/**
 * Normalizes a comma-separated tag string, same rules as the Raycast client.
 *
 * @param {string | undefined} raw
 * @returns {string[]}
 */
export function parseTags(raw) {
  if (!raw) return []
  const tags = raw
    .split(',')
    .map((tag) => tag.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-'))
    .filter((tag) => tag !== '')
  return [...new Set(tags)]
}

/**
 * @param {number} status
 * @param {string} serverMessage
 * @returns {string}
 */
function friendly(status, serverMessage) {
  if (status === 401) return 'Invalid Sorenda API key — check SORENDA_API_KEY.'
  // The Free plan reads through a key but cannot save; that is the 403 the
  // plugin's writes meet.
  if (status === 403) return 'Saving to Sorenda needs Plus or Pro: on the Free plan a key can only read.'
  if (status === 429) return 'Sorenda limits requests to 120 per minute. Try again later.'
  return serverMessage || `Sorenda returned ${status}`
}

/**
 * @param {string} path
 * @param {RequestInit} init
 * @param {{ auth?: string | null, rawError?: boolean }} [options]
 *   `auth`: undefined uses the configured personal API key (default, for note
 *   requests); null sends no Authorization header (the public OTP endpoints);
 *   a string sends that value as the bearer token (the short-lived login JWT).
 *   `rawError`: skip the personal-API-key error wording and surface the
 *   server's own message — used by the login flow, where 401 means "wrong
 *   code", not "wrong key".
 * @returns {Promise<{ status: number, body: any }>}
 */
async function request(path, init = {}, options = {}) {
  const { apiUrl } = config()

  /** @type {Record<string, string>} */
  const headers = {}
  if (options.auth === undefined) {
    const { apiKey } = config()
    if (!apiKey) {
      throw new ApiError(401, 'No API key is configured — set SORENDA_API_KEY or ~/.sorenda/config.json.')
    }
    headers.Authorization = `Bearer ${apiKey}`
  } else if (options.auth !== null) {
    headers.Authorization = `Bearer ${options.auth}`
  }
  if (typeof init.body === 'string') headers['Content-Type'] = 'application/json'

  let response
  try {
    response = await fetch(`${apiUrl}${path}`, { ...init, headers: { ...headers, ...init.headers } })
  } catch {
    throw new ApiError(0, 'Could not reach Sorenda — check your connection and SORENDA_API_URL.')
  }

  const raw = await response.text()
  let body = null
  try {
    body = raw ? JSON.parse(raw) : null
  } catch {
    body = null
  }

  if (!response.ok) {
    const message = options.rawError ? body?.error || `Sorenda returned ${response.status}` : friendly(response.status, body?.error)
    throw new ApiError(response.status, message, body)
  }
  return { status: response.status, body }
}

/**
 * Creates a note. A 200 (rather than 201) means the server matched `clientId`
 * against an existing note and returned it instead of making a copy — that is
 * how a lost local state file recovers the note id and version.
 *
 * @param {Record<string, unknown>} input
 * @returns {Promise<{ note: any, alreadySaved: boolean }>}
 */
export async function createNote(input) {
  const { status, body } = await request('/api/notes', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return { note: body, alreadySaved: status === 200 }
}

/**
 * Updates a note with optimistic concurrency. A 409 carries the current note in
 * its body, so one retry with that version is enough — a second conflict means
 * something else is writing and we should not fight it.
 *
 * @param {string} id
 * @param {Record<string, unknown>} input
 * @param {number} baseVersion
 * @returns {Promise<{ note: any }>}
 */
export async function updateNote(id, input, baseVersion) {
  const send = (version) =>
    request(`/api/notes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...input, baseVersion: version }),
    })

  try {
    const { body } = await send(baseVersion)
    return { note: body }
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error
    const version = error.body?.note?.version
    if (typeof version !== 'number') throw error
    const { body } = await send(version)
    return { note: body }
  }
}

/**
 * Sorenda has no per-note route, so a saved chat is linked through its topic.
 *
 * @param {{ title?: string }} note
 * @returns {string}
 */
export function noteUrl(note) {
  const { apiUrl } = config()
  if (note?.title) return `${apiUrl}/app/topic/${encodeURIComponent(note.title)}`
  return `${apiUrl}/app/`
}

/**
 * Emails a 6-digit sign-in code, valid for 10 minutes. Same endpoint the web
 * app uses; works for a brand-new email too (sign-up and sign-in are the same
 * flow), so /login never needs a separate registration step.
 *
 * @param {string} email
 * @returns {Promise<void>}
 */
export async function requestOtp(email) {
  await request('/api/auth/otp/request', { method: 'POST', body: JSON.stringify({ email }) }, { auth: null, rawError: true })
}

/**
 * Exchanges the emailed code for a session token. The token is used once, to
 * mint a personal API key, and then discarded — the plugin never stores it.
 *
 * @param {string} email
 * @param {string} code
 * @returns {Promise<{ token: string, user: any }>}
 */
export async function verifyOtp(email, code) {
  const { body } = await request(
    '/api/auth/otp/verify',
    { method: 'POST', body: JSON.stringify({ email, code }) },
    { auth: null, rawError: true },
  )
  return body
}

/**
 * Mints a new personal API key using a session token from `verifyOtp`. Fails
 * with 403 if the account has no active subscription — API keys are a paid
 * feature even though signing in is not.
 *
 * @param {string} sessionToken
 * @param {string} label
 * @returns {Promise<{ key: string }>}
 */
export async function createApiKey(sessionToken, label) {
  const { body } = await request(
    '/api/keys',
    { method: 'POST', body: JSON.stringify({ label, scopes: ['read', 'write'] }) },
    { auth: sessionToken, rawError: true },
  )
  return body
}
