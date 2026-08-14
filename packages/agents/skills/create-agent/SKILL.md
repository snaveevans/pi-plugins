---
name: create-agent
description: Create or update Pi session-agent markdown files (named personas appended to the system prompt). Use whenever the user asks to create an agent, write a persona, add a reviewer/implementer/researcher hat, make an /agent file, or put something in agents/. Also use when they want to edit or move an existing session agent. Do not use for skills, subagents, or AGENTS.md project instructions.
---

# Create a session agent

A session agent is a **hat for this Pi session**. The markdown body is appended to the system prompt every turn. Compaction cannot drop it. `/agent <name>` puts the current session into that identity. It does **not** spawn a subprocess.

This is not a skill, not a subagent, and not `AGENTS.md`.

## Workflow

1. Capture the identity (who they are, what they refuse, what they must not invent).
2. Pick a `name`: lowercase letters, numbers, hyphens. Filename stem should match.
3. Pick a discovery path (below). If the user did not say, choose:
   - this repo / this codebase → `.pi/agents/<name>.md`
   - every session / personal → `~/.pi/agent/agents/<name>.md`
4. If a file with that `name` already exists in a discovery path, say so and confirm before overwriting. Same `name` later in load order wins.
5. Write the file. Create the directory if needed.
6. Tell them how to wear it: `/agent <name>`, or `pi --agent <name>` on the next start. New files are picked up without `/reload`.

Do not interview at length. One clarifying question is enough if name or scope is actually missing. Otherwise write the file.

## File format

```markdown
---
name: reviewer
description: Code reviewer. Use when reading a diff or deciding whether a change is ready.
---

You ARE the reviewer for this session.
Do not write product code unless asked.
Do not invent product policy. If the spec is silent, say so.
```

| Piece | Rule |
| --- | --- |
| `name` | Optional. Lowercase letters, numbers, hyphens. If omitted, the filename (minus `.md` or `.agent.md`) is the name. |
| `description` | Optional but recommended. Shown in `/agent` completions. If omitted, the first non-empty body line is used. |
| body | Required. Identity only. Appended every turn, so keep it short. |
| other keys | Do not add `tools`, `permission`, `mode`, `model`, `handoffs`, `mcp-servers`. This plugin ignores them. |

`.md` and `.agent.md` both work. Never write `README.md` into an agents folder (it is skipped).

Write the intersection format other harnesses already agree on. A Claude / OpenCode / Copilot file is valid here as long as the body is the identity.

## Where to write

**Lowest → highest.** Same `name`: later sources win. Inside a source, later paths win. Directories are scanned recursively.

1. Package defaults — only if you are developing this plugin (`packages/agents/agents/`). This plugin ships none; do not put user agents there.
2. User vendor — `~/.agents/agents/`, `~/.copilot/agents/`, `~/.config/opencode/agent/` + `agents/`, `~/.claude/agents/`
3. User Pi — `~/.pi/agent/agents/`
4. Project vendor, git root → cwd (closer wins) — `.agents/agents/`, `.github/agents/`, `.opencode/agent/` + `agents/`, `.claude/agents/`
5. Project Pi — `.pi/agents/` (closest to cwd wins)

Project folders load only when the project is trusted. User folders always load. Not in a git repo: only `cwd` is treated as project.

Prefer Pi paths unless the user asked to share with another harness:

| Intent | Path |
| --- | --- |
| This project, Pi only | `.pi/agents/<name>.md` |
| Every session, Pi only | `~/.pi/agent/agents/<name>.md` |
| Also Claude / VS Code Copilot | `.claude/agents/<name>.md` (project) or `~/.claude/agents/<name>.md` |
| Also GitHub Copilot custom agents | `.github/agents/<name>.md` or `<name>.agent.md` |
| Also OpenCode | `.opencode/agent/<name>.md` (add `mode: primary` in **their** copy if they require it; we ignore `mode`) |
| Vendor-neutral dump (Pi only; others do not scan this) | `.agents/agents/` or `~/.agents/agents/` |

Do not put a persona in `AGENTS.md`. If they ask to, write a session-agent file and say why.

`.agents/skills/` is skills, not session agents. Do not write agents there.

`~/.pi/agent/agents/` is also where Pi's example subagent extension looks. A file here can be a session hat **and** a spawnable child if that extension is installed. Keep spawn-only agents out of this folder.

## Body

Write identity, not a workflow and not project standing orders.

- Open with who they are (`You ARE the … for this session.`).
- State what they will not do and what they must not invent.
- Point at `AGENTS.md` / the repo for product facts; do not duplicate them.
- Keep it tight. This text is on every model call while the hat is on.

## After writing

Say the path, the `name`, and the activate command. Example:

> Wrote `.pi/agents/reviewer.md`. Switch with `/agent reviewer`.
