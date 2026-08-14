# Session agents

Puts **this** Pi session into a named agent. The markdown body is appended to the system prompt on every turn, so compaction and resume cannot drop the hat.

It does **not** spawn a subprocess. The main session *is* the agent.

## Install

From the monorepo root (recommended; one git clone is one Pi package):

```bash
pi install /absolute/path/to/pi-plugins
# later:
pi install git:github.com/<you>/pi-plugins
```

This package alone, while hacking on it:

```bash
pi install /absolute/path/to/pi-plugins/packages/agents
```

Try once without writing settings:

```bash
pi -e /absolute/path/to/pi-plugins/packages/agents/extensions/index.ts
```

## Use

| | |
| --- | --- |
| `/agent` | Picker |
| `/agent test-engineer` | Switch now |
| `/agent none` | Drop the hat (`off` and `clear` work too) |
| `Ctrl+Shift+A` | Cycle none → each agent → none |
| `pi --agent test-engineer` | Start already in character |

The footer shows `agent:test-engineer` while one is active.

`--agent` wins over whatever the session last saved. Resume without the flag restores the saved agent.

## What changes

- **System prompt** — agent body appended every turn (compaction-proof)
- **Session file** — last chosen name stored as a custom entry
- **Footer** — `agent:<name>`

What does **not** change in v1: tools, model, thinking level, earlier turns. Old implementer chatter stays in the transcript; the *next* call is the test engineer looking at it.

## Files

Shipped example: [`agents/test-engineer.md`](agents/test-engineer.md).

Add your own in any discovery path (see [agent format](../../docs/agent-format.md)). Highest layer for a given `name` wins. Unknown frontmatter is ignored so Claude / OpenCode / Copilot files load as-is.

## Not this package

- Subagents / isolated child `pi` processes
- Skills (`.agents/skills/` is a different standard)
- Replacing Pi's default system prompt
- Writing the persona into `AGENTS.md`
