#!/usr/bin/env node
/**
 * Signs in with an emailed one-time code and mints a personal API key, so
 * getting the plugin working never requires visiting the website or copying a
 * key out of Settings by hand.
 *
 *   login.mjs you@example.com            request a code
 *   login.mjs you@example.com 123456     verify it and create the key
 *
 * The session token from verifying is used exactly once, to create the key,
 * and is never written to disk — only the resulting `srnd_…` key is. Unlike
 * the hooks, this is a foreground command a human is watching, so errors are
 * printed in full and the process exits non-zero rather than staying silent.
 */

import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'

import { ApiError, CONFIG_PATH, config, createApiKey, readConfigFile, requestOtp, verifyOtp } from '../lib/api.mjs'
import { STATE_DIR } from '../lib/state.mjs'

/** Where a pending "code sent, waiting for it" request is remembered. */
const PENDING_PATH = join(STATE_DIR, 'login.json')

const [emailArg, codeArg] = process.argv.slice(2)
const email = (emailArg || '').trim().toLowerCase()

if (!email || !email.includes('@')) {
  fail('Provide an email address: /login you@example.com')
}

if (codeArg) {
  await verifyCode(email, codeArg.trim())
} else {
  await requestCode(email)
}

/**
 * @param {string} email
 */
async function requestCode(email) {
  try {
    await requestOtp(email)
  } catch (error) {
    fail(describeError(error, { 400: 'Enter a valid email address.' }))
  }
  writePending(email)
  process.stdout.write(
    `A code was sent to ${email} (valid for 10 minutes).\n` + `Enter it with: /login ${email} 123456\n`,
  )
}

/**
 * @param {string} email
 * @param {string} code
 */
async function verifyCode(email, code) {
  let session
  try {
    session = await verifyOtp(email, code)
  } catch (error) {
    fail(
      describeError(error, {
        401: `The code is invalid or expired. Request a new one: /login ${email}`,
        429: `Too many attempts. Request a new code: /login ${email}`,
      }),
    )
  }

  const hadKey = Boolean(config().apiKey)
  let created
  try {
    created = await createApiKey(session.token, `claude-code (${hostname()})`)
  } catch (error) {
    fail(
      describeError(error, {
        403: `You are signed in, but API keys require an active subscription: ${config().apiUrl}/app/profile`,
      }),
    )
  }

  saveApiKey(created.key)
  clearPending()
  process.stdout.write(
    `✓ Signed in as ${email}.\n` +
      `✓ Created key ${created.prefix ?? 'srnd_…'}… and saved it to ${CONFIG_PATH}.\n` +
      (hadKey ? 'The existing key in the config was replaced.\n' : ''),
  )
}

/**
 * @param {string} email
 */
function writePending(email) {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(PENDING_PATH, `${JSON.stringify({ email, requestedAt: new Date().toISOString() })}\n`, {
      mode: 0o600,
    })
  } catch {
    // Best effort — verification does not depend on this file existing.
  }
}

function clearPending() {
  try {
    rmSync(PENDING_PATH, { force: true })
  } catch {
    /* best effort */
  }
}

/**
 * @param {string} key raw `srnd_…` value, returned once by the server
 */
function saveApiKey(key) {
  const next = { ...readConfigFile(), apiKey: key }
  mkdirSync(dirname(CONFIG_PATH), { recursive: true })
  writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  // `mode` only applies when the file is created; an older config written
  // world-readable keeps its bits, and it now holds a key.
  chmodSync(CONFIG_PATH, 0o600)
}

/**
 * Maps a status code to an English message for this step; anything unlisted
 * falls back to the server's own text, which `rawError` requests preserve
 * verbatim (e.g. "code is invalid or has expired").
 *
 * @param {unknown} error
 * @param {Record<number, string>} known
 * @returns {string}
 */
function describeError(error, known) {
  if (error instanceof ApiError) return known[error.status] ?? error.message
  return String(error?.message ?? error)
}

/**
 * @param {string} message
 */
function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
