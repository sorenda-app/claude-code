# Sorenda for Claude Code

Saves your Claude Code sessions to Sorenda as `aichat` notes. Save one on
demand with `/save`, or turn on autosave and it keeps updating after every
reply.

It reads the actual session file from disk, so what gets saved is the real
conversation — not a summary or a retyped paraphrase.

## Install

```bash
/plugin marketplace add sorenda-app/claude-code
/plugin install sorenda@sorenda
```

From a local clone — add the marketplace first (its manifest lives at the
plugin's repo root), then install the plugin by name:

```bash
claude plugin marketplace add ./
claude plugin install sorenda@sorenda
```

`claude plugin install` does not take a directory path. After changing the
plugin: `claude plugin marketplace update sorenda`, then reinstall.

Needs Node.js 18+ (standard library only, no dependencies).

## Setup

The easiest way — right from chat, no browser needed:

```
/login you@example.com
```

Sorenda emails a 6-digit code (the same email sign-in the web app uses; an
account is created automatically on first login). Then:

```
/login you@example.com 123456
```

The command exchanges the code for a short-lived session, creates a personal
API key (`srnd_…`, requires an active subscription), and saves it to
`~/.sorenda/config.json` itself. There's no key to copy by hand, and the
session token is never written to disk. Both the email and the code are
stripped from Claude Code's history when a session is saved — see "How it
works" below.

You can also set a key by hand — for example, to point a single run at a
different Sorenda instance:

```bash
export SORENDA_API_KEY=srnd_…
export SORENDA_API_URL=https://sorenda.app   # default
export SORENDA_TAGS="ai-chat, claude-code"   # default tags
```

Environment variables take priority over `~/.sorenda/config.json`.

## Commands

```
/login you@example.com             request a code and sign in
/login you@example.com 123456      verify the code, create a key
/save                              save the current session
/save Search refactor #backend     set a topic and add tags
/autosave on                       autosave for this session
/autosave off --global             turn off the default for all sessions
/autosave status                   what's in effect right now, and why
```

The topic (`title`) is a Sorenda topic: every note sharing a title forms one
chain. A topic set by hand survives later autosaves. A session's own setting
overrides the global default.

## Knowledge base skill

The plugin also ships a skill, `organize`, that turns your notes into a
compounding knowledge base: it files sources into interlinked topics, answers
questions across everything you've accumulated, and health-checks the result —
instead of re-reading raw documents on every question. It works through the
Sorenda MCP server the plugin connects (`/mcp/v2`, signed in with OAuth the
first time a tool runs), separate from the session-saving commands above, and it only ever *proposes* changes —
structured proposals in your AI inbox, each with evidence quoted from your
notes, which you accept or reject — it never edits your existing notes. Ask
Claude to "ingest this into my Sorenda notes" (or lint them) and the skill
loads on its own; see `skills/organize/SKILL.md`.

## Team workspaces

The same MCP server reaches the team workspaces you open to it on the sign-in
page (and later under Profile → Agents → Connected apps in Sorenda). Searches
cover your notes and every opened workspace; each result says where it came
from. In a workspace the assistant only proposes: `/save-to-team <workspace>`
files what the session decided in that workspace's AI inbox, quoting your own
words, and a member of the team accepts or rejects it. Set `SORENDA_MCP_URL`
to point the server at a local stack (e.g. `http://localhost:3000/mcp/v2`).

## How it works

One session maps to one note, updated as the conversation grows: `clientId`
is tied to the session id, so saving again never creates a copy. If local
state is lost, the server matches on that same `clientId`, returns the
existing note, and the plugin picks up where it left off.

The note gets the user's messages, Claude's text replies, and one line per
tool call:

```md
### You

how does search work?

### Assistant

Let me take a look.

`→ Read backend/internal/search/search.go`
`→ Grep Manticore in backend`

Hybrid search: full-text plus KNN, results merged with RRF.
```

Left out: reasoning (`thinking`), tool output, subagent chatter, harness
wrappers, and talking to the plugin itself — invocations of `/save`,
`/autosave` and `/login` (along with the script call they make) are stripped
from the transcript. For `/save` and `/autosave` that's to avoid recursion
(otherwise saving a chat becomes a turn in that same chat); for `/login`
it's also because the command's arguments are an email address and the code
from that email, neither of which belongs in a saved note. The transcript
format is shared with the other clients — see `lib/transcript.mjs`. If a
conversation doesn't fit the note's limit (100,000 bytes), the oldest turns
are dropped, not the newest, with a marker left in the text.

### Hooks

| Event | What it does |
| --- | --- |
| `UserPromptSubmit`, `SessionStart` | records which session is active in this directory — without it, the slash command wouldn't know which transcript to read |
| `Stop` | autosave, if it's turned on |

Hooks always exit successfully and print nothing: an unreachable network or a
bad key must never break the session. Errors go to
`~/.sorenda/claude-code/log`. If the text hasn't changed since the last save,
no request is made at all.

State lives under `~/.sorenda/claude-code/`: `sessions/` — what's already
been saved per session (pruned after 30 days), `current/` — the active
session per directory.

## Development

```bash
npm test   # node --test, no dependencies
```

No dependencies is intentional: installing a plugin copies it whole into
`~/.claude/plugins/cache/`, so a `node_modules` with a test runner in it would
drag an extra twenty-odd megabytes into every install. That's also why this
uses `node:test` instead of a package like vitest.

See what a save would produce without sending anything to the server:

```bash
node scripts/save.mjs --dry-run --transcript ~/.claude/projects/<project>/<session>.jsonl
```

The session file format is internal to Claude Code and changes between
releases, so the parser in `lib/session.mjs` is deliberately lenient: unknown
record types and lines that fail to parse are skipped. The worst a format
change should do is produce a thinner note, never a broken session.

`lib/transcript.mjs` is a copy of the shared transcript format; when it
changes, update it together with `frontend/src/plugins/aichat/transcript.ts`
and `mobile/src/plugins/aichat/transcript.ts`.

This directory is also published as a standalone public repository,
[sorenda-app/claude-code](https://github.com/sorenda-app/claude-code), updated
by hand on each release — see its README for the note about that mirror.
