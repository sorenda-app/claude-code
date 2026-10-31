#!/usr/bin/env node
/**
 * UserPromptSubmit / SessionStart hook.
 *
 * Records which session is live in the current working directory, so that
 * /save — which runs in its own process and is told nothing about the
 * session — can find the right transcript. No network, no output, never fails.
 */

import { readHookInput } from '../lib/hook.mjs'
import { writeCurrent } from '../lib/state.mjs'

const payload = await readHookInput()

writeCurrent({
  sessionId: payload.session_id ?? '',
  transcriptPath: payload.transcript_path ?? '',
  cwd: payload.cwd ?? process.cwd(),
})

process.exit(0)
