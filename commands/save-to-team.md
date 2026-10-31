---
description: Propose what this session decided to a Sorenda team workspace
argument-hint: "workspace [topic]"
---

Save what this session found or decided to the Sorenda team workspace named in
"$ARGUMENTS" (its first word or quoted name; the rest, if any, is the page to
file it under).

Use the `sorenda` MCP server's `save` tool with `workspace` set to that name.
Write `text` as a complete, standalone statement a teammate who never saw this
session understands: what was decided, why, and anything they must know to act
on it. Set `topic` to an existing page in that workspace where one fits
(`list_topics` with the same `workspace`), and `quote` to the user's own words
from this session that the decision rests on.

The workspace changes only when a member accepts the proposal. Tell the user it
is waiting in that workspace's AI inbox, in one line. If `save` says the
workspace is not open to this connection, tell them to tick it in Sorenda under
Profile → Agents → Connected apps.
