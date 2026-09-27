# Personal Pi customizations

This package collects the user-level Pi resources that were previously kept under `~/.pi/agent`:

- `extensions/draft-stash.ts` adds `/stash`, `/restore`, `/exit`, and prompt stash/restore shortcuts.
- `extensions/minimal-mode.ts` customizes built-in tool rendering.
- `extensions/openai-context-window.ts` adds `/openai-context 272k|1m` and `Shift+Tab` to toggle those limits for OpenAI and OpenAI Codex models with a 272k catalog window.
- `skills/pi-brave/` contains the dedicated Brave/CDP skill and its CLI.
- The root [`keybindings.json`](../../keybindings.json) preserves the personal keybinding map.

The root `package.json` loads the extension wrapper and skill directory when the monorepo package is installed. Pi package manifests do not distribute keybindings, so apply the tracked keybinding file separately by copying or merging it into `~/.pi/agent/keybindings.json`. Pi reads keybindings from the agent directory, and a copied file replaces that map.

`/openai-context` shows the active model's current context size. The command selects 272,000 or 1,050,000 tokens; `Shift+Tab` toggles between the two, using the same session state. The choice is restored on resume and applied to other eligible OpenAI models selected in that session. New sessions default to 272k. The shortcut reports an error without changing state on ineligible models. Keep Pi's thinking-cycle binding on `Ctrl+T` (as in the root `keybindings.json`) to free `Shift+Tab`. These settings only change Pi's context/compaction threshold: the 1m choice works only if the upstream endpoint/account accepts it, and switching down after exceeding 272k may trigger compaction on the next request.

The Brave skill uses `puppeteer-core`, declared as a runtime dependency by the root package. Its browser profile, Brave binary path, and CDP port remain local machine settings in the CLI.

The original user-level extensions and skill are left untouched. Before adding this package to the same global Pi agent configuration, remove those originals and the separate `pi-goal-x` package to avoid loading duplicate commands, tools, or skills.
