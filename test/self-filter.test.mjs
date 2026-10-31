import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseSession } from '../lib/session.mjs'

/**
 * Builds a minimal two-record turn: a user prompt (raw content) followed by an
 * assistant tool_use running one of the plugin's own scripts.
 *
 * @param {string} userContent
 * @param {string} scriptCommand
 * @returns {string}
 */
function selfSaveExchange(userContent, scriptCommand) {
  const sessionId = 's1'
  return [
    JSON.stringify({
      type: 'user',
      isSidechain: false,
      cwd: '/repo',
      sessionId,
      message: { role: 'user', content: userContent },
    }),
    JSON.stringify({
      type: 'assistant',
      isSidechain: false,
      cwd: '/repo',
      sessionId,
      message: {
        role: 'assistant',
        model: 'claude-opus-5',
        content: [{ type: 'tool_use', name: 'Bash', input: { command: scriptCommand } }],
      },
    }),
  ].join('\n')
}

describe('self-invocation filtering', () => {
  it('drops a /save invocation and its script call entirely', () => {
    const jsonl = selfSaveExchange(
      '<command-name>/save</command-name><command-args>#backend</command-args>',
      'node "${CLAUDE_PLUGIN_ROOT}/scripts/save.mjs" --command --args "#backend"',
    )
    assert.deepEqual(parseSession(jsonl).turns, [])
  })

  it('drops a /autosave invocation and its script call entirely', () => {
    const jsonl = selfSaveExchange(
      '<command-name>/autosave</command-name><command-args>on</command-args>',
      'node "${CLAUDE_PLUGIN_ROOT}/scripts/autosave.mjs" on',
    )
    assert.deepEqual(parseSession(jsonl).turns, [])
  })

  it('drops a plugin-namespaced invocation too', () => {
    const jsonl = selfSaveExchange(
      '<command-name>/sorenda:save</command-name>',
      'node "${CLAUDE_PLUGIN_ROOT}/scripts/save.mjs" --command --args ""',
    )
    assert.deepEqual(parseSession(jsonl).turns, [])
  })

  it('leaves an unrelated slash command visible', () => {
    const jsonl = selfSaveExchange(
      '<command-name>/init</command-name><command-args>покороче</command-args>',
      'echo done',
    )
    const turns = parseSession(jsonl).turns
    assert.equal(turns[0].role, 'user')
    assert.equal(turns[0].content, '/init покороче')
  })

  it('drops a /login invocation carrying an email and OTP code', () => {
    const jsonl = selfSaveExchange(
      '<command-name>/login</command-name><command-args>a@b.com 048213</command-args>',
      'node "${CLAUDE_PLUGIN_ROOT}/scripts/login.mjs" a@b.com 048213',
    )
    const session = parseSession(jsonl)
    assert.deepEqual(session.turns, [])
    assert.ok(!JSON.stringify(session).includes('048213'))
    assert.ok(!JSON.stringify(session).includes('a@b.com'))
  })

  it('drops the script-invoking tool call even without command-name wrapping', () => {
    const jsonl = selfSaveExchange(
      'сохрани сессию',
      'node "${CLAUDE_PLUGIN_ROOT}/scripts/save.mjs" --command --args ""',
    )
    const turns = parseSession(jsonl).turns
    // The user turn survives (it's an ordinary message), the assistant turn
    // does not (its only content was the filtered tool call).
    assert.deepEqual(
      turns.map((turn) => turn.role),
      ['user'],
    )
  })
})
