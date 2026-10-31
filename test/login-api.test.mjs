import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ApiError, createApiKey, requestOtp, verifyOtp } from '../lib/api.mjs'

process.env.SORENDA_API_URL = 'https://sorenda.test'
process.env.SORENDA_API_KEY = '' // the otp/key endpoints must not need this

/**
 * Swaps global fetch for one call, records what it was invoked with, and
 * restores it afterwards even if the test throws.
 *
 * @param {(url: string, init: RequestInit) => { status: number, body: unknown }} handler
 * @param {() => Promise<void>} run
 * @returns {Promise<{ url: string, init: RequestInit }>}
 */
async function withFetch(handler, run) {
  const original = globalThis.fetch
  /** @type {{ url: string, init: RequestInit }} */
  let captured
  globalThis.fetch = async (url, init) => {
    captured = { url, init }
    const { status, body } = handler(url, init)
    return new Response(JSON.stringify(body), { status })
  }
  try {
    await run()
  } finally {
    globalThis.fetch = original
  }
  return captured
}

describe('requestOtp', () => {
  it('posts without a personal API key', async () => {
    const call = await withFetch(
      () => ({ status: 200, body: { ok: true } }),
      () => requestOtp('a@b.com'),
    )
    assert.equal(call.url, 'https://sorenda.test/api/auth/otp/request')
    assert.equal(call.init.headers.Authorization, undefined)
    assert.deepEqual(JSON.parse(call.init.body), { email: 'a@b.com' })
  })

  it('surfaces the server error verbatim', async () => {
    await assert.rejects(
      withFetch(
        () => ({ status: 400, body: { error: 'valid email is required' } }),
        () => requestOtp(''),
      ),
      (error) => error instanceof ApiError && error.status === 400 && error.message === 'valid email is required',
    )
  })
})

describe('verifyOtp', () => {
  it('returns the session token', async () => {
    let session
    await withFetch(
      () => ({ status: 200, body: { token: 'jwt-123', user: { email: 'a@b.com' } } }),
      async () => {
        session = await verifyOtp('a@b.com', '000000')
      },
    )
    assert.equal(session.token, 'jwt-123')
  })

  it('does not mask a wrong-code 401 as an API-key error', async () => {
    await assert.rejects(
      withFetch(
        () => ({ status: 401, body: { error: 'code is invalid or has expired' } }),
        () => verifyOtp('a@b.com', '000000'),
      ),
      (error) => error.message === 'code is invalid or has expired',
    )
  })
})

describe('createApiKey', () => {
  it('authenticates with the given session token, not the configured api key', async () => {
    const call = await withFetch(
      () => ({ status: 201, body: { key: 'srnd_x', prefix: 'srnd_x' } }),
      () => createApiKey('jwt-123', 'claude-code (host)'),
    )
    assert.equal(call.url, 'https://sorenda.test/api/keys')
    assert.equal(call.init.headers.Authorization, 'Bearer jwt-123')
    assert.deepEqual(JSON.parse(call.init.body), { label: 'claude-code (host)', scopes: ['read', 'write'] })
  })

  it('surfaces a missing-subscription 403 verbatim', async () => {
    await assert.rejects(
      withFetch(
        () => ({ status: 403, body: { error: 'subscription required' } }),
        () => createApiKey('jwt-123', 'x'),
      ),
      (error) => error.status === 403 && error.message === 'subscription required',
    )
  })
})
