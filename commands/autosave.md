---
description: Turn Sorenda session autosave on or off, or check its status
argument-hint: "on | off | status [--global]"
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

Run exactly one command:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/autosave.mjs" $ARGUMENTS
```

Without arguments, the script shows the current status. Show its output to the
user verbatim and add nothing else.

Without `--global`, the setting applies only to the current session. With
`--global`, it changes the default for all new sessions. When autosave is on,
the Sorenda note is updated after every response.
