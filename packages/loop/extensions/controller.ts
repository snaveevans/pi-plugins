/**
 * Session-scoped loop controller.
 * One loop at a time. Next tick is armed only after the current tick settles.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	clampInterval,
	DEFAULT_INTERVAL_MS,
	formatClock,
	formatDuration,
	MAX_INTERVAL_MS,
} from "./parse.ts";

export const ENTRY_TYPE = "session-loop";
export const STATUS_KEY = "session-loop";
export const CUSTOM_TYPE = "session-loop";
export const MAX_PROMPT_BYTES = 25_000;
export const MAX_PROMPT_DISPLAY = 64;

export interface LoopState {
	prompt: string;
	intervalMs: number;
	createdAt: number;
	/** When the next wait should start. Undefined while a tick is in flight. */
	nextFireAt?: number;
	iteration: number;
	promptSource: "args" | "loop.md" | "builtin";
	phase: "waiting" | "running";
}

export interface LoopEntryData {
	loop?: LoopState | null;
}

export interface LoopTickDetails {
	iteration: number;
	intervalMs: number;
	firedAt: number;
	prompt: string;
}

export const BUILTIN_PROMPT = `This is a scheduled /loop tick. Do not start new initiatives.

Work through the following, in order, then stop:

1. Continue any unfinished work already in this conversation.
2. Tend to the current branch's pull request if one exists: review comments, failed CI, merge conflicts.
3. If nothing is pending, do a small cleanup pass (obvious bugs, dead code, simplification).

Irreversible actions (push, delete, force-push, merge) only if this transcript already authorized them.
If there is nothing useful to do, say so in one short paragraph and wait for the next tick.`;

export interface StartLoopInput {
	prompt?: string;
	intervalMs?: number;
}

export interface CommandResult {
	ok: boolean;
	message: string;
	notify?: "info" | "warning" | "error";
}

export interface LoopController {
	getState(): LoopState | undefined;
	start(ctx: ExtensionContext, input: StartLoopInput): CommandResult;
	stop(ctx: ExtensionContext, message?: string): CommandResult;
	status(): CommandResult;
	fireNow(ctx: ExtensionContext): CommandResult;
	restore(ctx: ExtensionContext): void;
	shutdown(): void;
	onSettled(ctx: ExtensionContext): void;
	describe(): string;
}

