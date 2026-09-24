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

| Package                                        | What it does                                                                                                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/agents`](packages/agents/README.md) | `/agent` — this session _is_ the named agent. Identity on the system prompt so compaction cannot eat it. Ships a `create-agent` skill so you can ask the model to write one. |
| [`packages/loop`](packages/loop/README.md)     | `/loop` — re-run a prompt in this session on an interval. Process must stay open.                                                                                            |
| [`packages/goal`](packages/goal/README.md)     | Customized `pi-goal-x` — conversational and ordered goals, persistent progress, and an independent completion auditor.                                                        |
| [`packages/init`](packages/init/README.md)     | `/init` — create or audit AGENTS.md from grounded repo facts.                                                                                                               |
| [`packages/custom`](packages/custom/README.md) | Personal extensions and the `pi-brave` skill migrated from `~/.pi/agent`.                                                                                                   |

Session agent files (markdown + YAML + body) are documented in [`docs/agent-format.md`](docs/agent-format.md).

## Keybindings

Pi packages do not load keybindings. [`keybindings.json`](keybindings.json) preserves the personal map; copy or merge it into `~/.pi/agent/keybindings.json` to apply it. Pi reads keybindings from the agent directory, and replacing that file replaces the existing map.

## Install and dependencies

No publish step. Git (or a local path) is the install. Pi supplies the extension APIs; the root package declares `puppeteer-core` for the bundled Brave skill.

## Layout

```text
pi-plugins/
  package.json                 ← root package manifest and pi resource paths
  keybindings.json             ← personal keybinding template (apply separately)
  docs/agent-format.md
  packages/
    agents/
      extensions/              ← session agent extension
      skills/create-agent/     ← authoring skill
    loop/
      extensions/              ← /loop
    goal/
      extensions/              ← customized pi-goal-x and its tests
    init/
      extensions/              ← /init
    custom/
      extensions/              ← personal prompt and tool-display extensions
      skills/pi-brave/         ← dedicated Brave/CDP skill and CLI
```
