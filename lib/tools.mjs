/**
 * Renders a `tool_use` block from a Claude Code transcript as one compact line.
 *
 * Tool calls are what makes a coding session worth re-reading later ("what did
 * it actually touch?"), but their inputs are huge. One inline-code line per call
 * keeps the note readable and, being inline code rather than a heading, cannot
 * disturb the transcript's role delimiters.
 */

/** Longest line we will emit, ellipsis included. */
export const MAX_LINE = 120

/**
 * @param {string} value
 * @param {number} [limit]
 * @returns {string}
 */
function clip(value, limit = MAX_LINE) {
  const flat = String(value).replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat
}

/**
 * Shortens an absolute path to something relative to the session's cwd, so the
 * note reads `frontend/src/App.tsx` rather than `/Users/…/frontend/src/App.tsx`.
 *
 * @param {unknown} value
 * @param {string} [cwd]
 * @returns {string}
 */
function relative(value, cwd) {
  if (typeof value !== 'string') return ''
  if (!cwd) return value
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`
  return value.startsWith(base) ? value.slice(base.length) : value
}

/**
 * @param {Record<string, unknown> | undefined} input
 * @param {string[]} keys
 * @returns {string}
 */
function firstString(input, keys) {
  if (!input) return ''
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

/** @type {Record<string, (input: Record<string, unknown>, cwd?: string) => string>} */
const FORMATTERS = {
  Read: (input, cwd) => relative(input.file_path, cwd),
  Write: (input, cwd) => relative(input.file_path, cwd),
  Edit: (input, cwd) => relative(input.file_path, cwd),
  NotebookEdit: (input, cwd) => relative(input.notebook_path ?? input.file_path, cwd),
  Bash: (input) => firstString(input, ['description']) || String(input.command ?? '').split('\n')[0],
  BashOutput: (input) => String(input.bash_id ?? ''),
  Glob: (input) => String(input.pattern ?? ''),
  Grep: (input) => {
    const pattern = String(input.pattern ?? '')
    const path = typeof input.path === 'string' ? ` in ${input.path}` : ''
    return `${pattern}${path}`
  },
  Task: (input) => {
    const type = firstString(input, ['subagent_type']) || 'agent'
    const what = firstString(input, ['description'])
    return `(${type}) ${what}`.trim()
  },
  Agent: (input) => FORMATTERS.Task(input),
  WebFetch: (input) => String(input.url ?? ''),
  WebSearch: (input) => String(input.query ?? ''),
  Skill: (input) => firstString(input, ['skill', 'command']),
  TaskCreate: (input) => firstString(input, ['subject']),
  TaskUpdate: (input) => firstString(input, ['subject', 'status', 'taskId']),
  SendMessage: (input) => firstString(input, ['to']),
}

/**
 * Formats a single tool_use block. `Task` is rendered as `Agent(type)` because
 * that is how the user thinks of it, regardless of the internal tool name.
 *
 * @param {{ name?: string, input?: Record<string, unknown> }} block
 * @param {string} [cwd]
 * @returns {string}
 */
export function formatToolUse(block, cwd) {
  const name = typeof block?.name === 'string' && block.name ? block.name : 'Tool'
  const input = block?.input && typeof block.input === 'object' ? block.input : {}

  const formatter = FORMATTERS[name]
  const detail = formatter ? formatter(input, cwd) : fallbackDetail(input)
  // `Agent(Explore) …` reads as one token; every other tool gets a plain space.
  const label = name === 'Task' || name === 'Agent' ? 'Agent' : `${name} `
  const line = detail ? `→ ${label}${detail}`.trim() : `→ ${label}`.trim()
  return `\`${clip(line)}\``
}

/**
 * Unknown tools (MCP servers, plugins) still get something useful: the first
 * short scalar argument, which is usually a path, id or query.
 *
 * @param {Record<string, unknown>} input
 * @returns {string}
 */
function fallbackDetail(input) {
  for (const value of Object.values(input)) {
    if (typeof value === 'string' && value.trim() && value.length <= 200) return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  }
  return ''
}
