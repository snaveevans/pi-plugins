# Session loop

Re-runs a prompt **in this Pi session** on an interval. The process must stay open. Closing the terminal stops fires. `/new` clears the loop. Resume restores it if it is less than 7 days old.

This is a lightweight cousin of [Claude Code `/loop`](https://code.claude.com/docs/en/scheduled-tasks). It is not cloud cron, not a desktop daemon, and not a multi-task scheduler.

## Install

Same as the rest of this repo:

```bash
pi install /absolute/path/to/pi-plugins
# later:
pi install git:github.com/<you>/pi-plugins
```

This package alone:

```bash
pi install /absolute/path/to/pi-plugins/packages/loop
```

Try once:

```bash
pi -e /absolute/path/to/pi-plugins/packages/loop/extensions/index.ts
```

## Use

| | |
| --- | --- |
| `/loop 5m check the deploy` | Fixed interval + prompt |
| `/loop check the deploy every 5m` | Same, interval at the end |
| `/loop 15m` | Interval, prompt from `loop.md` or the built-in |
| `/loop check the deploy` | Prompt, default interval **5m** |
| `/loop` | Built-in maintenance prompt every 5m |
| `/loop now` | Fire as soon as the current tick (if any) has settled |
| `/loop status` | Cadence, next fire, last tick |
| `/loop stop` | Stop (`off`, `clear`, `cancel` work too) |
| `Ctrl+Shift+L` | Same as `/loop stop` |

Units: `s` `m` `h` `d` (also `30 seconds`, `2 hours`). Floor **10s**, ceiling **7d**.

The footer shows `loop:5m` while waiting, `loop:#N` while a tick is running, `loop:wait` if a tick is due but the agent is still on something else. A widget above the editor shows the next fire time. `/loop stop` or `Ctrl+Shift+L` clears it immediately — the pending timer is dropped even if a tick is mid-turn (that turn finishes; nothing reschedules).

## What happens on a tick

When the session is idle, the extension injects a custom message (compact card in the TUI; full prompt still goes to the model) and starts a turn. The next interval starts only after that turn has **settled**. A 20s loop whose tick takes 45s waits another 20s *after* those 45s, not 20s from send. If you are mid-response when a wait expires, the tick holds until idle. Missed intervals do not pile up.

The loop does not spawn a subprocess. It does not lock tools. It does not expand `/skill` names — the prompt is plain text.

## Agent tool

The model can call `loop` (`start` / `stop` / `status` / `now`) instead of asking you to type `/loop`. Start and stop require a `reason`.

Guidelines baked into the system prompt:

- Start only when waiting on something outside this turn (deploy, CI, long build, PR).
- Not for chatting, retrying a failed tool, or avoiding a question.
- Stop when the condition is met, you ask, the loop is burning turns, or irreversible work is about to start.
- One loop. `start` replaces the current one.
- Prefer `2m` or slower unless you asked for faster.

## Default prompt

If you omit the prompt, first existing file wins:

1. `.pi/loop.md` (project, trusted only)
2. `.claude/loop.md` (project, trusted only)
3. `~/.pi/agent/loop.md`
4. `~/.claude/loop.md`

Otherwise the built-in: continue unfinished work, tend the current PR, small cleanup, no new initiatives, no irreversible action unless the transcript already authorized it.

Edits to `loop.md` apply the next time you start `/loop`, not mid-loop. Pass a prompt on the command to ignore the file.

## Persist / resume

State is a custom session entry. Resume (`pi -c`) restores an unexpired loop and arms the next fire. A loop older than 7 days is dropped. A brand-new session does not inherit it.

## Not this package

- Multiple concurrent jobs / cron expressions / one-shot wall-clock reminders
- Claude dynamic interval ("you pick the wait") or Monitor
- Condition-driven continuation — that is [`/goal`](../goal/README.md)
- Firing after you quit Pi
- Catch-up for every missed beat
