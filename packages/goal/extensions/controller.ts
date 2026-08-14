/**
 * Session-scoped goal controller.
 * One goal at a time. After each settled turn a small model judges the condition.
 */

import {
	buildSessionContext,
	convertToLlm,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Message, Model, Usage } from "@earendil-works/pi-ai";
import {
	formatDuration,
	isFastModel,
	MAX_TRANSCRIPT_CHARS,
	parseVerdict,
	STUCK_IDLE_TURNS,
	summarizeText,
	truncateCondition,
	type GoalVerdict,
	type ParsedVerdict,
} from "./parse.ts";

export const ENTRY_TYPE = "session-goal";
export const STATUS_KEY = "session-goal";
export const CUSTOM_TYPE = "session-goal";
export const MAX_CONDITION_DISPLAY = 64;

export type GoalPhase = "active" | "evaluating" | "achieved" | "failed";

export interface GoalState {
	condition: string;
	createdAt: number;
	evaluatedTurns: number;
	idleTurns: number;
	phase: GoalPhase;
	lastVerdict?: GoalVerdict;
	lastReason?: string;
	lastEvaluatedAt?: number;
	evaluator?: string;
	usage?: GoalUsage;
}

export interface GoalUsage {
	input: number;
	output: number;
	cost: number;
}

export interface GoalEntryData {
	goal?: GoalState | null;
}

export interface GoalEventDetails {
	kind: "continue" | "achieved" | "failed" | "stuck";
	condition: string;
	reason: string;
	evaluatedTurns: number;
	verdict?: GoalVerdict;
}

export interface StartGoalInput {
	condition: string;
}

export interface CommandResult {
	ok: boolean;
	message: string;
	notify?: "info" | "warning" | "error";
}

export interface GoalController {
	getState(): GoalState | undefined;
	start(ctx: ExtensionContext, input: StartGoalInput): CommandResult;
	clear(ctx: ExtensionContext, message?: string): CommandResult;
	status(): CommandResult;
	restore(ctx: ExtensionContext): void;
	shutdown(): void;
	onSettled(ctx: ExtensionContext): void;
	describe(): string;
}

const EVALUATOR_SYSTEM = `You are a goal evaluator. You do not write code or call tools.
Judge only what the conversation already shows. Do not assume hidden file state.

Reply with JSON only:
{"verdict":"met"|"not_met"|"impossible","reason":"<one or two sentences>"}

- met: the condition is demonstrably true in the transcript
- not_met: still possible, work remains
- impossible: the condition cannot be satisfied from here

The reason for not_met is guidance for the next working turn.`;

