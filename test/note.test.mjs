import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildNoteInput, clientIdFor, parseArguments } from '../lib/note.mjs'

// Pin the defaults so a developer's own ~/.sorenda/config.json cannot affect it.
process.env.SORENDA_TAGS = 'ai-chat, claude-code'

const session = {
  turns: [
    { role: 'user', content: 'вопрос' },
    { role: 'assistant', content: 'ответ' },
  ],
  title: 'Поиск',
  model: 'claude-opus-5',
  sessionId: '11111111-2222-3333-4444-555555555555',
  cwd: '/repo',
}

describe('buildNoteInput', () => {
  it('builds an aichat note the server will accept', () => {
    const { input, messageCount } = buildNoteInput(session)
    assert.equal(input.type, 'aichat')
    assert.equal(input.title, 'Поиск')
    assert.equal(input.text, '### You\n\nвопрос\n\n### Assistant\n\nответ')
    assert.deepEqual(input.tags, ['ai-chat', 'claude-code'])
    assert.equal(input.clientId, 'claude:11111111-2222-3333-4444-555555555555')
    assert.equal(messageCount, 2)
    const { capturedAt, ...meta } = input.data
    assert.deepEqual(meta, {
      source: 'claude-code',
      model: 'claude-opus-5',
      chatTitle: 'Поиск',
      messageCount: 2,
    })
    assert.equal(typeof capturedAt, 'string')
  })

  it('applies title and tag overrides', () => {
    const { input } = buildNoteInput(session, { title: 'Другой топик', tags: ['backend'] })
    assert.equal(input.title, 'Другой топик')
    assert.equal(input.data.chatTitle, 'Другой топик')
    assert.deepEqual(input.tags, ['ai-chat', 'claude-code', 'backend'])
  })

  it('omits an empty title rather than sending an empty string', () => {
    const { input } = buildNoteInput({ ...session, title: '' })
    assert.equal(input.title, undefined)
    assert.equal(input.data.chatTitle, undefined)
  })

  it('reports truncation', () => {
    const { truncated } = buildNoteInput(
      { ...session, turns: [{ role: 'user', content: 'x'.repeat(5000) }] },
      { maxBytes: 200 },
    )
    assert.equal(truncated, true)
  })
})

describe('clientIdFor', () => {
  it('stays inside the server cap', () => {
    assert.ok((clientIdFor('11111111-2222-3333-4444-555555555555').length) <= (64))
  })

  it('is stable for a session, so repeated saves update one note', () => {
    assert.equal(clientIdFor('abc'), clientIdFor('abc'))
  })

  it('falls back to something unique when the session id is missing', () => {
    assert.match(clientIdFor(''), /^claude:[0-9a-f]{40}$/)
  })
})

describe('parseArguments', () => {
  it('splits a topic from #tags', () => {
    assert.deepEqual(parseArguments('Рефакторинг поиска #backend #Поиск Кода'), {
      title: 'Рефакторинг поиска Кода',
      tags: ['backend', 'поиск'],
    })
  })

  it('handles empty input', () => {
    assert.deepEqual(parseArguments(''), { title: '', tags: [] })
    assert.deepEqual(parseArguments('   '), { title: '', tags: [] })
  })
})
