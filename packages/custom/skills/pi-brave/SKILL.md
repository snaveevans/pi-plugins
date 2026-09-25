---
name: pi-brave
description: Drive a dedicated Brave window (not the user's daily browser) over the Chrome DevTools Protocol. Use when a Pi session needs to open a page, see the rendered UI, read the DOM, console, or network, or click and type in a logged-in QA app without asking for passwords.
---

# Pi Brave

Pi has no built-in browser. This skill is the browser. It drives a second Brave, with its own profile, over `127.0.0.1:9222`. The user's daily Brave stays open and is not attached.

This skill is bundled with `pi-plugins` and loaded when the root package is installed. Resolve its directory from the skill path Pi provides. Run the CLI from that directory so its `puppeteer-core` dependency resolves through the package's `node_modules`:

```bash
node scripts/pi-brave.mjs status
```

If running the skill outside the installed root package, install its dependency in the skill directory with `npm install`.

## Hard rules

- Never launch or attach to daily Brave. Its profile is `~/Library/Application Support/BraveSoftware/Brave-Browser`. Do not pass that as `--user-data-dir`. Do not `killall "Brave Browser"`. Do not `open -a "Brave Browser"`.
- Never ask the user to paste a password, code, or session token into chat. They sign in inside the Pi Brave window.
- Never print cookies, `Authorization`, `Set-Cookie`, `localStorage`, `sessionStorage`, or password-field values. The CLI refuses eval and typing that would do this. Do not bypass it.
- Do not click Recognize, Boost, Like, Comment, Share, Follow, or submit a form unless the user asked for that action. Those mutate the QA app. A view-tab click used only as a test must be clicked back.
- The debug port is unauthenticated. It is bound to `127.0.0.1`, but any local process can drive this browser and read the session. Quit Pi's Brave when the debugging session is over. Quitting does not delete the login.

## Layout

| What | Where |
|---|---|
| CLI | `scripts/pi-brave.mjs` |
| Pi profile (keep) | `~/.cache/pi-browser` |
| Brave binary | `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser` |
| CDP | `http://127.0.0.1:9222` |
| Launch log | `~/.cache/pi-browser/brave.log` |
| Console/network log | `~/.cache/pi-browser/debug-log.jsonl` |

The profile path is the login. A different `--user-data-dir` is a new empty session. Do not delete `~/.cache/pi-browser` to "fix" a problem.

## Commands

Run `status` before every other command.

```bash
node scripts/pi-brave.mjs status
node scripts/pi-brave.mjs start
node scripts/pi-brave.mjs open https://example.com
node scripts/pi-brave.mjs snapshot
node scripts/pi-brave.mjs click --text "Overview" --role tab
node scripts/pi-brave.mjs click --selector "button#nextButton"
node scripts/pi-brave.mjs type --selector "#username" --text "value"
node scripts/pi-brave.mjs eval 'document.title'
node scripts/pi-brave.mjs log start
node scripts/pi-brave.mjs log show --lines 40
node scripts/pi-brave.mjs log stop
```

`open` and `snapshot` print JSON. `shot` is an absolute PNG path. `events` are console messages, page errors, failed requests, and xhr/fetch responses captured during that command. `tabs` includes `aria-selected`.

To see the page, wait until the command exits, then `read` the `shot` path. Do not read it in parallel with the command. That race returns a missing file or the previous image.

`click` and `type` use Puppeteer's real mouse, not `element.click()`. `click` exits 3 when the text or selector matches more than one element. Pass `--role` or a tighter selector. `--url-includes` picks the tab when more than one is open.

## Workflow

1. `status`.
2. If `debugPortOwnedByPiBrave` is false and `portOwnedBySomethingElse` is true, stop. Something else owns 9222. Do not connect.
3. If Pi's Brave is not running, `start`. If status says it is running without the debug port, `start --restart`. That signal only goes to the process whose command line contains `--user-data-dir=$HOME/.cache/pi-browser`.
4. `open` the URL, or `snapshot` if the user is already on the page.
5. `read` the screenshot. Use the JSON text, controls, and tabs for anything the image does not make obvious.
6. Interact with `click` / `type`. Prefer a role plus visible text over a pixel coordinate.
7. For a bug the user will reproduce, `log start` first, let them do it, then `log show`. Listeners do not see events from before they attached.

Login: `open` the app, tell the user which window title to use, and wait. After they say they are in, `snapshot`. Do not relaunch. Relaunching the same profile while it is already debugging is unnecessary; relaunching it without the port makes it undebuggable until `start --restart`.

## Pitfalls that already happened

1. **`open -a "Brave Browser"` attaches to daily Brave and drops the debug flags.** Launch the binary. The CLI does this. Daily Brave was already running the first time this worked; a separate `--user-data-dir` is what made the second instance.

2. **One process per profile, and the port is fixed at launch.** A second start against `~/.cache/pi-browser` focuses the existing process and ignores `--remote-debugging-port`. Check the command line, not just that Brave is open. `status` does this. `start --restart` is the recovery. Never kill a Brave process whose command line lacks the Pi profile path.

3. **Port 9222 can belong to another tool.** `status` exits 2 when CDP is up but the listener is not Pi's profile. Do not drive that browser.

4. **The first screenshot was a blank gray page.** `domcontentloaded` had fired, but `innerText` was still empty and the viewport had not painted. Waiting for body text, then 400ms, then shooting fixed it. `fullPage` also happened to catch the page once, but the wait was the real fix. The CLI waits. If `painted` is false, wait and `snapshot` again. Do not debug a blank image as if it were the app.

5. **Screenshots are device pixels, not CSS pixels.** `defaultViewport: null` is required so the shot matches the window the user sees. Setting a viewport makes those diverge. The first window was 1200×1366 and the PNG was about 2400×2458. The CLI resizes to 1280×900 at (80, 60) before shooting. Do not click by scaling coordinates from the image viewer. The viewer scales the PNG again. Use text or a selector.

6. **The window could not be focused with AppleScript.** `osascript` System Events failed with "osascript is not allowed assistive access." `Browser.setWindowBounds` plus `bringToFront` places and raises the window, but it can still be behind another app. Tell the user the page title.

7. **Console and network have no history.** CDP does not replay events from before the listener existed. A script that connects after the click misses the errors. `open`, `snapshot`, and `click` attach, act, then return `events`. For a user reproduction, `log start` before they start. `log show` reads `~/.cache/pi-browser/debug-log.jsonl`.

8. **`net::ERR_BLOCKED_BY_CLIENT` can be Brave Shields, not the app.** Record the failed URL from `events` or the log before calling it an application bug. Do not turn Shields off unless the user wants that for the test.

9. **Some console warnings are truncated.** Treat links to documentation as pointers. If the real text is required, reproduce with `log start` already running and inspect the page error, the failed request, and the response status. Do not paste a response body into chat unless the user asked, and redact tokens if you do.

10. **Duplicate labels.** A page may have multiple controls with the same label. A text click should fail closed and list the matches. Add `--role` or a tighter selector. Do not click the first match.

11. **A DOM `.click()` is not the same as a user click.** It can miss hover, focus, and some handlers. The CLI uses a real click. Use it. After a proof click, restore the previous view so the user is not left on a different page.

12. **Judge login by the final URL.** A QA app may redirect to an identity provider when logged out. Check the final URL and title rather than assuming the URL passed to `open` is the result.

13. **Do not use `badlogic/pi-skills` `browser-tools` unchanged.** It hardcodes Google Chrome and `~/Library/Application Support/Google/Chrome`. Its `--profile` copies the user's real profile, including cookies. This skill exists so that does not happen.

14. **Singleton locks.** If start fails because the profile is locked, the CLI removes `SingletonLock`, `SingletonSocket`, and `SingletonCookie` only under `~/.cache/pi-browser`, and only when that profile's process is not running. Never delete those files from the daily profile.

15. **Reading the PNG too early.** The command that writes the screenshot and a parallel `read` of that path lost the race. Wait for the JSON, then read `shot`.

## What the CLI will not do

- It will not copy or read the daily profile.
- It will not type into `input[type=password]` or a selector matching `/pass/i`.
- It will not eval code matching cookie, storage, password, authorization, or credential.
- It will not log request headers or response bodies. Query params named `token`, `code`, `password`, `secret`, `session`, `auth`, `key`, or `jwt` are redacted, as is any query value longer than 40 characters.
- It will not click when the locator matches zero or many elements.

## Logged-in QA workflow

Run `open <QA URL>`. If it redirects to login, tell the user which window to use and wait for them to sign in there. Do not ask them to share credentials. After sign-in, run `snapshot` and verify the final URL, title, and rendered page before interacting.
