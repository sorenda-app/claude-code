#!/usr/bin/env node
/**
 * Saves the current Claude Code session to Sorenda.
 *
 *   save.mjs --hook                 Stop hook: silent autosave, always exits 0
 *   save.mjs --command [--args "…"] /save: prints a human result
 *   save.mjs --dry-run [--transcript PATH]
 *                                   renders locally, no network
 *
 * A session maps to exactly one note, updated in place as the conversation
 * grows, so running this repeatedly is safe.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { ApiError, config, createNote, noteUrl, updateNote } from '../lib/api.mjs'
import { readHookInput } from '../lib/hook.mjs'
import { buildNoteInput, hashText, parseArguments } from '../lib/note.mjs'
import { parseSession } from '../lib/session.mjs'
import { log, readCurrent, readSessionState, writeSessionState } from '../lib/state.mjs'

const argv = process.argv.slice(2)
const MODE = argv.includes('--hook') ? 'hook' : 'command'
const DRY_RUN = argv.includes('--dry-run')

/**
 * @param {string} flag
 * @returns {string}
 */
function flagValue(flag) {
  const index = argv.indexOf(flag)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : ''
}

/**
 * Claude Code stores transcripts under a directory named after the working
 * directory with every non-alphanumeric character replaced by a dash.
 *
 * @param {string} cwd
 * @returns {string}
 */
function findTranscript(cwd) {
  const dir = join(homedir(), '.claude', 'projects', String(cwd).replace(/[^a-zA-Z0-9]/g, '-'))
  try {
    const newest = readdirSync(dir)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => ({ path: join(dir, name), mtime: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0]
    return newest?.path ?? ''
  } catch {
    return ''
  }
}

/**
 * Where the transcript is and which session it belongs to. The hook is told
 * directly; the command relies on the marker written by mark-session.mjs and
 * falls back to the newest transcript for this directory.
 *
 * @param {Record<string, any>} payload
 * @returns {{ transcriptPath: string, sessionId: string, cwd: string }}
 */
function resolveSource(payload) {
  const explicit = flagValue('--transcript')
  const cwd = payload.cwd || process.cwd()

  if (explicit) return { transcriptPath: explicit, sessionId: payload.session_id ?? '', cwd }
  if (payload.transcript_path) {
    return { transcriptPath: payload.transcript_path, sessionId: payload.session_id ?? '', cwd }
  }

  const marker = readCurrent(cwd)
  const transcriptPath =
    marker?.transcriptPath && existsSync(marker.transcriptPath)
      ? marker.transcriptPath
      : findTranscript(cwd)
  return { transcriptPath, sessionId: marker?.sessionId ?? '', cwd }
}

/**
 * Per-session toggle wins over the global default in ~/.sorenda/config.json.
 *
 * @param {import('../lib/state.mjs').SessionState} state
 * @returns {boolean}
 */
function autosaveEnabled(state) {
  if (typeof state.autosave === 'boolean') return state.autosave
  return config().autosave
}

/**
 * @param {string} message
 */
function fail(message) {
  if (MODE === 'hook') {
    log(message)
    process.exit(0)
  }
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

const payload = MODE === 'hook' ? await readHookInput() : {}
const source = resolveSource(payload)

if (!source.transcriptPath || !existsSync(source.transcriptPath)) {
  fail('Session transcript not found — nothing to save.')
}

let raw = ''
try {
  raw = readFileSync(source.transcriptPath, 'utf8')
} catch (error) {
  fail(`Could not read the transcript: ${error.message}`)
}

const session = parseSession(raw)
if (!session.sessionId) session.sessionId = source.sessionId
if (!session.cwd) session.cwd = source.cwd
if (session.turns.length === 0) fail('The session has no messages yet.')

// A note id only means something on the host it was created on, so switching
// SORENDA_API_URL must start over rather than patch a stranger's note id.
const apiUrl = config().apiUrl
const stored = readSessionState(session.sessionId)
const state = stored.apiUrl && stored.apiUrl !== apiUrl ? { autosave: stored.autosave } : stored

if (MODE === 'hook' && !DRY_RUN && !autosaveEnabled(state)) process.exit(0)

const { title: argTitle, tags: argTags } = parseArguments(flagValue('--args'))
const built = buildNoteInput(session, {
  // A topic chosen once by hand must survive later autosaves.
  title: argTitle || state.title || session.title,
  tags: argTags,
})
const textHash = hashText(built.text)

if (DRY_RUN) {
  process.stdout.write(`${built.text}\n`)
  process.stderr.write(
    `\n--- payload ---\n${JSON.stringify({ ...built.input, text: `<${built.text.length} chars>` }, null, 2)}\n`,
  )
  process.exit(0)
}

// Nothing changed since the last save — skip the round trip entirely.
if (state.textHash === textHash && state.noteId) {
  if (MODE === 'command') {
    process.stdout.write(`✓ Already saved — ${built.input.title ?? 'no topic'}\n`)
  }
  process.exit(0)
}

try {
  let note
  let created = false

  if (state.noteId && typeof state.version === 'number') {
    ;({ note } = await updateNote(state.noteId, built.input, state.version))
  } else {
    const result = await createNote(built.input)
    note = result.note
    created = !result.alreadySaved
    // The note already existed (state was lost): adopt it and push our text.
    if (result.alreadySaved && note?.id && typeof note.version === 'number') {
      ;({ note } = await updateNote(note.id, built.input, note.version))
    }
  }

  writeSessionState(session.sessionId, {
    noteId: note?.id,
    version: note?.version,
    textHash,
    apiUrl,
    title: built.input.title ?? '',
    transcriptPath: source.transcriptPath,
    cwd: session.cwd,
  })

  if (MODE === 'command') {
    const verb = created ? 'Saved' : 'Updated'
    const topic = built.input.title ? ` — ${built.input.title}` : ''
    const cut = built.truncated ? ', beginning truncated' : ''
    process.stdout.write(
      `✓ ${verb}${topic} (${built.messageCount} messages${cut})\n${noteUrl(note ?? {})}\n`,
    )
  }
} catch (error) {
  const message = error instanceof ApiError ? error.message : String(error?.message ?? error)
  fail(message)
}

process.exit(0)