export function createGoalController(pi: ExtensionAPI): GoalController {
	let goal: GoalState | undefined;
	let evaluating = false;
	let evalGeneration = 0;
	let skipNextSettle = false;
	let lastCtx: ExtensionContext | undefined;
	let ticker: ReturnType<typeof setInterval> | undefined;

	function start(ctx: ExtensionContext, input: StartGoalInput): CommandResult {
		lastCtx = ctx;
		const condition = truncateCondition(input.condition.trim());
		if (!condition) {
			return { ok: false, message: "No goal condition. Pass one after /goal.", notify: "warning" };
		}

		evalGeneration += 1;
		evaluating = false;
		// Mid-turn start (tool call): the current settle is not a goal turn.
		skipNextSettle = !ctx.isIdle();
		const replaced = Boolean(goal && (goal.phase === "active" || goal.phase === "evaluating"));
		applyGoal(ctx, {
			condition,
			createdAt: Date.now(),
			evaluatedTurns: 0,
			idleTurns: 0,
			phase: "active",
		});

		try {
			pi.sendMessage(
				{
					customType: CUSTOM_TYPE,
					content: continuePrompt(condition, "Work toward this condition. Prove it in the transcript (run the check, show the result)."),
					display: true,
					details: {
						kind: "continue",
						condition,
						reason: "Goal set",
						evaluatedTurns: 0,
					} satisfies GoalEventDetails,
				},
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		} catch (error) {
			return {
				ok: false,
				message: `Goal set, but the first turn failed: ${error instanceof Error ? error.message : String(error)}`,
				notify: "error",
			};
		}

		const preview = summarizeText(condition, MAX_CONDITION_DISPLAY);
		return {
			ok: true,
			message: replaced ? `Replaced goal · ${preview}` : `Goal set · ${preview}`,
			notify: "info",
		};
	}

	function clear(ctx: ExtensionContext, message = "Goal cleared"): CommandResult {
		lastCtx = ctx;
		evalGeneration += 1;
		evaluating = false;
		skipNextSettle = false;
		if (!goal || goal.phase === "achieved" || goal.phase === "failed") {
			if (!goal) return { ok: false, message: "No goal set", notify: "warning" };
			goal = undefined;
			persist();
			updateChrome(ctx);
			return { ok: true, message, notify: "info" };
		}
		const condition = goal.condition;
		goal = undefined;
		persist();
		updateChrome(ctx);
		return { ok: true, message: `${message}: ${summarizeText(condition, MAX_CONDITION_DISPLAY)}`, notify: "info" };
	}

	function status(): CommandResult {
		return { ok: true, message: describe(), notify: "info" };
	}

	function restore(ctx: ExtensionContext) {
		lastCtx = ctx;
		clearTicker();
		const saved = lastSavedGoal(ctx);
		if (!saved) {
			goal = undefined;
			updateChrome(ctx);
			return;
		}
		if (saved.phase === "achieved" || saved.phase === "failed") {
			goal = saved;
			updateChrome(ctx);
			return;
		}

		goal = {
			...saved,
			phase: "active",
			evaluatedTurns: 0,
			idleTurns: 0,
			lastVerdict: undefined,
			lastReason: undefined,
			lastEvaluatedAt: undefined,
			usage: undefined,
		};
		persist();
		armTicker(ctx);
		updateChrome(ctx);
		ctx.ui.notify(`Restored goal · ${summarizeText(goal.condition, MAX_CONDITION_DISPLAY)}`, "info");
	}

	function shutdown() {
		evalGeneration += 1;
		evaluating = false;
		skipNextSettle = false;
		clearTicker();
		lastCtx = undefined;
	}

	function onSettled(ctx: ExtensionContext) {
		lastCtx = ctx;
		if (skipNextSettle) {
			skipNextSettle = false;
			return;
		}
		if (!goal || goal.phase !== "active") return;
		if (evaluating) return;
		if (!ctx.isIdle()) return;
		void evaluate(ctx);
	}

	function describe(): string {
		if (!goal) return "No goal set";
		const preview = summarizeText(goal.condition, MAX_CONDITION_DISPLAY);
		const elapsed = formatDuration(Date.now() - goal.createdAt);
		if (goal.phase === "achieved") {
			return `achieved · ${elapsed} · ${goal.evaluatedTurns} turns · ${preview}`;
		}
		if (goal.phase === "failed") {
			return `failed · ${elapsed} · ${goal.evaluatedTurns} turns · ${preview}${goal.lastReason ? ` · ${goal.lastReason}` : ""}`;
		}
		const bits = [
			goal.phase === "evaluating" ? "evaluating" : "active",
			elapsed,
			`${goal.evaluatedTurns} turns`,
			preview,
		];
		if (goal.usage) bits.push(formatUsage(goal.usage));
		if (goal.lastReason) bits.push(goal.lastReason);
		return bits.join(" · ");
	}

	function applyGoal(ctx: ExtensionContext, next: GoalState) {
		lastCtx = ctx;
		goal = next;
		persist();
		armTicker(ctx);
		updateChrome(ctx);
	}

	function lastSavedGoal(ctx: ExtensionContext): GoalState | undefined {
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
			const data = entry.data as GoalEntryData | undefined;
			const saved = data?.goal;
			if (!saved || typeof saved.condition !== "string" || !saved.condition.trim()) return undefined;
			if (saved.phase !== "active" && saved.phase !== "evaluating" && saved.phase !== "achieved" && saved.phase !== "failed") {
				saved.phase = "active";
			}
			if (!Number.isFinite(saved.evaluatedTurns) || saved.evaluatedTurns < 0) saved.evaluatedTurns = 0;
			if (!Number.isFinite(saved.idleTurns) || saved.idleTurns < 0) saved.idleTurns = 0;
			if (!Number.isFinite(saved.createdAt)) saved.createdAt = Date.now();
			return saved;
		}
		return undefined;
	}

	function persist() {
		pi.appendEntry(ENTRY_TYPE, { goal: goal ?? null } satisfies GoalEntryData);
	}

	async function evaluate(ctx: ExtensionContext) {
		if (!goal || goal.phase !== "active" || evaluating) return;
		const token = evalGeneration;
		evaluating = true;
		goal.phase = "evaluating";
		updateChrome(ctx);

		try {
			const model = pickEvaluator(ctx);
			if (!model) {
				ctx.ui.notify("No model available to evaluate /goal", "error");
				if (goal && token === evalGeneration) {
					goal.phase = "active";
					persist();
					updateChrome(ctx);
				}
				return;
			}

			const reply = await ctx.modelRegistry.complete(model, {
				systemPrompt: EVALUATOR_SYSTEM,
				messages: buildEvaluatorMessages(ctx, goal),
			}, { maxTokens: 256 });

			if (!goal || token !== evalGeneration || goal.phase !== "evaluating") return;

			goal.evaluator = `${model.provider}/${model.id}`;
			goal.lastEvaluatedAt = Date.now();
			goal.evaluatedTurns += 1;
			addUsage(goal, reply.usage);

			const parsed = parseEvaluatorReply(reply);
			if (!parsed) {
				goal.phase = "active";
				goal.lastReason = "Evaluator reply was unreadable; continuing.";
				persist();
				updateChrome(ctx);
				continueWork(ctx, goal.lastReason);
				return;
			}

			goal.lastVerdict = parsed.verdict;
			goal.lastReason = parsed.reason;

			if (parsed.verdict === "met") {
				finish(ctx, "achieved", parsed.reason);
				return;
			}
			if (parsed.verdict === "impossible") {
				finish(ctx, "failed", parsed.reason);
				return;
			}

			if (lastTurnUsedTools(ctx)) {
				goal.idleTurns = 0;
			} else {
				goal.idleTurns += 1;
			}

			if (goal.idleTurns >= STUCK_IDLE_TURNS) {
				goal.idleTurns = 0;
				goal.phase = "active";
				persist();
				updateChrome(ctx);
				stuck(ctx, parsed.reason);
				return;
			}

			goal.phase = "active";
			persist();
			updateChrome(ctx);
			continueWork(ctx, parsed.reason);
		} catch (error) {
			if (!goal || token !== evalGeneration) return;
			goal.phase = "active";
			goal.lastReason = `Evaluator failed: ${error instanceof Error ? error.message : String(error)}`;
			persist();
			updateChrome(ctx);
			ctx.ui.notify(goal.lastReason, "error");
		} finally {
			if (token === evalGeneration) evaluating = false;
		}
	}

	function finish(ctx: ExtensionContext, phase: "achieved" | "failed", reason: string) {
		if (!goal) return;
		goal.phase = phase;
		goal.lastReason = reason;
		persist();
		updateChrome(ctx);

		const kind = phase === "achieved" ? "achieved" : "failed";
		const label = phase === "achieved" ? "Goal met" : "Goal impossible";
		try {
			pi.sendMessage(
				{
					customType: CUSTOM_TYPE,
					content: `${label}.\n\nCondition: ${goal.condition}\nReason: ${reason}`,
					display: true,
					details: {
						kind,
						condition: goal.condition,
						reason,
						evaluatedTurns: goal.evaluatedTurns,
						verdict: goal.lastVerdict,
					} satisfies GoalEventDetails,
				},
				{ triggerTurn: false, deliverAs: "nextTurn" },
			);
		} catch {
			// status chrome already reflects the outcome
		}
		ctx.ui.notify(`${label}: ${summarizeText(reason)}`, phase === "achieved" ? "info" : "warning");
	}

	function continueWork(ctx: ExtensionContext, reason: string) {
		if (!goal) return;
		try {
			pi.sendMessage(
				{
					customType: CUSTOM_TYPE,
					content: continuePrompt(goal.condition, reason),
					display: true,
					details: {
						kind: "continue",
						condition: goal.condition,
						reason,
						evaluatedTurns: goal.evaluatedTurns,
						verdict: "not_met",
					} satisfies GoalEventDetails,
				},
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		} catch (error) {
			ctx.ui.notify(`Goal continue failed: ${error instanceof Error ? error.message : String(error)}`, "error");
		}
	}

	function stuck(ctx: ExtensionContext, reason: string) {
		if (!goal) return;
		try {
			pi.sendMessage(
				{
					customType: CUSTOM_TYPE,
					content: `Goal paused: no tool use for ${STUCK_IDLE_TURNS} turns. The goal is still set.\n\nCondition: ${goal.condition}\nLatest reason: ${reason}\n\nSend another prompt to resume evaluation.`,
					display: true,
					details: {
						kind: "stuck",
						condition: goal.condition,
						reason,
						evaluatedTurns: goal.evaluatedTurns,
						verdict: "not_met",
					} satisfies GoalEventDetails,
				},
				{ triggerTurn: false, deliverAs: "nextTurn" },
			);
		} catch {
			// notify is enough
		}
		ctx.ui.notify("Goal paused: no progress. Send a prompt to resume.", "warning");
	}

	function updateChrome(ctx: ExtensionContext) {
		if (!goal || goal.phase === "achieved" || goal.phase === "failed") {
			clearTicker();
			paintChrome(ctx);
			return;
		}
		armTicker(ctx);
		paintChrome(ctx);
	}

	function paintChrome(ctx: ExtensionContext) {
		if (!goal || goal.phase === "achieved" || goal.phase === "failed") {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			ctx.ui.setWidget(STATUS_KEY, undefined);
			return;
		}

		const elapsed = formatDuration(Date.now() - goal.createdAt);
		const label = goal.phase === "evaluating" ? "goal:eval" : "goal:on";
		const spend = goal.usage ? ` · ${formatUsage(goal.usage)}` : "";
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", label));
		ctx.ui.setWidget(STATUS_KEY, [
			`goal ${elapsed} · ${goal.evaluatedTurns} turns${goal.evaluator ? ` · ${goal.evaluator}` : ""}${spend}`,
			summarizeText(goal.condition, MAX_CONDITION_DISPLAY),
			goal.lastReason ? summarizeText(goal.lastReason, 80) : "waiting for first evaluation",
		]);
	}

	function armTicker(ctx: ExtensionContext) {
		lastCtx = ctx;
		if (ticker !== undefined) return;
		if (!goal || goal.phase === "achieved" || goal.phase === "failed") return;
		ticker = setInterval(() => {
			if (!lastCtx) return;
			paintChrome(lastCtx);
		}, 1000);
	}

	function clearTicker() {
		if (ticker === undefined) return;
		clearInterval(ticker);
		ticker = undefined;
	}

	return {
		getState: () => goal,
		start,
		clear,
		status,
		restore,
		shutdown,
		onSettled,
		describe,
	};
}

export function pickEvaluator(ctx: ExtensionContext): Model<any> | undefined {
	const available = ctx.modelRegistry.getAvailable();
	const scoped = ctx.scopedModels.map((item) => item.model);
	const pool = scoped.length > 0 ? scoped.filter((model) => available.some((item) => sameModel(item, model))) : available;
	const usable = pool.filter((model) => ctx.modelRegistry.hasConfiguredAuth(model));
	if (usable.length === 0) return ctx.model;

	const fast = usable.filter((model) => isFastModel(model));
	const ranked = [...(fast.length > 0 ? fast : usable)].sort(compareEvaluator);
	const current = ctx.model;
	if (current && ranked.some((model) => sameModel(model, current)) && isFastModel(current)) {
		return current;
	}
	return ranked[0] ?? ctx.model;
}

export function stringifyContent(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") return content;
	return content
		.filter((part) => part.type === "text" && part.text)
		.map((part) => part.text)
		.join("\n");
}

function continuePrompt(condition: string, reason: string): string {
	return `Continue the session goal. Do not stop to ask whether to keep going.

Condition:
${condition}

Evaluator:
${reason}

Prove the condition in the transcript. If it is already met, run the check that shows it.`;
}

function buildEvaluatorMessages(ctx: ExtensionContext, state: GoalState): Message[] {
	const llm = convertToLlm(sessionMessages(ctx));
	const transcript = renderTranscript(llm);
	return [
		{
			role: "user",
			content: `Condition:\n${state.condition}\n\nTurns evaluated so far: ${state.evaluatedTurns}\n\nConversation (most recent last):\n${transcript}`,
			timestamp: Date.now(),
		},
	];
}

function renderTranscript(messages: Message[]): string {
	const lines: string[] = [];
	for (const message of messages) {
		const text = messageText(message).trim();
		if (!text) continue;
		lines.push(`${message.role}: ${text}`);
	}
	const joined = lines.join("\n\n");
	if (joined.length <= MAX_TRANSCRIPT_CHARS) return joined || "(empty transcript)";
	return `[earlier turns omitted]\n\n${joined.slice(-MAX_TRANSCRIPT_CHARS)}`;
}

function messageText(message: Message): string {
	if (message.role === "assistant") {
		return message.content
			.map((part) => {
				if (part.type === "text") return part.text;
				if (part.type === "toolCall") return `[tool ${part.name}]`;
				return "";
			})
			.filter(Boolean)
			.join("\n");
	}
	if (message.role === "toolResult") {
		const body = message.content
			.filter((part) => part.type === "text" && part.text)
			.map((part) => part.text)
			.join("\n");
		return `[${message.toolName}${message.isError ? " error" : ""}] ${body}`;
	}
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((part) => part.type === "text" && part.text)
		.map((part) => part.text)
		.join("\n");
}

function parseEvaluatorReply(reply: AssistantMessage): ParsedVerdict | undefined {
	if (reply.stopReason === "error" || reply.stopReason === "aborted") return undefined;
	const text = reply.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
	return parseVerdict(text);
}

function sessionMessages(ctx: ExtensionContext) {
	return buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId()).messages;
}

