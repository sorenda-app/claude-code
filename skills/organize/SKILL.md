---
name: organize
description: Maintain a personal knowledge wiki inside Sorenda notes. Use when the user wants to ingest a source (article, page, paper, chat) into their notes, file a backlog of untitled notes onto pages, ask questions across accumulated notes, or health-check ("lint") the wiki. Works through the Sorenda MCP server this plugin connects (/mcp/v2): the user's personal notes and the team workspaces they opened to it.
---

# Sorenda as an LLM knowledge base

Build and maintain a compounding knowledge base in the user's Sorenda notes,
instead of re-deriving answers from raw sources on every question. You do the
grunt work — reading, cross-referencing, filing; the user sources and asks.

## The model: topics are pages, notes are claims

Sorenda stores short cards, not long documents, so a "page" is not one
note — it is a **topic** (a shared note title), and the notes carrying that
title are the accumulated **claims** about it. This is why a page grows by
*appending* a note rather than rewriting a blob, and why two contradictory
findings can sit side by side as two dated notes.

- Link topics with `[[Topic]]` wiki links in note text. `[[Topic|alias]]` and
  `[[Topic#heading]]` work; the target is the part before `|` and `#`. The
  server extracts these on save, so a topic can be asked for its inbound links.
- Link one specific note with `[[n-xxxxxx|label]]`, where `n-xxxxxx` is that
  note's `linkSlug`. It is the only way to point at a note with no topic. Most
  notes have no slug until something asks for one: when `linkSlug` is missing
  from what you read, call `get_note_link_slug`. **Never build a slug from a
  note's id** — an id is not a slug, and the link silently resolves as a topic
  that does not exist.
- A note's `title` is its topic. Give every claim a topic so it joins a page.
- Cite sources with `derivedFrom`: the ids of the source notes a claim was
  distilled from. This is the provenance a later lint pass needs.

## Hard rule: you propose, the user decides

**Every change you want to make goes through `propose_edit`. You never
`update_note` or `delete_note` on the user's own notes.** A proposal lands in
the user's AI inbox, where they accept or reject it; accepting is what actually
edits the wiki, and only a person can do that. In a team workspace this is
enforced for you: there the connection can only read and propose, whatever the
user's own role. In personal notes it may add notes, and you still propose
every change to an existing one.

`propose_edit` takes one `kind`, and the kind decides what else it needs:

| kind | what it does | required |
|---|---|---|
| `claim` | a new standalone idea for a page | `topic`, `text` |
| `summary` | the overview a busy page should open with | `topic`, `text` |
| `refine` | correct or expand one existing note | `targetId`, `text` |
| `contradiction` | a source disagrees with what a note claims | `targetId`, `text` |
| `link` | weave `[[wiki links]]` into an existing note | `targetId`, `links` |
| `merge` | two notes say the same thing; keep one | `targetId`, `mergeFromId`, `text` |
| `file` | put a note on the page it belongs to | `targetId`, `topic` |

A few things to get right:

- A `claim` is a key idea written as self-contained prose — usually two to four
  sentences that name the subject, carry the context making it meaningful
  (when, under what conditions, the figures that matter) and give the reason or
  consequence behind it. A one-line fragment that only makes sense with the
  source open is not a claim; the page has to read on its own months later.
- A `claim` can also be a typed card: set `type` to a card type the user has
  (`list_note_types`, `list_custom_note_types`) and fill its fields in `data`.
  Do it only when the source really supplies the fields — a contact with a name,
  company and role, an event with a date and place. A card with one field filled
  in is worse than the prose claim it replaced; when in doubt, write prose.
- For `refine`, `contradiction` and `merge`, **`text` is the target note's
  complete new body**, not a patch and not the changed sentence on its own.
  Preserve every fact, link, image and attachment the original carried except
  the one you are changing — the server rejects a rewrite that drops an
  attachment, and the user is reading a diff, so anything you silently lose is
  something they have to catch.
- For `file`, send no `text` either. It changes the note's topic and tags and
  not one word of what the note says, which is what makes it the safest thing
  to propose and the only way an untitled note ever joins a page. Optional
  `tags` are additive and capped at three; the server rewrites them to the
  user's existing spellings. Use it for a note that has no topic at all — not
  to reword a page name the user chose.
- For `link`, send no `text` at all. Each entry's `anchor` must be a phrase
  copied character-for-character out of the target note and occurring exactly
  once in it; the server wraps that phrase in place. Omit the anchor when no
  such phrase exists and the link goes to a trailing "see also" line instead.
- Always write a `rationale`. It is the one sentence the user reads before
  deciding, so say what changes and why — not what the text already says.
- Read each target first and pass its `version` as `targetVersion`; for a
  merge, also pass the absorbed note's version as `mergeFromVersion`.
- Always include `evidence`: one to four short `{noteId, excerpt}` entries.
  Copy each excerpt character-for-character from a note you read and keep it
  to the minimum text that proves the change. Use `source: "fields"` for
  `readableFields`. For an article, document, meeting or AI chat, read
  `get_source_content` and pass its `kind` as `source`, its `revision` as
  `sourceRevision`, and its `url` when present. Page through `nextCursor` if
  needed; a changed revision means restart reading. This reads saved material
  without fetching, running OCR or spending credits. The server rejects
  invented or paraphrased evidence.

