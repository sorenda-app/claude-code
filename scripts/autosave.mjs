#!/usr/bin/env node
/**
 * Turns autosaving on or off.
 *
 *   autosave.mjs on|off             this session only
 *   autosave.mjs on|off --global    default for every new session
 *   autosave.mjs status             what is in effect right now, and why
 *
 * The per-session flag lives in the session's state file, the global default in
 * ~/.sorenda/config.json, so both survive a restart and are readable by the
 * Stop hook, which runs in a separate process.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { CONFIG_PATH, config, readConfigFile } from '../lib/api.mjs'
import { readCurrent, readSessionState, writeSessionState } from '../lib/state.mjs'

const argv = process.argv.slice(2)
const GLOBAL = argv.includes('--global')
const action = argv.find((arg) => !arg.startsWith('--')) ?? 'status'

if (!['on', 'off', 'status'].includes(action)) {
  process.stderr.write(`Unknown action: ${action}. Expected on, off, or status.\n`)
  process.exit(1)
}

const marker = readCurrent(process.cwd())
const sessionId = marker?.sessionId ?? ''

if (action === 'status') {
  const state = sessionId ? readSessionState(sessionId) : {}
  const global = config().autosave
  const effective = typeof state.autosave === 'boolean' ? state.autosave : global
  const reason = typeof state.autosave === 'boolean' ? 'this session setting' : 'global default'
  process.stdout.write(
    `Autosave: ${effective ? 'on' : 'off'} (${reason})\n` +
      `Global default: ${global ? 'on' : 'off'} (${CONFIG_PATH})\n`,
  )
  process.exit(0)
}

const enabled = action === 'on'

if (GLOBAL) {
  const next = { ...readConfigFile(), autosave: enabled }
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true })
    writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  } catch (error) {
    process.stderr.write(`Could not write ${CONFIG_PATH}: ${error.message}\n`)
    process.exit(1)
  }
  process.stdout.write(
    `✓ Autosave ${enabled ? 'enabled' : 'disabled'} by default for all sessions.\n`,
  )
  process.exit(0)
}

if (!sessionId) {
  process.stderr.write(
    'Could not identify the current session. Use --global, or send a request and try again.\n',
  )
  process.exit(1)
}

writeSessionState(sessionId, { autosave: enabled })
process.stdout.write(
  `✓ Autosave ${enabled ? 'enabled' : 'disabled'} for this session.\n` +
    (enabled ? 'The note will be updated after every response.\n' : ''),
)
process.exit(0)