function lastTurnUsedTools(ctx: ExtensionContext): boolean {
	const messages = sessionMessages(ctx);
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role === "toolResult") return true;
		if (message.role === "assistant") {
			return message.content.some((part) => part.type === "toolCall");
		}
		if (message.role === "user" || message.role === "custom") return false;
	}
	return false;
}

function addUsage(state: GoalState, usage: Usage | undefined) {
	if (!usage) return;
	const current = state.usage ?? { input: 0, output: 0, cost: 0 };
	state.usage = {
		input: current.input + (usage.input ?? 0),
		output: current.output + (usage.output ?? 0),
		cost: current.cost + (usage.cost?.total ?? 0),
	};
}

function formatUsage(usage: GoalUsage): string {
	const tokens = usage.input + usage.output;
	if (usage.cost > 0) {
		const digits = usage.cost < 0.01 ? 4 : 2;
		return `$${usage.cost.toFixed(digits)}`;
	}
	if (tokens <= 0) return "0 tok";
	if (tokens < 1000) return `${tokens} tok`;
	return `${(tokens / 1000).toFixed(1)}k tok`;
}

function sameModel(a: Model<any>, b: Model<any>): boolean {
	return a.provider === b.provider && a.id === b.id;
}

function compareEvaluator(a: Model<any>, b: Model<any>): number {
	const costA = a.cost?.output ?? Number.POSITIVE_INFINITY;
	const costB = b.cost?.output ?? Number.POSITIVE_INFINITY;
	if (costA !== costB) return costA - costB;
	return `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`);
}