You are not the only one filing proposals: with the wiki agent enabled, the
server reads each note as it settles and works through lint findings on a
schedule, into the same inbox. **Call `list_ai_proposals` before you propose**,
or you will suggest something that is already sitting there unreviewed. By
default it only returns pending proposals — call it with `status: "rejected"`
too, and use those decisions to understand what the user wants. The server
suppresses exact repeats, pending/stale subjects, standing rejections and
recent acceptances through the same admission policy as its own agent.
`not_proposed` is a normal refusal; do not retry it. On a version conflict,
reread the target and reconsider the proposed change.

## Before anything: accounts and conventions

Call `get_context` first. It lists every account this connection reaches —
the user's personal notes and each team workspace they opened to you — with
its busiest pages and the user's conventions for it, the prompt Sorenda’s own
passes read —
naming rules, which topics are canonical, what to emphasize. Follow it over the
defaults here. If none exists, offer to create one (a normal note titled
`ai-schema`) as you learn the user's preferences. Propose additions to it with
`propose_edit` like anything else.

The server's own agent reads the same note on every pass, so a convention
written there steers both of you. That makes `ai-schema` the highest-leverage
thing in the wiki: a naming rule recorded once is applied by every later pass,
where the same correction made in chat is forgotten as soon as the session ends.

## Team workspaces

A workspace is a team's shared notes. Searches without `workspace` cover every
account and every result names its `account`: say which one a fact came from.
Pass `workspace` (a name or id from `list_workspaces`) to aim a call at one.
In a workspace, file everything as a proposal: `propose_edit` for changes, and
`save` for something the conversation decided, which files it in that
workspace's AI inbox quoting the user's own words. Evidence must come from the
same account as the proposal. Tell the user a member of the team decides.

## Naming pages and tags

These are the defaults when `ai-schema` says nothing. A split page — the same
subject under two names — is the most common way a wiki goes wrong, and it is
almost always made at the moment a name is chosen.

- **Look before you name.** `list_topics` and check for the subject under any
  spelling: other case, singular or plural, a synonym, the other language (this
  user may keep notes in Russian and English alike). An existing name is reused
  exactly as written, even when you would have spelled it differently.
- **A new page name is its subject**, as a short noun phrase a heading would
  use: `Rust ownership`, not `Notes on how ownership works in Rust`. No dates,
  statuses or "todo" in a name — those belong in the claims.
- **Write it in the language the user already writes about that subject in.**
  Never translate an existing name.
- **Tags are facets, not subjects.** The subject is the topic; a tag says what
  kind of thing a note is or what it belongs to across pages (`source`, a
  project, a status). `list_tags` first and reuse the user's vocabulary; add a
  new tag only when nothing fits, and never more than one or two per note.

If the user has no `ai-schema` yet and you notice a convention they keep —
a language per area, a naming pattern, a tag they always use — offer to record
it. A useful first version is short:

```markdown
- Page names: short noun phrases, in the language of the notes on that subject.
- Canonical pages: <names that exist under several spellings, and the one to use>.
- Tags: <the user's facets and what each means>.
- Emphasis: <what the user wants kept, e.g. figures and dates over opinions>.
```

## Operations

### Ingest a source

1. Read the source. If it is already a Sorenda note (a saved webpage, document,
   or AI chat), `get_notes` it and keep its id for `derivedFrom`. If the user
   pasted raw material, save it as a source note first (`create_note`, tag it
   `source`) so proposals can cite a stable id. Pass a `clientId` that names
   the material — its URL, or a hash of the text — so ingesting the same thing
   twice returns the note already saved instead of a copy.
2. Find where it lands: `search_notes` (use `semantic: true` when the user has
   a subscription) for the concepts it touches, and `list_topics` to see
   existing pages. Then **`get_topic` on each candidate** — it returns the
   page's summary, its notes in order, and what links to it in one call, which
   is what you need before proposing anything and what you would otherwise
   assemble from three. Prefer an existing topic over inventing a
   near-duplicate. `get_notes` reads a batch of ids at once when you already
   know which notes you need.
3. Discuss the key takeaways with the user in chat.
4. `list_ai_proposals` to see what is already pending, then `propose_edit` once
   per distinct change — `claim` for a new fact, `refine` for something the
   source corrects or expands, `contradiction` where it disagrees, `link` where
   an existing note should point at a page it talks about. Cite the source in
   `derivedFrom` every time. Before a `claim`, check the page you just read: if
   a note there already says most of it, that is a `refine` of that note, not
   a second claim beside it.
5. Tell the user how many proposals landed and what they cover.

Rank before you file. Every proposal costs the user a decision, so propose the
few changes that matter most — a handful per source, not one per sentence — and
list the rest in chat for the user to ask for. The server's own agent stops
filing once 30 proposals are pending, so a flood from you also silences it.

