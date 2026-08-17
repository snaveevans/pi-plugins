# pi-plugins

Pi packages. One git repo, one `pi install`. Layout is for us; Pi treats the **repo root** as the package.

```bash
pi install /absolute/path/to/pi-plugins
# after this is on GitHub:
pi install git:github.com/snaveevans/pi-plugins
```

Pi clones (or links) the root, then loads whatever the root `package.json` `pi` key lists. There is no `git:…/packages/agents` syntax. To load only one package while developing:

```bash
pi install /absolute/path/to/pi-plugins/packages/agents
```

## Packages

| Package | What it does |
| --- | --- |
| [`packages/agents`](packages/agents/README.md) | `/agent` — this session *is* the named agent. Identity on the system prompt so compaction cannot eat it. Ships a `create-agent` skill so you can ask the model to write one. |
| [`packages/loop`](packages/loop/README.md) | `/loop` — re-run a prompt in this session on an interval. Process must stay open. |
| [`packages/goal`](packages/goal/README.md) | `/goal` — keep working toward a completion condition. Process must stay open. |

Session agent files (markdown + YAML + body) are documented in [`docs/agent-format.md`](docs/agent-format.md).

## Not npm (yet)

No publish step. Git (or a local path) is the install. Root `package.json` has no runtime `dependencies`; Pi supplies the extension APIs.

## Layout

```text
pi-plugins/
  package.json                 ← pi.extensions → packages/*/extensions
  docs/agent-format.md
  packages/
    agents/
      extensions/              ← Pi loads index.ts only
      skills/create-agent/     ← authoring skill
    loop/
      extensions/              ← /loop
    goal/
      extensions/              ← /goal
```