export function createLoopController(pi: ExtensionAPI): LoopController {
	let loop: LoopState | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let ticker: ReturnType<typeof setInterval> | undefined;
	let lastCtx: ExtensionContext | undefined;

	function start(ctx: ExtensionContext, input: StartLoopInput): CommandResult {
		lastCtx = ctx;
		const resolved = resolvePrompt(input.prompt, ctx);
		if (!resolved.prompt) {
			return {
				ok: false,
				message: "No loop prompt. Pass one, or add loop.md / .pi/loop.md.",
				notify: "warning",
			};
		}

		const requested = input.intervalMs ?? DEFAULT_INTERVAL_MS;
		const { ms, clamped } = clampInterval(requested);
		const nextFireAt = Date.now() + ms;
		applyLoop(ctx, {
			prompt: resolved.prompt,
			intervalMs: ms,
			createdAt: Date.now(),
			nextFireAt,
			iteration: 0,
			promptSource: resolved.source,
			phase: "waiting",
		});

		const bits = [`Loop every ${formatDuration(ms)}`, `next ${formatClock(nextFireAt)}`];
		if (clamped) bits.push(`clamped from ${formatDuration(requested)}`);
		if (resolved.source === "loop.md") bits.push("prompt from loop.md");
		if (resolved.source === "builtin") bits.push("built-in maintenance prompt");
		return { ok: true, message: bits.join(" · "), notify: "info" };
	}

	function stop(ctx: ExtensionContext, message = "Stopped loop"): CommandResult {
		lastCtx = ctx;
		if (!loop) {
			return { ok: false, message: "No active loop", notify: "warning" };
		}
		loop = undefined;
		clearTimers();
		persist();
		updateChrome(ctx);
		return { ok: true, message, notify: "info" };
	}

	function status(): CommandResult {
		if (!loop) {
			return { ok: true, message: "No active loop", notify: "info" };
		}
		return { ok: true, message: describe(), notify: "info" };
	}

	function fireNow(ctx: ExtensionContext): CommandResult {
		lastCtx = ctx;
		if (!loop) {
			return { ok: false, message: "No active loop", notify: "warning" };
		}
		if (loop.phase === "running") {
			return {
				ok: false,
				message: "Loop tick already running; wait for it to finish",
				notify: "warning",
			};
		}
		loop.nextFireAt = Date.now();
		persist();
		void fireDue(ctx);
		return { ok: true, message: "Firing loop tick now", notify: "info" };
	}

	function restore(ctx: ExtensionContext) {
		lastCtx = ctx;
		const saved = lastSavedLoop(ctx);
		if (!saved) {
			loop = undefined;
			clearTimers();
			updateChrome(ctx);
			return;
		}
		if (Date.now() - saved.createdAt > MAX_INTERVAL_MS) {
			loop = undefined;
			persist();
			updateChrome(ctx);
			ctx.ui.notify("Saved loop expired (older than 7 days)", "warning");
			return;
		}

		loop = saved;
		if (loop.phase === "running" || loop.nextFireAt === undefined || loop.nextFireAt < Date.now()) {
			// A tick was in flight, or due, when the process died. Do not stack;
			// wait a full interval from resume.
			loop.phase = "waiting";
			loop.nextFireAt = Date.now() + loop.intervalMs;
		}
		armTimers(ctx);
		updateChrome(ctx);
		ctx.ui.notify(
			`Restored loop every ${formatDuration(loop.intervalMs)} · next ${formatClock(loop.nextFireAt ?? Date.now())}`,
			"info",
		);
	}

	function shutdown() {
		clearTimers();
		lastCtx = undefined;
	}

	function onSettled(ctx: ExtensionContext) {
		lastCtx = ctx;
		if (!loop) return;

		if (loop.phase === "running") {
			armNextWait(ctx);
			return;
		}

		if (isDue(loop)) {
			void fireDue(ctx);
		}
	}

	function describe(): string {
		if (!loop) return "No active loop";
		const preview = summarizePrompt(loop.prompt);
		if (loop.phase === "running" || loop.nextFireAt === undefined) {
			return `running tick #${loop.iteration} · ${preview}`;
		}
		const wait = Math.max(0, loop.nextFireAt - Date.now());
		return `every ${formatDuration(loop.intervalMs)} · next ${formatClock(loop.nextFireAt)} (${formatDuration(wait)}) · #${loop.iteration} · ${preview}`;
	}

	function applyLoop(ctx: ExtensionContext, next: LoopState) {
		loop = next;
		persist();
		armTimers(ctx);
		updateChrome(ctx);
	}

	function lastSavedLoop(ctx: ExtensionContext): LoopState | undefined {
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
			const data = entry.data as LoopEntryData | undefined;
			const saved = data?.loop;
			if (!saved || typeof saved.prompt !== "string" || !saved.prompt.trim()) return undefined;
			if (!Number.isFinite(saved.intervalMs) || saved.intervalMs <= 0) return undefined;
			if (saved.phase !== "waiting" && saved.phase !== "running") {
				saved.phase = saved.nextFireAt ? "waiting" : "running";
			}
			return saved;
		}
		return undefined;
	}

	function persist() {
		pi.appendEntry(ENTRY_TYPE, { loop: loop ?? null } satisfies LoopEntryData);
	}

	function armNextWait(ctx: ExtensionContext) {
		if (!loop) return;
		loop.phase = "waiting";
		loop.nextFireAt = Date.now() + loop.intervalMs;
		persist();
		armTimers(ctx);
		updateChrome(ctx);
	}

	function armTimers(ctx: ExtensionContext) {
		lastCtx = ctx;
		clearTimers();
		if (!loop || loop.phase !== "waiting" || loop.nextFireAt === undefined) return;

		const wait = Math.max(0, loop.nextFireAt - Date.now());
		timer = setTimeout(() => {
			void fireDue(lastCtx ?? ctx);
		}, wait);
		ticker = setInterval(() => {
			if (!loop || !lastCtx) return;
			updateChrome(lastCtx);
		}, 1000);
	}

	function clearTimers() {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
		if (ticker !== undefined) {
			clearInterval(ticker);
			ticker = undefined;
		}
	}

	async function fireDue(ctx: ExtensionContext) {
		if (!loop || loop.phase === "running") return;
		if (!isDue(loop)) {
			armTimers(ctx);
			return;
		}

		if (!ctx.isIdle()) {
			updateChrome(ctx);
			return;
		}

		const current = loop;
		current.phase = "running";
		current.iteration += 1;
		current.nextFireAt = undefined;
		const firedAt = Date.now();
		persist();
		clearTimers();
		updateChrome(ctx);

		const details: LoopTickDetails = {
			iteration: current.iteration,
			intervalMs: current.intervalMs,
			firedAt,
			prompt: current.prompt,
		};
		const header = `Scheduled /loop tick ${current.iteration} (${formatDuration(current.intervalMs)}).`;

		try {
			pi.sendMessage(
				{
					customType: CUSTOM_TYPE,
					content: `${header}\n\n${current.prompt}`,
					display: true,
					details,
				},
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		} catch (error) {
			ctx.ui.notify(`Loop tick failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			if (loop) armNextWait(ctx);
		}
	}

	function updateChrome(ctx: ExtensionContext) {
		if (!loop) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			ctx.ui.setWidget(STATUS_KEY, undefined);
			return;
		}

		if (loop.phase === "running" || loop.nextFireAt === undefined) {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", `loop:#${loop.iteration}`));
			ctx.ui.setWidget(STATUS_KEY, [
				`loop running tick #${loop.iteration} · next wait starts when this turn settles`,
				summarizePrompt(loop.prompt),
			]);
			return;
		}

		const wait = Math.max(0, loop.nextFireAt - Date.now());
		const label = isDue(loop) && !ctx.isIdle() ? "loop:wait" : `loop:${formatDuration(loop.intervalMs)}`;
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", label));
		ctx.ui.setWidget(STATUS_KEY, [
			`loop every ${formatDuration(loop.intervalMs)} · next ${formatClock(loop.nextFireAt)} (${formatDuration(wait)}) · last #${loop.iteration}`,
			summarizePrompt(loop.prompt),
		]);
	}

	return {
		getState: () => loop,
		start,
		stop,
		status,
		fireNow,
		restore,
		shutdown,
		onSettled,
		describe,
	};
}

export function resolvePrompt(
	explicit: string | undefined,
	ctx: ExtensionContext,
): { prompt?: string; source: LoopState["promptSource"] } {
	if (explicit?.trim()) {
		return { prompt: truncatePrompt(explicit.trim()), source: "args" };
	}

	const fromFile = readLoopMarkdown(ctx);
	if (fromFile) return { prompt: truncatePrompt(fromFile), source: "loop.md" };

	return { prompt: BUILTIN_PROMPT, source: "builtin" };
}

export function isDue(state: LoopState): boolean {
	return state.phase === "waiting" && state.nextFireAt !== undefined && Date.now() >= state.nextFireAt;
}

export function stringifyContent(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") return content;
	return content
		.filter((part) => part.type === "text" && part.text)
		.map((part) => part.text)
		.join("\n");
}

export function summarizePrompt(prompt: string): string {
	const first = prompt.split(/\r?\n/).find((line) => line.trim())?.trim() ?? prompt.trim();
	if (first.length <= MAX_PROMPT_DISPLAY) return first;
	return `${first.slice(0, MAX_PROMPT_DISPLAY - 1)}…`;
}

export function truncatePrompt(prompt: string): string {
	const bytes = Buffer.byteLength(prompt, "utf8");
	if (bytes <= MAX_PROMPT_BYTES) return prompt;
	return `${prompt.slice(0, MAX_PROMPT_BYTES)}\n\n[truncated at ${MAX_PROMPT_BYTES} bytes]`;
}

function readLoopMarkdown(ctx: ExtensionContext): string | undefined {
	const candidates: string[] = [];
	if (ctx.isProjectTrusted()) {
		candidates.push(join(ctx.cwd, CONFIG_DIR_NAME, "loop.md"));
		candidates.push(join(ctx.cwd, ".claude", "loop.md"));
	}
	candidates.push(join(getAgentDir(), "loop.md"));
	candidates.push(join(homedir(), ".claude", "loop.md"));

	for (const path of candidates) {
		if (!isFile(path)) continue;
		try {
			const text = readFileSync(path, "utf8").trim();
			if (text) return text;
		} catch {
			// keep looking
		}
	}
	return undefined;
}

function isFile(path: string): boolean {
	try {
		return existsSync(path) && statSync(path).isFile();
	} catch {
		return false;
	}
}
