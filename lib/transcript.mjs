/**
 * Wire format for AI chat transcripts.
 *
 * The transcript lives in `note.text` as plain markdown (plugin `data` is
 * capped at 8 KiB server-side, which no real conversation fits into). Turns are
 * delimited by a heading carrying a fixed English role token:
 *
 *     ### You
 *
 *     what is nginx?
 *
 *     ### Assistant
 *
 *     nginx is …
 *
 * Fixed tokens keep the note readable as ordinary markdown in every client
 * (macOS renders the raw text) while staying parseable back into turns. Display
 * labels are localized by the card, not stored.
 *
 * `render` and `parse` must stay inverse — see transcript.test.mjs. The web app,
 * the mobile client and the Raycast extension carry byte-identical copies of
 * this module, and this plugin a JavaScript port of it; change all four
 * together:
 *   frontend/src/plugins/aichat/transcript.ts
 *   mobile/src/plugins/aichat/transcript.ts
 *   raycast/src/lib/transcript.ts
 *   claude-code/lib/transcript.mjs
 *
 * @typedef {'user' | 'assistant'} ChatRole
 * @typedef {{ role: ChatRole, content: string }} ChatTurn
 */

export const USER_HEADING = '### You'
export const ASSISTANT_HEADING = '### Assistant'

const USER_ALIASES = new Set(['you', 'me', 'user', 'question', 'prompt', 'вы', 'я', 'вопрос'])
const ASSISTANT_ALIASES = new Set([
  'assistant',
  'ai',
  'answer',
  'response',
  'raycast ai',
  'ассистент',
  'ответ',
])

/** Matches a role heading line: 2–4 hashes, a role token, nothing else. */
const HEADING_RE = /^#{2,4}\s+(.+?)\s*$/

/**
 * @param {string} text
 * @returns {ChatRole | null}
 */
function roleForHeading(text) {
  const token = text
    .replace(/[*_`:]/g, '')
    .trim()
    .toLowerCase()
  if (USER_ALIASES.has(token)) return 'user'
  if (ASSISTANT_ALIASES.has(token)) return 'assistant'
  return null
}

/**
 * Splits a stored transcript into turns. Returns null when the text carries no
 * role headings at all, so callers can fall back to rendering it as-is.
 *
 * @param {string} text
 * @returns {ChatTurn[] | null}
 */
export function parseTranscript(text) {
  if (!text.trim()) return null

  /** @type {ChatTurn[]} */
  const turns = []
  /** @type {{ role: ChatRole, lines: string[] } | null} */
  let current = null
  let inFence = false

  for (const line of text.split('\n')) {
    // Headings inside fenced code are content, not delimiters.
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence

    if (!inFence) {
      const heading = HEADING_RE.exec(line)
      const role = heading ? roleForHeading(heading[1]) : null
      if (role) {
        if (current) turns.push({ role: current.role, content: current.lines.join('\n').trim() })
        current = { role, lines: [] }
        continue
      }
    }

    if (current) current.lines.push(line)
  }
  if (current) turns.push({ role: current.role, content: current.lines.join('\n').trim() })

  const kept = turns.filter((turn) => turn.content !== '')
  return kept.length > 0 ? kept : null
}

/**
 * Serializes turns into the stored markdown format. Inverse of parseTranscript.
 *
 * @param {ChatTurn[]} turns
 * @returns {string}
 */
export function renderTranscript(turns) {
  return turns
    .filter((turn) => turn.content.trim() !== '')
    .map((turn) => {
      const heading = turn.role === 'user' ? USER_HEADING : ASSISTANT_HEADING
      return `${heading}\n\n${turn.content.trim()}`
    })
    .join('\n\n')
}

/**
 * Demotes headings inside turn content that would otherwise be read back as
 * role delimiters. A user pasting "### Assistant" into a prompt must not split
 * the stored transcript in two; inside fenced code the parser already ignores
 * headings, so those are left alone.
 *
 * Not part of the shared wire format — only this plugin renders content it did
 * not itself write turn by turn.
 *
 * @param {string} content
 * @returns {string}
 */
export function escapeRoleHeadings(content) {
  let inFence = false
  return content
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence
        return line
      }
      if (inFence) return line
      const heading = HEADING_RE.exec(line)
      // Five hashes fall outside the parser's #{2,4} window, so the line stays
      // a heading visually but no longer delimits a turn.
      if (heading && roleForHeading(heading[1]) !== null) {
        return line.replace(/^(\s*)#{2,4}(\s+)/, '$1#####$2')
      }
      return line
    })
    .join('\n')
}
