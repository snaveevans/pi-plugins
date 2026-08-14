# Session goal

Keeps **this Pi session** working toward a completion condition. After each settled turn a small model judges the transcript. Closing the terminal stops fires. `/new` clears the goal. Resume restores an active goal; achieved or cleared goals stay history.

This is a lightweight cousin of [Claude Code `/goal`](https://code.claude.com/docs/en/goal). It is not a Stop hook, not auto-mode, and not `/loop`.

## Install

Same as the rest of this repo:

```bash
pi install /absolute/path/to/pi-plugins
# later:
pi install git:github.com/<you>/pi-plugins
```

This package alone:

```bash
pi install /absolute/path/to/pi-plugins/packages/goal
```

Try once:

```bash
pi -e /absolute/path/to/pi-plugins/packages/goal/extensions/index.ts
```

## Use

| | |
| --- | --- |
| `/goal all tests in test/auth pass` | Set the condition and start a turn |
| `/goal` | Status (active, or last achieved/failed) |
| `/goal clear` | Clear (`stop`, `off`, `reset`, `none`, `cancel` work too) |
| `Ctrl+Alt+G` | Same as `/goal clear` |

One goal per session. Setting a new one replaces the current one.

The footer shows `goal:on` while working, `goal:eval` while the judge is running. A widget above the editor shows the condition and the latest reason.

## Write an effective condition

The evaluator does not run commands or read files. It only sees what this session already put in the transcript. Write a condition the working agent can prove:

- One measurable end state: a test result, a build exit code, an empty queue
- A stated check: `` `npm test` exits 0 ``, `git status` is clean
- Constraints that matter: "no other test file is modified"

Up to 4,000 characters. To bound a run, put the bound in the condition (`or stop after 20 turns`).

## What happens after a turn

When the session settles, the extension asks a small configured model for one of three verdicts:

| Verdict | Next |
| --- | --- |
| **Not yet met** | Injects the reason and starts another turn |
| **Met** | Records an achieved card and stops |
| **Impossible** | Records a failed card and stops |

If the working agent answers without tools for **3** turns in a row, evaluation pauses and control returns to you. The goal stays set. Your next prompt resumes it.

The next turn starts only after the current one has **settled**. Missed evaluations do not pile up.

## Agent tool

The model can call `goal` (`start` / `clear` / `status`) instead of asking you to type `/goal`. Start and clear require a `reason`.

Guidelines baked into the system prompt:

- Start only for substantial work with a verifiable end state.
- Not for chatting, retrying a failed tool, or avoiding a question.
- Clear when you ask, the target is wrong, or irreversible work is about to start.
- One goal. `start` replaces the current one.
- Prefer `/goal` when the next turn should start as soon as this one finishes. Prefer `/loop` when waiting on something outside this process.

## Evaluator

Uses a configured **fast** model when one is available (haiku / flash / mini / nano / lite). Falls back to the cheapest configured model, then the current session model. The judge call is not a user turn and does not use tools.

## Persist / resume

State is a custom session entry. Resume (`pi -c`) restores an **active** goal and resets turn count, timer, and spend. Achieved or cleared goals are not restored as active. A brand-new session does not inherit it.

## Not this package

- Multiple concurrent goals
- Deterministic script checks (Claude Stop hooks)
- Changing permission / auto mode
- Firing after you quit Pi
