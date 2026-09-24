#!/usr/bin/env node
/**
 * Drive Pi's dedicated Brave profile. Never the user's daily Brave.
 *
 * Profile: ~/.cache/pi-browser
 * Port:    127.0.0.1:9222
 */
import { spawn, execFileSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const HOME = homedir();
const PORT = 9222;
const HOST = "127.0.0.1";
const BROWSER_URL = `http://${HOST}:${PORT}`;
const PROFILE = join(HOME, ".cache", "pi-browser");
const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const PROFILE_FLAG = `--user-data-dir=${PROFILE}`;
const DAILY_PROFILE = join(HOME, "Library/Application Support/BraveSoftware/Brave-Browser");
const LOG_FILE = join(PROFILE, "debug-log.jsonl");
const LOG_PID = join(PROFILE, "debug-log.pid");
const SCRIPT = fileURLToPath(import.meta.url);
const SECRET_RE = /cookie|localStorage|sessionStorage|indexedDB|password|authorization|credential|set-cookie/i;
const SENSITIVE_QUERY = /token|code|password|secret|session|auth|key|jwt/i;

function die(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redact(text) {
  return String(text ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/([?&](?:token|code|password|secret|session|auth|key|jwt)=)[^&\s]+/gi, "$1[redacted]");
}

function safeUrl(raw) {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      const value = url.searchParams.get(key) || "";
      if (SENSITIVE_QUERY.test(key) || value.length > 40) url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return redact(String(raw).split("#")[0]).slice(0, 300);
  }
}

function unlisten(emitter, event, handler) {
  if (typeof emitter.off === "function") emitter.off(event, handler);
  else if (typeof emitter.removeListener === "function") emitter.removeListener(event, handler);
}

function emit(value) {
  console.log(JSON.stringify(value, null, 2));
}

function processes() {
  let out = "";
  try {
    out = execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" });
  } catch {
    return [];
  }
  return out
    .split("\n")
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(.*)$/);
      if (!match) return null;
      return { pid: Number(match[1]), command: match[2] };
    })
    .filter(Boolean);
}

function ourProcesses() {
  return processes().filter(
    (proc) => proc.command.includes("Brave Browser") && proc.command.includes(PROFILE_FLAG),
  );
}

