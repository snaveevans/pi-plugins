import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import goalExtension from "../extensions/goal.ts";
import { budgetReached, costBudgetReached, tokenBudgetReached } from "../extensions/goal-accounting.ts";
import { parseGoalCostOption } from "../extensions/goal-cost.ts";
import { currentDraft } from "../extensions/goal-drafting.ts";
import { createGoal, normalizeGoalRecord, validateMaxCostUsd, goalFocusDetails } from "../extensions/goal-record.ts";
import { goalLedgerPath } from "../extensions/goal-ledger.ts";
import { parseGoalFile, writeActiveGoalFile } from "../extensions/storage/goal-files.ts";
import { buildGoalStatusText } from "../extensions/goal-status.ts";
import { runGoalCompletionAuditor } from "../extensions/goal-auditor.ts";
import { runGoalCompletionFlow } from "../extensions/goal-completion.ts";
import { readFileSync } from "node:fs";

function harness(cwd: string, entries: unknown[] = [], runCompletionAuditor?: typeof runGoalCompletionAuditor) {
 const handlers = new Map<string, Function>();
 const tools = new Map<string, any>();
 const commands = new Map<string, any>();
 const notifications: string[] = [];
 const messages: string[] = [];
 const pi = {
  registerTool: (def: any) => tools.set(def.name, def),
  registerCommand: (name: string, def: any) => commands.set(name, def),
  on: (name: string, fn: Function) => handlers.set(name, fn),
  appendEntry: (customType: string, data: unknown) => { entries.push({type: "custom", customType, data}); },
  registerMessageRenderer: () => {}, sendMessage: () => {},
  sendUserMessage: (message: string) => messages.push(message),
  getActiveTools: () => ["read", "bash", "edit", "write"], setActiveTools: () => {},
  events: {on: () => () => {}},
 };
 const ctx = {
  cwd, hasUI: false, isIdle: () => true, hasPendingMessages: () => false, abort: () => {},
  sessionManager: { getBranch: () => [...entries], getEntries: () => [...entries], getCwd: () => cwd, getSessionId: () => "usd-test", getRoot: () => cwd },
  ui: { notify: (s: string) => notifications.push(s), setStatus: () => {}, setWidget: () => {}, onTerminalInput: () => () => {}, custom: async () => undefined, confirm: async () => false },
 } as unknown as ExtensionContext;
 goalExtension(pi as any, {runCompletionAuditor});
 const core = (pi as any)._goalCore;
 const run = async (cost: number | null, input = 50, output = 10) => {
  await handlers.get("agent_start")?.({}, ctx);
  await handlers.get("turn_start")?.({}, ctx);
  await handlers.get("turn_end")?.({message: {role: "assistant", stopReason: "stop", usage: {input, output, totalTokens: input+output, cost: cost === null ? undefined : {total: cost}}}, toolResults: []}, ctx);
 };
 return {handlers, tools, commands, ctx, core, entries, notifications, messages, run};
}
function temp() { return mkdtempSync(path.join(tmpdir(), "pi-goal-cost-")); }
function disk(cwd: string) {
 const dir = path.join(cwd, ".pi", "goals");
 const name = readdirSync(dir).find(s => s.startsWith("active_goal_"));
 assert.ok(name, "a goal file exists");
 return parseGoalFile(path.join(dir, name))!;
}
function events(cwd: string) {
 return readFileSync(goalLedgerPath({cwd}), "utf8").trim().split("\n").map(s => JSON.parse(s) as {type: string});
}
function response(cost: number, tokens = 50) {
 return {role: "assistant", stopReason: "stop", usage: {input: tokens, output: 0, cacheRead: 20000, totalTokens: tokens + 20000, cost: {total: cost}}};
}

 test("/goal --max-cost accepts positive cents and never hides invalid values in the objective", () => {
  assert.deepEqual(parseGoalCostOption("--max-cost 5.00 Ship changes"), {ok: true, objective: "Ship changes", maxCostUsd: 5});
  assert.deepEqual(parseGoalCostOption("Ship --max-cost text"), {ok: true, objective: "Ship --max-cost text"});
  for (const text of ["--max-cost", "--max-cost 0", "--max-cost -5", "--max-cost 5.123 Story", "--max-cost 5abc Story", "--unknown 5 Story", "--max-cost Infinity Story", "--max-cost 9007199254740992 Story"]) {
   assert.equal(parseGoalCostOption(text).ok, false, text);
  }
  assert.equal(validateMaxCostUsd(0.01).ok, true);
  assert.equal(validateMaxCostUsd(0.001).ok, false);
  assert.equal(validateMaxCostUsd(NaN).ok, false);
 });

 test("guided draft charges early responses including cached-input cost, persists through reload, and seeds the confirmed goal", async t => {
  const cwd = temp(); t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const h = harness(cwd); await h.handlers.get("session_start")?.({reason: "startup"}, h.ctx);
  await h.commands.get("goal").handler("--max-cost 0.10 Implement X", h.ctx);
  assert.match(h.messages[0]!, /Implement X/);
  await h.run(0.03);
  assert.equal(currentDraft(h.core)?.costUsedUsd, 0.03);
  const context = await h.handlers.get("context")?.({messages: []}, h.ctx);
  assert.match(JSON.stringify(context), /Draft cost so far: \$0\.0300 \/ \$0\.10/);
  await h.commands.get("goal-status").handler("", h.ctx);
  assert.match(h.notifications.at(-1)!, /Guided draft in progress.*\$0\.0300 used/);
  assert.equal((h.entries.filter((e: any) => e.customType === "pi-goal-draft").at(-1) as {data?: {costUsedUsd?: number}} | undefined)?.data?.costUsedUsd, 0.03);
  // Simulate a /reload into a new extension instance with the same session branch.
  const reloaded = harness(cwd, h.entries);
  await reloaded.handlers.get("session_start")?.({reason: "reload"}, reloaded.ctx);
  assert.equal(currentDraft(reloaded.core)?.costUsedUsd, 0.03);
  const prior = process.env.PI_GOAL_AUTO_CONFIRM;
  process.env.PI_GOAL_AUTO_CONFIRM = "1";
  try {
   await reloaded.handlers.get("agent_start")?.({}, reloaded.ctx);
   await reloaded.handlers.get("turn_start")?.({}, reloaded.ctx);
   const result = await reloaded.tools.get("propose_goal_draft").execute("draft-proposal", {objective: "Implement X", sisyphus: false}, new AbortController().signal, undefined, reloaded.ctx);
   assert.match(result.content[0].text, /\$0\.0300 used/);
   assert.equal(disk(cwd).usage.costUsd, 0.03);
   await reloaded.handlers.get("turn_end")?.({message: response(0.04), toolResults: []}, reloaded.ctx);
   assert.equal(disk(cwd).maxCostUsd, 0.10);
   assert.ok(Math.abs((disk(cwd).usage.costUsd ?? 0) - 0.07) < 1e-9);
   assert.equal(disk(cwd).status, "active");
  } finally { if (prior === undefined) delete process.env.PI_GOAL_AUTO_CONFIRM; else process.env.PI_GOAL_AUTO_CONFIRM = prior; }
 });

 test("a draft reaching the limit stops before confirmation, does not create a goal", async t => {
  const cwd = temp(); t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const h = harness(cwd); await h.handlers.get("session_start")?.({reason: "startup"}, h.ctx);
  await h.commands.get("goal").handler("--max-cost 0.02 Draft something", h.ctx);
  await h.run(0.025);
  assert.equal(currentDraft(h.core), undefined);
  assert.equal((h.entries.filter((e: any) => e.customType === "pi-goal-draft").at(-1) as {data?: {clearedAt?: string}} | undefined)?.data?.clearedAt !== undefined, true);
  assert.match(h.notifications.join("\n"), /Draft stopped: estimated cost/);
  assert.equal(existsSync(path.join(cwd, ".pi", "goals")), false);
 });

 test("corrupt persisted draft cap fails closed instead of restoring an unlimited draft", async t => {
  const cwd = temp(); t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const entries = [{type: "custom", customType: "pi-goal-draft", data: {version: 1, mode: "goal", seed: "Build X", startedAt: new Date().toISOString(), auditorEnabled: true, maxCostUsd: "bad", costUsedUsd: 0}}];
  const h = harness(cwd, entries);
  await h.handlers.get("session_start")?.({reason: "startup"}, h.ctx);
  assert.equal(currentDraft(h.core), undefined);
  assert.match(h.notifications.join("\n"), /persisted cost data is invalid/);
 });

 test("an aborted drafting response is charged even without turn_end and is not double charged when turn_end ran", async t => {
  const cwd = temp(); t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const h = harness(cwd); await h.handlers.get("session_start")?.({reason: "startup"}, h.ctx);
  await h.commands.get("goal").handler("--max-cost 0.10 Draft X", h.ctx);
  await h.handlers.get("agent_start")?.({}, h.ctx);
  await h.handlers.get("turn_start")?.({}, h.ctx);
  const aborted = {...response(0.03), stopReason: "aborted"};
  await h.handlers.get("agent_end")?.({messages: [aborted]}, h.ctx);
  assert.equal(currentDraft(h.core)?.costUsedUsd, 0.03);
  await h.handlers.get("turn_start")?.({}, h.ctx);
  const handled = {...response(0.02), stopReason: "aborted"};
  await h.handlers.get("turn_end")?.({message: handled, toolResults: []}, h.ctx);
  await h.handlers.get("agent_end")?.({messages: [handled]}, h.ctx);
  assert.equal(currentDraft(h.core)?.costUsedUsd, 0.05);
 });

 test("direct goal cost cap transitions on estimated USD, not token count; status and ledger identify the cause", async t => {
  const cwd = temp(); t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const h = harness(cwd); await h.handlers.get("session_start")?.({reason: "startup"}, h.ctx);
  await h.commands.get("goal-direct").handler("--max-cost 0.10 Ship it", h.ctx);
  assert.equal(disk(cwd).maxCostUsd, 0.1);
  await h.run(0.11);
  assert.equal(disk(cwd).status, "budget_limited");
  assert.ok(Math.abs((disk(cwd).usage.costUsd ?? 0) - 0.11) < 1e-9);
  assert.equal(events(cwd).filter(e => e.type === "goal_cost_budget_limited").length, 1);
  assert.equal(events(cwd).filter(e => e.type === "goal_budget_limited").length, 0);
  assert.match(buildGoalStatusText({goal: disk(cwd), focused: true, otherOpenGoals: 0}), /Est\. cost.*\$0\.1100 \/ \$0\.10/);
  assert.match(buildGoalStatusText({goal: disk(cwd), focused: true, otherOpenGoals: 0, verbose: true}), /Pi model pricing; not a billing guarantee/);
  await h.run(0.5);
  assert.equal(events(cwd).filter(e => e.type === "goal_cost_budget_limited").length, 1);
 });

 test("unpriced model response fails closed for USD-capped goals", async t => {
  const cwd = temp(); t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const h = harness(cwd); await h.handlers.get("session_start")?.({reason: "startup"}, h.ctx);
  await h.commands.get("goal-direct").handler("--max-cost 5.00 Ship it", h.ctx);
  await h.run(null);
  assert.equal(disk(cwd).status, "paused");
  assert.match(disk(cwd).pauseReason ?? "", /USD cap cannot be enforced/);
 });

 test("token and USD caps are independent and legacy usage remains compatible", () => {
  const goal = createGoal({objective: "Both limits", autoContinue: true, sisyphus: false});
  goal.tokenBudget = 100; goal.maxCostUsd = 5;
  goal.usage.tokensUsed = 4; goal.usage.costUsd = 5.01;
  assert.equal(costBudgetReached(goal), true);
  assert.equal(tokenBudgetReached(goal), false);
  assert.equal(budgetReached(goal), true);
  const old = normalizeGoalRecord({...goal, maxCostUsd: undefined, usage: {tokensUsed: 55, activeSeconds: 3}})!;
  assert.equal(old.maxCostUsd, undefined);
  assert.equal(old.usage.costUsd, undefined);
  assert.equal(normalizeGoalRecord({...goal, maxCostUsd: -5}), null, "a corrupt cap must not become unlimited");
  assert.equal(normalizeGoalRecord({...goal, usage: {...goal.usage, costUsd: -1}}), null, "corrupt spending must not be reset to zero");
 });

 test("auditor attributes every nested response, aborts on cost limit, never treats it as user approval", async t => {
  const cwd = temp(); t.after(() => rmSync(cwd, {recursive: true, force: true}));
  let subscriber: (event: any) => void = () => {};
  let aborted = false; const seen: number[] = [];
  const mockSession = {
   subscribe: (fn: (event: any) => void) => { subscriber = fn; return () => {}; },
   abort: async () => { aborted = true; }, dispose: () => {},
   prompt: async () => {
    subscriber({type: "message_end", message: {...response(0.02), content: [{type: "text", text: "Checked A"}]}});
    subscriber({type: "message_end", message: {...response(0.09), content: [{type: "text", text: "<approved/>"}]}});
   },
  };
  const result = await runGoalCompletionAuditor({
   ctx: {cwd, modelRegistry: {find: () => undefined}, model: undefined} as any,
   goal: createGoal({objective: "Review X", autoContinue: true, sisyphus: false}), detailedSummary: "X",
   createSession: async () => ({session: mockSession}) as any,
   onCost: cost => {seen.push(cost ?? 0); return seen.reduce((a,b)=>a+b,0) < 0.10;},
  });
  assert.deepEqual(seen, [0.02, 0.09]);
  assert.equal(aborted, true);
  assert.equal(result.approved, false);
  assert.equal(result.error, "Estimated cost limit reached.");
  assert.ok(Math.abs((result.costUsd ?? 0) - 0.11) < 1e-9);
 });

 test("cost charged by independent auditor stops approval and cannot be bypassed as Escape", async t => {
  const cwd = temp(); t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const mockAuditor = (async (args: Parameters<typeof runGoalCompletionAuditor>[0]) => {
   assert.equal(args.onCost?.(0.07), false);
   return {approved: true, disapproved: false, output: "<approved/>", error: "Estimated cost limit reached.", costUsd: 0.07};
  }) as typeof runGoalCompletionAuditor;
  const h = harness(cwd, [], mockAuditor); await h.handlers.get("session_start")?.({reason: "startup"}, h.ctx);
  await h.commands.get("goal-direct").handler("--max-cost 0.05 Ship it", h.ctx);
  const result = await runGoalCompletionFlow(h.core, h.ctx);
  assert.match(JSON.stringify(result.content), /not completed/);
  assert.equal(disk(cwd).status, "budget_limited");
  assert.equal(disk(cwd).usage.costUsd, 0.07);
  assert.equal(events(cwd).filter(e => e.type === "goal_completed").length, 0);
  await h.handlers.get("turn_end")?.({message: response(0.002), toolResults: []}, h.ctx);
  assert.ok(Math.abs((disk(cwd).usage.costUsd ?? 0) - 0.072) < 1e-9, "cost of invoking the auditor is still counted after the goal stops");
  assert.ok(!h.notifications.some(text => text.includes("bypassed audit")));
 });

 test("approved audit and final parent turn cost persist to the archived goal", async t => {
  const cwd = temp(); t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const mockAuditor = (async (args: Parameters<typeof runGoalCompletionAuditor>[0]) => {
   assert.equal(args.onCost?.(0.02), true);
   return {approved: true, disapproved: false, output: "<approved/>", costUsd: 0.02};
  }) as typeof runGoalCompletionAuditor;
  const h = harness(cwd, [], mockAuditor); await h.handlers.get("session_start")?.({reason: "startup"}, h.ctx);
  await h.commands.get("goal-direct").handler("--max-cost 0.20 Ship it", h.ctx);
  const result = await runGoalCompletionFlow(h.core, h.ctx);
  assert.match(JSON.stringify(result.content), /Goal complete/);
  await h.handlers.get("turn_end")?.({message: response(0.01), toolResults: []}, h.ctx);
  const archivedDir = path.join(cwd, ".pi", "goals", "archived");
  const archived = readdirSync(archivedDir).find(name => name.endsWith(".md"));
  assert.ok(archived, "approved goal archived");
  const saved = parseGoalFile(path.join(archivedDir, archived));
  assert.ok(Math.abs((saved?.usage.costUsd ?? 0) - 0.03) < 1e-9, "auditor and final response charged once");
 });

 test("a cost-only /goal-tweak raises or removes the cap without resetting usage", async t => {
  const cwd = temp(); t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const h = harness(cwd); await h.handlers.get("session_start")?.({reason: "startup"}, h.ctx);
  await h.commands.get("goal-direct").handler("--max-cost 0.10 Ship it", h.ctx);
  await h.run(0.11);
  assert.equal(disk(cwd).status, "budget_limited");
  const prior = process.env.PI_GOAL_AUTO_CONFIRM; process.env.PI_GOAL_AUTO_CONFIRM = "1";
  try {
   await h.commands.get("goal-tweak").handler("raise cost cap to $0.50", h.ctx);
   await h.handlers.get("turn_start")?.({}, h.ctx);
   const raised = await h.tools.get("propose_goal_draft").execute("raise", {objective: "Ship it", max_cost_usd: 0.5}, new AbortController().signal, undefined, h.ctx);
   assert.match(raised.content[0].text, /\$0\.50/);
   await h.handlers.get("turn_end")?.({message: response(0.01), toolResults: []}, h.ctx);
   assert.equal(disk(cwd).maxCostUsd, 0.5);
   assert.ok(Math.abs((disk(cwd).usage.costUsd ?? 0) - 0.12) < 1e-9);
   assert.notEqual(disk(cwd).status, "budget_limited");
   await h.commands.get("goal-tweak").handler("remove cost cap", h.ctx);
   await h.handlers.get("turn_start")?.({}, h.ctx);
   const removed = await h.tools.get("propose_goal_draft").execute("remove", {objective: "Ship it", max_cost_usd: null}, new AbortController().signal, undefined, h.ctx);
   assert.match(removed.content[0].text, /Max estimated cost: none/);
   await h.handlers.get("turn_end")?.({message: response(0.02), toolResults: []}, h.ctx);
   assert.equal(disk(cwd).maxCostUsd, undefined);
   assert.ok(Math.abs((disk(cwd).usage.costUsd ?? 0) - 0.14) < 1e-9);
   assert.equal(events(cwd).filter(e => e.type === "goal_cost_budget_changed").length, 2);
  } finally {if (prior === undefined) delete process.env.PI_GOAL_AUTO_CONFIRM; else process.env.PI_GOAL_AUTO_CONFIRM = prior;}
 });

 test("capped goal charges tool-reported nested usage and Pi compaction summaries", async t => {
  const cwd = temp(); t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const h = harness(cwd); await h.handlers.get("session_start")?.({reason: "startup"}, h.ctx);
  await h.commands.get("goal-direct").handler("--max-cost 0.05 Ship it", h.ctx);
  await h.handlers.get("turn_end")?.({message: response(0.01), toolResults: [{usage: {cost: {total: 0.02}}}]}, h.ctx);
  assert.ok(Math.abs((disk(cwd).usage.costUsd ?? 0) - 0.03) < 1e-9);
  await h.handlers.get("session_compact")?.({compactionEntry: {usage: {cost: {total: 0.025}}}}, h.ctx);
  assert.equal(disk(cwd).status, "budget_limited");
  assert.ok(Math.abs((disk(cwd).usage.costUsd ?? 0) - 0.055) < 1e-9);
 });

 test("Pi cache-warming usage entries are charged once before further goal work", async t => {
  const cwd = temp(); t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const h = harness(cwd); await h.handlers.get("session_start")?.({reason: "startup"}, h.ctx);
  await h.commands.get("goal-direct").handler("--max-cost 0.05 Ship it", h.ctx);
  h.entries.push({type: "usage", id: "warm-1", timestamp: new Date().toISOString(), kind: "cache_warm", usage: {cost: {total: 0.02}}});
  await h.run(0.01);
  assert.ok(Math.abs((disk(cwd).usage.costUsd ?? 0) - 0.03) < 1e-9);
  await h.run(0.01);
  assert.ok(Math.abs((disk(cwd).usage.costUsd ?? 0) - 0.04) < 1e-9, "do not count the same usage entry twice");
  h.entries.push({type: "usage", id: "warm-2", timestamp: new Date().toISOString(), kind: "cache_warm", usage: {cost: {total: 0.02}}});
  await h.handlers.get("agent_settled")?.({}, h.ctx);
  assert.equal(disk(cwd).status, "budget_limited");
  assert.ok(Math.abs((disk(cwd).usage.costUsd ?? 0) - 0.06) < 1e-9);
 });

 test("a paused goal that spends its remaining cost during a tweak becomes cost-limited", async t => {
  const cwd = temp(); t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const h = harness(cwd); await h.handlers.get("session_start")?.({reason: "startup"}, h.ctx);
  await h.commands.get("goal-direct").handler("--max-cost 0.05 Ship it", h.ctx);
  h.core.goalService.apply(h.ctx, {mutate: (goal: any) => ({...goal, status: "paused"})});
  h.core.chargeGoalCost(h.ctx, 0.06);
  assert.equal(disk(cwd).status, "budget_limited");
  assert.equal(events(cwd).filter(e => e.type === "goal_cost_budget_limited").length, 1);
 });

 test("create_goal tool accepts explicit max_cost_usd and direct commands reject bad options", async t => {
  const cwd = temp(); t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const h = harness(cwd); await h.handlers.get("session_start")?.({reason: "startup"}, h.ctx);
  await h.commands.get("goal-direct").handler("--max-cost 0.001 invalid", h.ctx);
  assert.equal(existsSync(path.join(cwd, ".pi", "goals")), false);
  const invalid = await h.tools.get("create_goal").execute("bad", {objective: "X", max_cost_usd: 0.001}, new AbortController().signal, undefined, h.ctx);
  assert.match(invalid.content[0].text, /positive USD amount/);
  const created = await h.tools.get("create_goal").execute("good", {objective: "X", max_cost_usd: 1.25}, new AbortController().signal, undefined, h.ctx);
  assert.match(created.content[0].text, /\$1\.25/);
  assert.equal(disk(cwd).maxCostUsd, 1.25);
 });
