---
description: Sign in to Sorenda with an emailed code and create an API key
argument-hint: "email [code]"
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

Run exactly one command:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/login.mjs" $ARGUMENTS
```

Show the output verbatim, without changes or a summary. Do not add anything
containing the email or code. In particular, never repeat the emailed code or
construct or print the `srnd_…` key: the script has already saved it to
`~/.sorenda/config.json`, and its output contains only a safe prefix.

If there are no arguments or the first argument is not an email address, explain
that the user must run `/login you@example.com`, wait for the emailed code, then
run `/login you@example.com 123456`.
