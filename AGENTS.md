# AGENTS.md

Orientation for agents working in this repo.

## What this is

A monorepo of **Pi packages**. Git install loads the **repo root** (`package.json` → `pi`). Subfolders are organization, not install units.

## Where to look

- How to install / what is in the tree → [`README.md`](README.md)
- Session agent plugin → [`packages/agents/README.md`](packages/agents/README.md)
- Session loop plugin → [`packages/loop/README.md`](packages/loop/README.md)
- Portable agent markdown (intersection with Claude / OpenCode / Copilot) → [`docs/agent-format.md`](docs/agent-format.md)

## Working rules

- Session agents are identity (system prompt), not subagents and not skills.
- Ignore harness-specific frontmatter (`tools`, `permission`, `mode`, …). Do not invent a second format.
- Do not put a persona in `AGENTS.md` files of other repos.
- Keep the root `pi` key in sync when you add a package you want `pi install git:…` to load.
