/**
 * Helpers shared by the hook entry points.
 *
 * Hooks receive their payload as JSON on stdin. A hook that throws, hangs or
 * prints noise degrades the user's session, so every reader here is bounded and
 * failure-tolerant.
 */

/**
 * @param {number} [timeoutMs]
 * @returns {Promise<Record<string, any>>}
 */
export async function readHookInput(timeoutMs = 2000) {
  if (process.stdin.isTTY) return {}

  const raw = await new Promise((resolve) => {
    let buffer = ''
    const done = (value) => {
      clearTimeout(timer)
      process.stdin.removeAllListeners()
      resolve(value)
    }
    const timer = setTimeout(() => done(buffer), timeoutMs)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      buffer += chunk
    })
    process.stdin.on('end', () => done(buffer))
    process.stdin.on('error', () => done(''))
  })

  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
