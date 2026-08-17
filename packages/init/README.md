# Session init

Creates or audits **AGENTS.md** for the current repo. `/init` gathers grounded facts about the repo (package manager, scripts, test/lint config, CI, structure, existing agent files) and hands off to the session model with a best-practices-grounded prompt. The model writes or fixes the file using its normal file tools.

This is a one-shot command — no tool, no hotkey, no persisted state.

## Why not a template

Research ([Evaluating AGENTS.md, ETH Zurich 2025](https://arxiv.org/abs/2602.11988); [HumanLayer](https://www.humanlayer.dev/blog/writing-a-good-claude-md); [philschmid](https://www.philschmid.de/writing-good-agents); the Linux-Foundation-stewarded spec) is consistent: **auto-generated AGENTS.md files reduce task success and raise cost**, because they duplicate what agents can already infer and add low-signal lines that load on every turn. So `/init` does not stamp out a finished file. It gives the session model the *real* facts and the *current* best-practice checklist, and lets it author something sparse and grounded.

## Install

Same as the rest of this repo:

```bash
pi install /absolute/path/to/pi-plugins
# later:
pi install git:github.com/<you>/pi-plugins
```

This package alone:

```bash
pi install /absolute/path/to/pi-plugins/packages/init
```

Try once:

```bash
pi -e /absolute/path/to/pi-plugins/packages/init/extensions/index.ts
```

## Use

| | |
| --- | --- |
| `/init` | Create AGENTS.md if missing, otherwise audit and fix it |
| `/init create` | Force create (refuses if one already exists) |
| `/init audit` | Force audit (`review`, `check`, `lint`, `fix` work too) |

The command inspects the git root (or cwd if not in a repo), so AGENTS.md lands at the canonical location.

## What it gathers

`/init` reads the repo deterministically so the model starts from facts, not guesses:

- Git root, working dir, `.gitignore`, README presence
- Existing AGENTS.md (content, for audit) and other agent files (`CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md`)
- `package.json` — name/version/description, scripts (with exact commands), `packageManager`, `engines`, workspaces, dependencies
- Package manager — from `packageManager` field or lockfile (`pnpm`/`bun`/`yarn`/`npm`/`deno`)
- Ecosystem — node/deno/python/rust/go/ruby/jvm/php/swift/dotnet
- Test frameworks — jest/vitest/pytest/playwright/cypress/cargo-test/go-test
- Lint/format — eslint/biome/prettier/ruff/flake8/golangci-lint/rubocop/clippy/deno-lint
- CI — GitHub Actions/GitLab/CircleCI/Azure Pipelines/Jenkins/Buildkite
- Monorepo flag (workspaces, `pnpm-workspace.yaml`, `lerna`/`nx`/`turbo`)
- Top-level directories

## What the prompt asks for

The hand-off prompt encodes the best-practice checklist: plain Markdown, no schema, ~60–200 lines, exact copy-pasteable commands with pinned versions, directories mapped to responsibilities (not exhaustive trees), conventions that differ from defaults, a three-tier **Always / Ask first / Never** boundaries section, a testing section, a Definition-of-Done verification checklist, and security rules. It tells the model to avoid secrets, README duplication, vague personas, prose-only rules, and stale paths — and to verify commands against the gathered facts before listing them.

## Not this package

- Generating the file from a rigid template (the research says don't)
- Migrating/symlinking `CLAUDE.md` ↔ `AGENTS.md` (it only flags duplication)
- CI linting of AGENTS.md
