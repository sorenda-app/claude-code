import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MAX_LINE, formatToolUse } from '../lib/tools.mjs'

/**
 * @param {string} name
 * @param {Record<string, unknown>} input
 * @param {string} [cwd]
 */
const line = (name, input, cwd = '/repo') => formatToolUse({ name, input }, cwd)

describe('formatToolUse', () => {
  it('shortens file paths against the session cwd', () => {
    assert.equal(line('Read', { file_path: '/repo/frontend/src/App.tsx' }), '`→ Read frontend/src/App.tsx`')
  })

  it('keeps paths outside the cwd absolute', () => {
    assert.equal(line('Write', { file_path: '/etc/hosts' }), '`→ Write /etc/hosts`')
  })

  it('prefers a bash description over the command', () => {
    assert.equal(line('Bash', { command: 'ls -la', description: 'List files' }), '`→ Bash List files`')
    assert.equal(line('Bash', { command: 'ls -la\ncd /tmp' }), '`→ Bash ls -la`')
  })

  it('renders a subagent as Agent(type)', () => {
    assert.equal(line('Task', { subagent_type: 'Explore', description: 'Find the router' }), '`→ Agent(Explore) Find the router`')
  })

  it('renders search tools with their pattern', () => {
    assert.equal(line('Grep', { pattern: 'TODO', path: 'backend' }), '`→ Grep TODO in backend`')
    assert.equal(line('Glob', { pattern: '**/*.go' }), '`→ Glob **/*.go`')
  })

  it('falls back to the first scalar argument for unknown tools', () => {
    assert.equal(line('mcp__sorenda__create_note', { title: 'заметка', extra: { a: 1 } }), '`→ mcp__sorenda__create_note заметка`')
  })

  it('renders a bare tool name when there is nothing to show', () => {
    assert.equal(line('AskUserQuestion', { questions: [{ header: 'x' }] }), '`→ AskUserQuestion`')
  })

  it('collapses whitespace and clips long lines', () => {
    const result = line('Bash', { description: 'x'.repeat(400) })
    assert.equal(result.length, MAX_LINE + 2) // backticks
    assert.equal(result.endsWith('…`'), true)
    assert.equal(line('Bash', { description: 'a\n  b' }), '`→ Bash a b`')
  })
})
