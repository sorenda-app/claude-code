---
description: Save the current session to Sorenda as an aichat note
argument-hint: "[topic] [#tag #tag]"
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

Run exactly one command:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/save.mjs" --command --args "$ARGUMENTS"
```

Then show the output verbatim as one short line with the link. Do not analyze or
summarize the conversation, and do not run anything else. If the command fails,
show its error and, if it concerns the API key, mention `SORENDA_API_KEY` or
`~/.sorenda/config.json`.
