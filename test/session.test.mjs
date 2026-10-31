import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { inferTitle, parseSession } from '../lib/session.mjs'

const fixture = readFileSync(fileURLToPath(new URL('./fixtures/session.jsonl', import.meta.url)), 'utf8')

describe('parseSession', () => {
  const session = parseSession(fixture)

  it('reads session metadata', () => {
    assert.equal(session.sessionId, '11111111-2222-3333-4444-555555555555')
    assert.equal(session.cwd, '/repo')
    assert.equal(session.model, 'claude-opus-5')
    assert.equal(session.title, 'Как устроен поиск')
  })

  it('alternates user and assistant turns', () => {
    assert.deepEqual(session.turns.map((turn) => turn.role), [
      'user',
      'assistant',
      'user',
      'assistant',
    ])
  })

  it('drops harness noise', () => {
    const all = session.turns.map((turn) => turn.content).join('\n')
    assert.ok(!(all).includes('injected by the harness'))
    assert.ok(!(all).includes('ignore me'))
    assert.ok(!(all).includes('secret reasoning'))
    assert.ok(!(all).includes('subagent chatter'))
    assert.ok(!(all).includes('package search'))
  })

  it('merges consecutive assistant records into one turn', () => {
    assert.equal(session.turns[1].content, 'Сейчас посмотрю.\n\n`→ Read backend/search.go`\n`→ Grep Manticore in backend`\n\nГибридный поиск: FTS плюс KNN.')
  })

  it('unwraps a slash command into what the user typed', () => {
    assert.equal(session.turns[2].content, '/init покороче')
  })

  it('survives unparseable lines', () => {
    assert.equal((session.turns).length, 4)
  })
})

describe('inferTitle', () => {
  it('takes the first line of the first user turn', () => {
    assert.equal(inferTitle([{ role: 'user', content: 'первый вопрос\nвторая строка' }]), 'первый вопрос')
  })

  it('truncates long lines', () => {
    const title = inferTitle([{ role: 'user', content: 'я'.repeat(300) }])
    assert.equal((title).length, 120)
    assert.equal(title.endsWith('…'), true)
  })

  it('returns an empty string when there is no user turn', () => {
    assert.equal(inferTitle([{ role: 'assistant', content: 'hi' }]), '')
  })
})
