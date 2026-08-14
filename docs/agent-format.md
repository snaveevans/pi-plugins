# Session agent format

Session agents are Markdown files with optional YAML frontmatter. The body is the identity: who this session is.

This is the intersection that OpenCode, Claude Code, and GitHub Copilot already agree on. Extra frontmatter those tools use (`tools`, `permission`, `mode`, `model`, `handoffs`, `mcp-servers`, …) is **ignored** here. We do not lock tools or spawn a subprocess.

## File

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
| body | Required. Appended to Pi's system prompt on every turn while the agent is active. Compaction does not touch it. |
| other keys | Ignored. A Claude or OpenCode file is still a valid session agent. |

`.agent.md` (Copilot / VS Code) and `.md` are both accepted. `README.md` is skipped.

## Discovery and precedence

Same `name`: the highest layer wins. Inside a layer, later paths in the lists below win.

**Lowest → highest**

1. Package defaults — `packages/agents/agents/*.md` if you add any (this plugin ships none)
2. User vendor
   - `~/.agents/agents/` (this plugin's vendor-neutral dump; not an industry default)
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

Project folders load only when the project is trusted. User folders and package defaults always load.

Directories are scanned recursively. Not in a git repo: only `cwd` is treated as project.

## What this is not

| Path | What lives there |
| --- | --- |
| `.agents/skills/` | Skills (shared). Not session agents. |
| `AGENTS.md` | Project instructions for every session. Do not put a persona here. |
| Industry `agents/` folders | Often mean a **subagent** (new process). We only read the markdown. |

`.agents/agents/` is **ours**. OpenCode, Claude, and Copilot do not scan it. If you want those tools to see the same file, put it in their folder (or symlink). Claude + VS Code/Copilot already share `.claude/agents/`.

## Sharing a file with another harness

Write the intersection format. Copy or symlink into the other tool's directory if you want it to load natively.

- OpenCode primary (Tab-switch this session): add `mode: primary` in **their** copy if they require it. We ignore `mode`.
- Claude main session: `claude --agent reviewer`. We do not spawn Claude.
- Copilot: `.github/agents/reviewer.md` or `reviewer.agent.md`.

Do not add `tools` / `permission` for our sake. We will not enforce them.

## Pi official subagent example

Pi's example extension also reads `~/.pi/agent/agents/*.md` as **spawnable** subagents. If that extension and this package are both installed, the same file can be a session hat here and a child process there. That is intentional overlap. Keep spawn-only agents out of that folder, or do not install both.
