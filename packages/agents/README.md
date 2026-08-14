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
| `/agent reviewer` | Switch now (name of a file you added) |
| `/agent none` | Drop the hat (`off` and `clear` work too) |
| `Ctrl+Shift+A` | Cycle none → each agent → none |
| `pi --agent reviewer` | Start already in character |

The footer shows `agent:<name>` while one is active.

`--agent` wins over whatever the session last saved. Resume without the flag restores the saved agent.

## What changes

- **System prompt** — agent body appended every turn (compaction-proof)
- **Session file** — last chosen name stored as a custom entry
- **Footer** — `agent:<name>`

What does **not** change in v1: tools, model, thinking level, earlier turns. Old implementer chatter stays in the transcript; the *next* call wears the new hat.

## Files

This package ships no agents. Add your own in any discovery path (see [agent format](../../docs/agent-format.md)). Unknown frontmatter is ignored so Claude / OpenCode / Copilot files load as-is.

## Skill

Install also loads [`create-agent`](skills/create-agent/SKILL.md). Ask the model to create a reviewer / implementer / researcher (or run `/skill:create-agent`) and it writes the markdown in the right folder. That is how users get agents without reading this file.

## Load order

Same `name`: later sources win. Inside a source, later paths in the lists below win. Directories are scanned recursively (`README.md` is skipped).

**Lowest → highest**

1. Package defaults — `packages/agents/agents/*.md` if you add any (this plugin ships none)
2. User vendor
   - `~/.agents/agents/`
   - `~/.copilot/agents/`
   - `~/.config/opencode/agent/` and `~/.config/opencode/agents/`
   - `~/.claude/agents/`
3. User Pi — `~/.pi/agent/agents/`
4. Project vendor, git root → cwd (closer wins)
   - `.agents/agents/`
   - `.github/agents/`
   - `.opencode/agent/` and `.opencode/agents/`
   - `.claude/agents/`
5. Project Pi — `.pi/agents/` (closest to cwd wins)

Project folders load only when the project is trusted. User folders and package defaults always load. Not in a git repo: only `cwd` is treated as project.

## Not this package

- Subagents / isolated child `pi` processes
- Skills (`.agents/skills/` is a different standard)
- Replacing Pi's default system prompt
- Writing the persona into `AGENTS.md`
