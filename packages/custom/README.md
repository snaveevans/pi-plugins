# Personal Pi customizations

This package collects the user-level Pi resources that were previously kept under `~/.pi/agent`:

- `extensions/draft-stash.ts` adds `/stash`, `/restore`, `/exit`, and prompt stash/restore shortcuts.
- `extensions/minimal-mode.ts` customizes built-in tool rendering.
- `skills/pi-brave/` contains the dedicated Brave/CDP skill and its CLI.
- The root [`keybindings.json`](../../keybindings.json) preserves the personal keybinding map.

The root `package.json` loads the extension wrapper and skill directory when the monorepo package is installed. Pi package manifests do not distribute keybindings, so apply the tracked keybinding file separately by copying or merging it into `~/.pi/agent/keybindings.json`. Pi reads keybindings from the agent directory, and a copied file replaces that map.

The Brave skill uses `puppeteer-core`, declared as a runtime dependency by the root package. Its browser profile, Brave binary path, and CDP port remain local machine settings in the CLI.

The original user-level extensions and skill are left untouched. Before adding this package to the same global Pi agent configuration, remove those originals and the separate `pi-goal-x` package to avoid loading duplicate commands, tools, or skills.