Some may already be there without you: with the wiki agent on, the server
distils every saved article, document and AI chat by itself. `list_ai_proposals`
answers this, and `get_note_links` with `direction: "citations"` on the source
shows what it has already contributed.

### Query

1. Use `search_notes` to find relevant notes, `get_topic` to read a topic, and
   `get_notes` to read a known batch. `search_notes` and `get_topic` return
   previews; read what you cite in full with `get_notes`. Build the answer from
   those sources.
2. Set `includeDerived: true` on `search_notes` here, and only here. It adds
   the claims the server distilled from the user's saved sources, which often
   hold the exact answer. Each comes back with `derived: true` and a label at
   the start of its text: nobody has reviewed it, so cite it as "from your saved
   source", check it against that source (`derivedFrom`) before relying on it,
   and never propose an edit against a derived note or treat one as evidence
   the user wrote something down.
3. Answer with citations — reference the notes by title/topic.
4. Offer to file a good answer back as a `summary` proposal so the synthesis
   compounds instead of vanishing into chat. This is the whole point of the
   loop: an answer left in a chat log has to be re-derived next time.

Sorenda has no question box of its own: answering across the notes is your
job, as much as ingesting a source properly and working through what lint
turns up.

### File a backlog

Notes arrive without topics: an import, a scrap typed on a phone, a paste that
never got a title. A note with no topic is on no page, so nothing links to it,
no page lists it, and `ai_lint` cannot see it — it is invisible to every other
operation here.

1. `list_notes` and look for notes with no `title`. Read them in batches with
   `get_notes` rather than one call each.
2. `list_topics` for the pages that exist, and `get_topic` on the near misses.
   Filing something under a near-duplicate of a real page is worse than
   leaving it unfiled: it splits the page in two.
3. One `file` proposal per note, with `evidence` quoting the note itself. If
   nothing existing fits and the note deserves a page of its own, say so and
   propose the new topic name — but prefer an existing page.
4. A note that is better left without a topic (a scrap that only makes sense
   next to another note) can still be reachable: link it from that note with
   `[[n-xxxxxx|label]]`, after `get_note_link_slug`.

The server's own agent proposes this too, but only for a note it happens to
read as it settles; a backlog that predates the agent is yours to work through.

### Lint (health-check)

Run when asked, or offer it after a batch of ingests.

**`ai_lint` does the whole pass in one call.** Do not reconstruct it from
`list_topics` plus a `get_note_links` per topic — that is a round trip per
page, and it stops being practical at exactly the size where linting matters.
It returns eight categories, each capped, with `truncated` set when a category
was cut short. The first six are about the wiki:

- **`orphanTopics`** — written pages nothing links to. Propose a `link` from a
  note that already talks about the page.
- **`unwrittenTopics`** — `[[Links]]` whose target has no notes yet. Gaps worth
  a source; `backlinkCount` says how badly the gap is felt. The server fills one
  only when the user has already saved something to read on it; where they have
  not, the gap is a reading suggestion, not a proposal.
- **`contradictions`** — topics holding claims tagged `ai-contradiction`, with
  the note ids. `get_notes` them and surface the disagreement.
- **`staleClaims`** — a claim whose cited source changed after the claim was
  last revised. Re-read the source (`get_notes` on `sourceId`) and propose a
  `refine` if the claim no longer matches.
- **`missingSummaries`** — a busy topic with no summary. Read its notes and
  propose a `summary`.
- **`staleLinkLabels`** — a `[[n-…|label]]` whose label was written for an
  earlier version of the note it points at and no longer describes it.
  `get_notes` both, and propose a `refine` of the linking note with a label that
  matches what the target says now.

The last two are about tasks, and they are questions for the user, not
proposals — only the user knows whether a task was done, moved or dropped:

- **`overdueTasks`** — outstanding tasks more than a week past their deadline.
- **`staleDoingTasks`** — tasks marked "doing" that nobody has touched in two
  weeks.

List them and ask. Close one the user says is done with `complete_task`
(passing the task's current `data.due` as `occurrenceDue`), and leave any
rescheduling to them.

Two things it deliberately does not do: judge which contradiction is right, and
tell you what a source now says. Both need reading, which is your half.

Report findings as suggestions and, with the user's go-ahead, as proposals.
Never rewrite the knowledge base yourself.

`get_note_links` with `direction: "citations"` is the companion: given a source, it lists the claims
distilled from it. Use it to see what a source has already contributed before
re-ingesting it, and to work through a stale-claim finding from the source side.

`list_ai_proposals` with `includeRuns` says what the server's own agent has already done — including the
passes that read something and proposed nothing. Check it before spending your
own effort on a topic it has just been over.

## Notes

- Works through the plugin's `sorenda` MCP server (`/mcp/v2`, signed in with
  OAuth). Do not ask for edit access: the propose-only rule depends on not
  needing it.
- On the Free plan the connection only reads: `propose_edit` and `save` return
  `subscription_required`. Do not retry: do the reading anyway and give the
  user each change you would have proposed — kind, target, new text, rationale
  and the evidence — so they can apply it themselves.
- Semantic search and translation are subscription-gated; fall back to plain
  search when they are unavailable rather than failing the task.
