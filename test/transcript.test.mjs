import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ASSISTANT_HEADING,
  USER_HEADING,
  escapeRoleHeadings,
  parseTranscript,
  renderTranscript,
} from '../lib/transcript.mjs'

describe('renderTranscript / parseTranscript', () => {
  const turns = [
    { role: 'user', content: 'what is nginx?' },
    { role: 'assistant', content: 'a web server' },
  ]

  it('renders the fixed heading format', () => {
    assert.equal(renderTranscript(turns), `${USER_HEADING}\n\nwhat is nginx?\n\n${ASSISTANT_HEADING}\n\na web server`)
  })

  it('round-trips', () => {
    assert.deepEqual(parseTranscript(renderTranscript(turns)), turns)
  })

  it('accepts alias headings and other heading levels', () => {
    const parsed = parseTranscript('## Вопрос\n\nпривет\n\n#### **AI:**\n\nответ')
    assert.deepEqual(parsed, [
      { role: 'user', content: 'привет' },
      { role: 'assistant', content: 'ответ' },
    ])
  })

  it('treats headings inside fenced code as content', () => {
    const text = `${USER_HEADING}\n\n\`\`\`md\n### Assistant\n\`\`\``
    assert.deepEqual(parseTranscript(text), [
      { role: 'user', content: '```md\n### Assistant\n```' },
    ])
  })

  it('returns null when nothing parses', () => {
    assert.equal(parseTranscript('просто текст'), null)
    assert.equal(parseTranscript('   '), null)
  })

  it('drops empty turns', () => {
    assert.equal(renderTranscript([{ role: 'user', content: '  ' }, ...turns]), renderTranscript(turns))
  })
})

describe('escapeRoleHeadings', () => {
  it('demotes a role heading so it cannot split the transcript', () => {
    assert.equal(escapeRoleHeadings('### Assistant\n\ntext'), '##### Assistant\n\ntext')
  })

  it('leaves ordinary headings alone', () => {
    assert.equal(escapeRoleHeadings('### Архитектура'), '### Архитектура')
  })

  it('leaves headings inside fenced code alone', () => {
    const text = '```md\n### You\n```'
    assert.equal(escapeRoleHeadings(text), text)
  })

  it('keeps the round trip intact for content containing role headings', () => {
    const content = 'сравни форматы:\n\n### You\n\nи всё'
    const turns = [{ role: 'user', content: escapeRoleHeadings(content) }]
    assert.equal((parseTranscript(renderTranscript(turns))).length, 1)
  })
})
