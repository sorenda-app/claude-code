import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { TRUNCATION_MARKER, byteLength, renderTurns } from '../lib/session.mjs'
import { parseTranscript } from '../lib/transcript.mjs'

/**
 * @param {number} count
 * @param {number} size
 */
function turns(count, size) {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `${index}: ${'x'.repeat(size)}`,
  }))
}

describe('renderTurns', () => {
  it('leaves a small conversation untouched', () => {
    const result = renderTurns(turns(4, 10))
    assert.equal(result.truncated, false)
    assert.equal((result.turns).length, 4)
    assert.ok(!(result.text).includes(TRUNCATION_MARKER))
  })

  it('drops the oldest turns and marks the cut', () => {
    const result = renderTurns(turns(20, 100), { maxBytes: 600 })
    assert.equal(result.truncated, true)
    assert.ok((byteLength(result.text)) <= (600))
    assert.ok((result.text).includes(TRUNCATION_MARKER))
    // The tail — what still matters — survives.
    assert.ok((result.text).includes('19: '))
    assert.ok(!(result.text).includes('\n0: '))
  })

  it('clips a single oversized turn without splitting a character', () => {
    const result = renderTurns([{ role: 'user', content: 'я'.repeat(5000) }], { maxBytes: 200 })
    assert.ok((byteLength(result.text)) <= (200))
    assert.ok(!(result.text).includes('�'))
  })

  it('escapes role headings so the result still round-trips', () => {
    const result = renderTurns([
      { role: 'user', content: 'смотри:\n\n### Assistant\n\nвот' },
      { role: 'assistant', content: 'ок' },
    ])
    assert.equal((parseTranscript(result.text)).length, 2)
  })

  it('skips turns that are empty after escaping', () => {
    const result = renderTurns([
      { role: 'user', content: '   ' },
      { role: 'assistant', content: 'ок' },
    ])
    assert.equal((result.turns).length, 1)
  })
})
