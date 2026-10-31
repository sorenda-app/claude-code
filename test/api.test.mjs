import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { noteUrl, parseTags } from '../lib/api.mjs'

process.env.SORENDA_API_URL = 'https://sorenda.test/'

describe('parseTags', () => {
  it('normalizes, dedupes and drops empties', () => {
    assert.deepEqual(parseTags(' #Backend, поиск кода , backend, ,'), ['backend', 'поиск-кода'])
  })

  it('handles missing input', () => {
    assert.deepEqual(parseTags(undefined), [])
    assert.deepEqual(parseTags(''), [])
  })
})

describe('noteUrl', () => {
  it('links to the topic and strips the trailing slash of the base url', () => {
    assert.equal(noteUrl({ title: 'Как устроен поиск' }), 'https://sorenda.test/app/topic/%D0%9A%D0%B0%D0%BA%20%D1%83%D1%81%D1%82%D1%80%D0%BE%D0%B5%D0%BD%20%D0%BF%D0%BE%D0%B8%D1%81%D0%BA')
  })

  it('falls back to the app root for an untitled note', () => {
    assert.equal(noteUrl({}), 'https://sorenda.test/app/')
  })
})