function mainProcess() {
  return ourProcesses().find((proc) => proc.command.includes(`${BRAVE} `) || proc.command.startsWith(BRAVE));
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function cdpVersion() {
  try {
    const response = await fetch(BROWSER_URL + "/json/version", { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function connect() {
  return puppeteer.connect({ browserURL: BROWSER_URL, defaultViewport: null });
}

function pageIdentity(url) {
  return !url.startsWith("about:") && !url.startsWith("chrome") && !url.startsWith("brave:") && !url.startsWith("devtools:");
}

async function pickPage(browser, urlIncludes) {
  const pages = await browser.pages();
  if (urlIncludes) {
    const match = pages.find((page) => page.url().includes(urlIncludes));
    if (!match) die(`No tab URL contains ${urlIncludes}`);
    return match;
  }
  return pages.filter((page) => pageIdentity(page.url())).at(-1) || pages.at(-1);
}

async function fit(page) {
  const session = await page.createCDPSession();
  const { windowId } = await session.send("Browser.getWindowForTarget");
  await session.send("Browser.setWindowBounds", {
    windowId,
    bounds: { left: 80, top: 60, width: 1280, height: 900, windowState: "normal" },
  });
  await page.bringToFront();
  await sleep(250);
}

async function waitForPaint(page) {
  try {
    await page.waitForFunction(() => (document.body?.innerText || "").trim().length > 20, { timeout: 15000 });
  } catch {
    // Caller reports painted:false. A blank shot here means the page had not painted yet.
  }
  await sleep(400);
}

function shotPath() {
  mkdirSync(join(PROFILE, "shots"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(PROFILE, "shots", `${stamp}.png`);
}

async function shoot(page) {
  const path = shotPath();
  await page.screenshot({ path });
  return path;
}

async function describe(page) {
  return page.evaluate(() => {
    const label = (el) =>
      (el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
    const visible = (el) => {
      const style = getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none" && el.getClientRects().length > 0;
    };
    const controls = [...document.querySelectorAll("a, button, input, [role='button'], [role='tab']")]
      .filter(visible)
      .map((el) => ({
        tag: el.tagName,
        role: el.getAttribute("role"),
        type: el.getAttribute("type"),
        text: label(el),
      }))
      .filter((el) => el.text)
      .slice(0, 30);
    const tabs = [...document.querySelectorAll("[role='tab']")].filter(visible).map((el) => ({
      text: label(el),
      selected: el.getAttribute("aria-selected"),
    }));
    return {
      href: location.href,
      title: document.title,
      ready: document.readyState,
      text: (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 1600),
      controls,
      tabs,
    };
  });
}

function watch(page) {
  const events = [];
  const push = (event) => {
    if (events.length < 40) events.push(event);
  };
  const onConsole = (msg) => {
    push({ kind: "console", type: msg.type(), text: redact(msg.text()).slice(0, 500), url: safeUrl(page.url()) });
  };
  const onPageError = (err) => push({ kind: "pageerror", text: redact(String(err)).slice(0, 500) });
  const onFailed = (req) => {
    push({
      kind: "failed",
      type: req.resourceType(),
      method: req.method(),
      url: safeUrl(req.url()),
      error: req.failure()?.errorText || "",
    });
  };
  const onResponse = (res) => {
    const req = res.request();
    if (req.resourceType() !== "xhr" && req.resourceType() !== "fetch") return;
    push({ kind: "response", status: res.status(), method: req.method(), url: safeUrl(res.url()) });
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onFailed);
  page.on("response", onResponse);
  return {
    events,
    stop() {
      unlisten(page, "console", onConsole);
      unlisten(page, "pageerror", onPageError);
      unlisten(page, "requestfailed", onFailed);
      unlisten(page, "response", onResponse);
    },
  };
}

function clearStaleLocks() {
  if (ourProcesses().length) return;
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    rmSync(join(PROFILE, name), { force: true });
  }
}

async function status() {
  const version = await cdpVersion();
  const ours = ourProcesses();
  const main = mainProcess();
  const listeningIsOurs = Boolean(version && main?.command.includes("--remote-debugging-port=9222"));
  let pages = [];
  if (version && listeningIsOurs) {
    const browser = await connect();
    pages = await Promise.all(
      (await browser.pages()).map(async (page) => ({ url: page.url(), title: await page.title().catch(() => "") })),
    );
    await browser.disconnect();
  }
  let logPid = null;
  if (existsSync(LOG_PID)) logPid = Number(readFileSync(LOG_PID, "utf8").trim());
  emit({
    braveBinary: existsSync(BRAVE),
    profile: PROFILE,
    dailyProfileUntouched: DAILY_PROFILE,
    cdp: version ? { browser: version.Browser, protocol: version["Protocol-Version"] } : null,
    piBraveRunning: Boolean(main),
    piBravePid: main?.pid || null,
    debugPortOwnedByPiBrave: listeningIsOurs,
    portOwnedBySomethingElse: Boolean(version) && !listeningIsOurs,
    pages,
    log: { pid: logPid, alive: pidAlive(logPid), file: LOG_FILE },
    otherPiBraveProcesses: ours.map((proc) => proc.pid),
  });
  if (version && !listeningIsOurs) process.exitCode = 2;
}

async function start(restart) {
  if (!existsSync(BRAVE)) die(`Brave not found at ${BRAVE}`);
  const version = await cdpVersion();
  const main = mainProcess();
  if (version && main?.command.includes("--remote-debugging-port=9222") && !restart) {
    emit({ started: false, alreadyRunning: true, pid: main.pid, profile: PROFILE });
    return;
  }
  if (version && !main?.command.includes("--remote-debugging-port=9222")) {
    die(
      "Port 9222 is open, but it is not Pi's Brave profile. Do not connect and do not kill daily Brave. Free 9222 or stop the other debug browser first.",
      2,
    );
  }
  if (main && !main.command.includes("--remote-debugging-port=9222") && !restart) {
    die(
      `Pi's Brave (pid ${main.pid}) is running without remote debugging. Do not killall Brave. Re-run with: start --restart`,
      3,
    );
  }
  if (restart && main) {
    process.kill(main.pid, "SIGTERM");
    for (let i = 0; i < 20; i++) {
      if (!pidAlive(main.pid)) break;
      await sleep(200);
    }
    if (pidAlive(main.pid)) process.kill(main.pid, "SIGKILL");
    await sleep(400);
  }
  mkdirSync(PROFILE, { recursive: true });
  clearStaleLocks();
  const logFd = openSync(join(PROFILE, "brave.log"), "a");
  const child = spawn(
    BRAVE,
    [
      `--remote-debugging-port=${PORT}`,
      `--remote-debugging-address=${HOST}`,
      PROFILE_FLAG,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "about:blank",
    ],
    { detached: true, stdio: ["ignore", logFd, logFd] },
  );
  child.unref();
  for (let i = 0; i < 40; i++) {
    const ready = await cdpVersion();
    if (ready && mainProcess()?.command.includes("--remote-debugging-port=9222")) {
      emit({ started: true, pid: mainProcess().pid, profile: PROFILE, browser: ready.Browser });
      return;
    }
    await sleep(250);
  }
  die(`Brave launched but CDP did not come up. See ${join(PROFILE, "brave.log")}`);
}

async function open(url, urlIncludes) {
  if (!/^https?:\/\//i.test(url)) die("open requires an http(s) URL");
  const browser = await connect();
  const page = await pickPage(browser, urlIncludes);
  const watcher = watch(page);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await waitForPaint(page);
    await fit(page);
    const info = await describe(page);
    const shot = await shoot(page);
    await sleep(800);
    emit({ ...info, shot, events: watcher.events, painted: (info.text || "").trim().length > 20 });
  } finally {
    watcher.stop();
    await browser.disconnect();
  }
}

async function snapshot(urlIncludes) {
  const browser = await connect();
  const page = await pickPage(browser, urlIncludes);
  const watcher = watch(page);
  try {
    await page.bringToFront();
    await fit(page);
    const info = await describe(page);
    const shot = await shoot(page);
    await sleep(600);
    emit({ ...info, shot, events: watcher.events, painted: (info.text || "").trim().length > 20 });
  } finally {
    watcher.stop();
    await browser.disconnect();
  }
}

async function click(args) {
  const browser = await connect();
  const page = await pickPage(browser, args.urlIncludes);
  const watcher = watch(page);
  try {
    await page.bringToFront();
    let handle;
    if (args.selector) {
      const count = await page.$$eval(args.selector, (els) => els.length);
      if (count !== 1) die(`Selector matched ${count} elements; refuse to guess: ${args.selector}`, 3);
      handle = await page.$(args.selector);
    } else {
      handle = await page.evaluateHandle((text, role) => {
        const label = (el) =>
          (el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "")
            .replace(/\s+/g, " ")
            .trim();
        const visible = [...document.querySelectorAll("a, button, input, [role='button'], [role='tab']")].filter((el) => {
          const style = getComputedStyle(el);
          return style.visibility !== "hidden" && style.display !== "none" && el.getClientRects().length > 0;
        });
        const matches = visible.filter((el) => {
          if (role && el.getAttribute("role") !== role) return false;
          return label(el) === text;
        });
        if (matches.length !== 1) {
          return { error: matches.length, sample: matches.slice(0, 8).map((el) => ({ tag: el.tagName, role: el.getAttribute("role"), text: label(el) })) };
        }
        matches[0].scrollIntoView({ block: "center", inline: "center" });
        return matches[0];
      }, args.text, args.role || null);
      const preview = await handle.evaluate((node) => {
        if (node && node.error !== undefined) return node;
        return null;
      }).catch(() => null);
      if (preview?.error !== undefined) {
        die(`Text ${JSON.stringify(args.text)} matched ${preview.error} elements. Pass --role or --selector.\n${JSON.stringify(preview.sample)}`, 3);
      }
    }
    await handle.click();
    await sleep(1000);
    const info = await describe(page);
    const shot = await shoot(page);
    emit({ clicked: args.text || args.selector, ...info, shot, events: watcher.events });
  } finally {
    watcher.stop();
    await browser.disconnect();
  }
}

async function typeInto(args) {
  const browser = await connect();
  const page = await pickPage(browser, args.urlIncludes);
  try {
    const meta = await page.$eval(args.selector, (el) => ({
      tag: el.tagName,
      type: (el.getAttribute("type") || "").toLowerCase(),
    }));
    if (meta.type === "password" || /pass/i.test(args.selector)) {
      die("Refusing to type into a password field. The user types secrets in the Brave window.", 2);
    }
    await page.click(args.selector);
    await page.type(args.selector, args.text, { delay: 15 });
    emit({ typed: true, selector: args.selector, characters: args.text.length, tag: meta.tag, type: meta.type });
  } finally {
    await browser.disconnect();
  }
}

async function evaluate(code, urlIncludes) {
  if (SECRET_RE.test(code)) die("Refusing eval that touches cookies, storage, passwords, or credentials.", 2);
  const browser = await connect();
  const page = await pickPage(browser, urlIncludes);
  try {
    const result = await page.evaluate((source) => {
      const AsyncFunction = async function () {}.constructor;
      return new AsyncFunction(`return (${source})`)();
    }, code);
    const text = redact(typeof result === "string" ? result : JSON.stringify(result));
    emit({ href: page.url(), result: text.slice(0, 4000), truncated: text.length > 4000 });
  } finally {
    await browser.disconnect();
  }
}

function appendLog(event) {
  mkdirSync(PROFILE, { recursive: true });
  appendFileSync(LOG_FILE, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n");
}

async function runLog() {
  const browser = await connect();
  writeFileSync(LOG_PID, String(process.pid));
  appendLog({ kind: "log-start", pid: process.pid });
  const seen = new WeakSet();
  const attach = (page) => {
    if (!page || seen.has(page)) return;
    seen.add(page);
    page.on("console", (msg) => {
      appendLog({ kind: "console", type: msg.type(), text: redact(msg.text()).slice(0, 500), page: safeUrl(page.url()) });
    });
    page.on("pageerror", (err) => appendLog({ kind: "pageerror", text: redact(String(err)).slice(0, 500), page: safeUrl(page.url()) }));
    page.on("requestfailed", (req) => {
      appendLog({
        kind: "failed",
        type: req.resourceType(),
        method: req.method(),
        url: safeUrl(req.url()),
        error: req.failure()?.errorText || "",
        page: safeUrl(page.url()),
      });
    });
    page.on("response", (res) => {
      const req = res.request();
      if (req.resourceType() !== "xhr" && req.resourceType() !== "fetch") return;
      appendLog({ kind: "response", status: res.status(), method: req.method(), url: safeUrl(res.url()), page: safeUrl(page.url()) });
    });
  };
  for (const page of await browser.pages()) attach(page);
  browser.on("targetcreated", async (target) => {
    if (target.type() !== "page") return;
    try {
      attach(await target.page());
    } catch {
      // Target can close before page() resolves.
    }
  });
  await new Promise(() => {});
}

function logStart() {
  if (existsSync(LOG_PID) && pidAlive(Number(readFileSync(LOG_PID, "utf8").trim()))) {
    emit({ started: false, alreadyRunning: true, pid: Number(readFileSync(LOG_PID, "utf8").trim()), file: LOG_FILE });
    return;
  }
  mkdirSync(PROFILE, { recursive: true });
  const child = spawn(process.execPath, [SCRIPT, "log", "run"], { detached: true, stdio: "ignore" });
  child.unref();
  writeFileSync(LOG_PID, String(child.pid));
  emit({ started: true, pid: child.pid, file: LOG_FILE });
}

function logStop() {
  if (!existsSync(LOG_PID)) {
    emit({ stopped: false, reason: "no pid file" });
    return;
  }
  const pid = Number(readFileSync(LOG_PID, "utf8").trim());
  if (pidAlive(pid)) process.kill(pid, "SIGTERM");
  rmSync(LOG_PID, { force: true });
  emit({ stopped: true, pid });
}

function logShow(lines) {
  if (!existsSync(LOG_FILE)) die(`No log yet at ${LOG_FILE}. Run: log start`, 1);
  const rows = readFileSync(LOG_FILE, "utf8").trim().split("\n").filter(Boolean);
  emit({ file: LOG_FILE, showing: Math.min(lines, rows.length), events: rows.slice(-lines).map((line) => JSON.parse(line)) });
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--restart") out.restart = true;
    else if (arg === "--role") out.role = argv[++i];
    else if (arg === "--selector") out.selector = argv[++i];
    else if (arg === "--text") out.text = argv[++i];
    else if (arg === "--url-includes") out.urlIncludes = argv[++i];
    else if (arg === "--lines") out.lines = Number(argv[++i]);
    else out._.push(arg);
  }
  return out;
}

function help() {
  console.log(`Usage: pi-brave.mjs <command>

  status                         CDP, profile, tabs. Run this first.
  start [--restart]              Launch Pi's Brave only. --restart quits that profile, never daily Brave.
  open <url> [--url-includes s]  Navigate, wait for paint, resize, screenshot.
  snapshot [--url-includes s]    Read the current page without navigating.
  click --text "Label" [--role tab] [--url-includes s]
  click --selector "css" [--url-includes s]
  type --selector "css" --text "value"
  eval "<expression>" [--url-includes s]
  log start|stop|show [--lines 40]

Do not print cookies, Authorization headers, or password values.
Read the screenshot path only after this command exits.`);
}

const args = parseArgs(process.argv.slice(2));
const [command, extra] = args._;

try {
  if (!command || command === "help") help();
  else if (command === "status") await status();
  else if (command === "start") await start(Boolean(args.restart));
  else if (command === "open") await open(extra, args.urlIncludes);
  else if (command === "snapshot") await snapshot(args.urlIncludes);
  else if (command === "click") await click(args);
  else if (command === "type") {
    if (!args.selector || args.text === undefined) die("type requires --selector and --text");
    await typeInto(args);
  } else if (command === "eval") {
    if (!extra) die("eval requires an expression");
    await evaluate(extra, args.urlIncludes);
  } else if (command === "log" && extra === "run") await runLog();
  else if (command === "log" && extra === "start") logStart();
  else if (command === "log" && extra === "stop") logStop();
  else if (command === "log" && extra === "show") logShow(args.lines || 40);
  else die(`Unknown command: ${command}\n`, 1);
} catch (error) {
  die(error?.stack || String(error));
}
