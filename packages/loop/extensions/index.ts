/**
 * Session /loop for Pi.
 *
 * Re-runs a prompt in this session on an interval. One loop at a time.
 * The next tick is armed only after the current tick's turn has settled.
 * Users drive it with /loop; the model can start/stop via the loop tool.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Box, Text, type AutocompleteItem } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	createLoopController,
	CUSTOM_TYPE,
	stringifyContent,
	summarizePrompt,
	type CommandResult,
	type LoopTickDetails,
} from "./controller.ts";
import { formatDuration, parseIntervalToken, parseLoopArgs } from "./parse.ts";

const LoopToolParams = Type.Object({
	action: StringEnum(["start", "stop", "status", "now"] as const),
	interval: Type.Optional(
		Type.String({
			description: "How often to fire, like 5m, 30s, 1h. Default 5m. Required only for start if you want a non-default cadence.",
		}),
	),
	prompt: Type.Optional(
		Type.String({
			description: "What to do on each tick. Omit to use loop.md or the built-in maintenance prompt.",
		}),
	),
	reason: Type.Optional(
		Type.String({
			description: "Why you are starting or stopping. Required for start and stop.",
		}),
	),
});

export default function sessionLoop(pi: ExtensionAPI) {
	const controller = createLoopController(pi);

	pi.registerMessageRenderer<LoopTickDetails>(CUSTOM_TYPE, (message, { expanded, outputPad }, theme) => {
		const details = message.details;
		const iteration = details?.iteration ?? "?";
		const interval = details?.intervalMs ? formatDuration(details.intervalMs) : "?";
		const prompt = details?.prompt ?? stringifyContent(message.content);
		const title = theme.fg("accent", `loop #${iteration}`) + theme.fg("muted", ` · ${interval}`);
		const box = new Box(outputPad, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text(title, 0, 0));
		box.addChild(new Text(theme.fg("dim", expanded ? prompt : summarizePrompt(prompt)), 0, 0));
		return box;
	});

	pi.registerCommand("loop", {
		description: "Re-run a prompt on an interval in this session",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] => {
			const items: AutocompleteItem[] = [
				{ value: "stop", label: "stop", description: "Stop the active loop" },
				{ value: "status", label: "status", description: "Show the active loop" },
				{ value: "now", label: "now", description: "Fire as soon as the current tick settles" },
				{ value: "5m", label: "5m", description: "Every 5 minutes" },
				{ value: "15m", label: "15m", description: "Every 15 minutes" },
				{ value: "1h", label: "1h", description: "Every hour" },
			];
			const needle = prefix.trim().toLowerCase();
			if (!needle) return items;
			return items.filter(
				(item) => item.value.startsWith(needle) || item.label.toLowerCase().includes(needle),
			);
		},
		handler: async (args, ctx) => {
			let parsed;
			try {
				parsed = parseLoopArgs(args);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				return;
			}

			const result =
				parsed.action === "stop"
					? controller.stop(ctx)
					: parsed.action === "status"
						? controller.status()
						: parsed.action === "now"
							? controller.fireNow(ctx)
							: controller.start(ctx, { prompt: parsed.prompt, intervalMs: parsed.intervalMs });
			announce(ctx, result);
		},
	});

	pi.registerShortcut("ctrl+shift+l", {
		description: "Stop the session loop",
		handler: async (ctx) => {
			announce(ctx, controller.stop(ctx));
		},
	});

	pi.registerTool({
		name: "loop",
		label: "Loop",
		description:
			"Start, stop, inspect, or immediately fire this session's /loop. One loop at a time. The next tick waits until the current turn settles. Fires only while this Pi process stays open.",
		promptSnippet: "Start or stop a session /loop that re-runs a prompt on an interval",
		promptGuidelines: [
			"Use loop to start a session loop only when work is waiting on something outside this turn: a deploy, CI, a long build, a PR review, or a similar poll. Do not start a loop to keep chatting, retry a failed tool call, or replace asking the user.",
			"When starting a loop, pass a specific prompt that says what to check and what 'done' looks like. Prefer 2m or slower unless the user asked for faster. Say why in reason.",
			"Use loop with action=stop when the watched condition is met, the user asks to stop, the loop is burning turns with no new signal, or you are about to do irreversible work the loop should not race. Say why in reason.",
			"Do not start a second loop. There is only one; start replaces the current loop. Call loop with action=status before replacing an existing loop you did not create in this turn.",
			"Never tell the user to type /loop when you can call loop yourself. Never keep a forgotten loop running after the job is done.",
		],
		parameters: LoopToolParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if ((params.action === "start" || params.action === "stop") && !params.reason?.trim()) {
				return {
					content: [
						{
							type: "text",
							text: `Error: reason is required to ${params.action} a loop. Say what you are waiting on, or why it should stop.`,
						},
					],
					details: { ok: false, action: params.action },
				};
			}

			if (params.action === "status") {
				const result = controller.status();
				return toolResult(result, params.action);
			}

			if (params.action === "stop") {
				const result = controller.stop(ctx, `Stopped loop (${params.reason?.trim()})`);
				return toolResult(result, params.action);
			}

			if (params.action === "now") {
				const result = controller.fireNow(ctx);
				return toolResult(result, params.action);
			}

			let intervalMs: number | undefined;
			if (params.interval?.trim()) {
				const parsed = parseIntervalToken(params.interval.trim());
				if (parsed === undefined) {
					return {
						content: [
							{
								type: "text",
								text: `Error: invalid interval "${params.interval}". Use forms like 30s, 5m, or 1h.`,
							},
						],
						details: { ok: false, action: params.action },
					};
				}
				intervalMs = parsed;
			}

			const existing = controller.getState();
			const result = controller.start(ctx, { prompt: params.prompt, intervalMs });
			if (result.ok && existing) {
				result.message = `Replaced existing loop. ${result.message} Reason: ${params.reason?.trim()}`;
			} else if (result.ok) {
				result.message = `${result.message} Reason: ${params.reason?.trim()}`;
			}
			return toolResult(result, params.action);
		},
		renderCall(args, theme) {
			const bits = [theme.fg("toolTitle", theme.bold("loop ")), theme.fg("muted", args.action)];
			if (args.interval) bits.push(` ${theme.fg("accent", args.interval)}`);
			if (args.prompt) bits.push(` ${theme.fg("dim", summarizePrompt(args.prompt))}`);
			return new Text(bits.join(""), 0, 0);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		controller.restore(ctx);
	});

	pi.on("session_shutdown", async () => {
		controller.shutdown();
	});

	pi.on("agent_settled", async (_event, ctx) => {
		controller.onSettled(ctx);
	});
}

function announce(ctx: { ui: { notify: (message: string, level?: "info" | "warning" | "error") => void } }, result: CommandResult) {
	ctx.ui.notify(result.message, result.notify ?? (result.ok ? "info" : "warning"));
}

function toolResult(result: CommandResult, action: string) {
	return {
		content: [{ type: "text" as const, text: result.message }],
		details: { ok: result.ok, action },
	};
}
