/**
 * Session /goal for Pi.
 *
 * Sets a completion condition and keeps this session working toward it.
 * After each settled turn a small model judges the transcript. Users drive
 * it with /goal; the model can start/clear via the goal tool.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Box, Text, type AutocompleteItem } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	createGoalController,
	CUSTOM_TYPE,
	stringifyContent,
	type CommandResult,
	type GoalEventDetails,
} from "./controller.ts";
import { parseGoalArgs, summarizeText } from "./parse.ts";

const GoalToolParams = Type.Object({
	action: StringEnum(["start", "clear", "status"] as const),
	condition: Type.Optional(
		Type.String({
			description: "The completion condition. Required for start. Write a measurable end state the transcript can prove.",
		}),
	),
	reason: Type.Optional(
		Type.String({
			description: "Why you are starting or clearing. Required for start and clear.",
		}),
	),
});

export default function sessionGoal(pi: ExtensionAPI) {
	const controller = createGoalController(pi);

	pi.registerMessageRenderer<GoalEventDetails>(CUSTOM_TYPE, (message, { expanded, outputPad }, theme) => {
		const details = message.details;
		const kind = details?.kind ?? "continue";
		const color = kind === "achieved" ? "success" : kind === "failed" || kind === "stuck" ? "warning" : "accent";
		const label = kind === "achieved" ? "goal met" : kind === "failed" ? "goal failed" : kind === "stuck" ? "goal paused" : "goal";
		const reason = details?.reason ?? stringifyContent(message.content);
		const title = theme.fg(color, label) + theme.fg("muted", details?.evaluatedTurns ? ` · ${details.evaluatedTurns} turns` : "");
		const box = new Box(outputPad, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text(title, 0, 0));
		box.addChild(new Text(theme.fg("dim", expanded ? reason : summarizeText(reason)), 0, 0));
		return box;
	});

	pi.registerCommand("goal", {
		description: "Keep working toward a completion condition in this session",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] => {
			const items: AutocompleteItem[] = [
				{ value: "clear", label: "clear", description: "Clear the active goal" },
				{ value: "status", label: "status", description: "Show the current goal" },
			];
			const needle = prefix.trim().toLowerCase();
			if (!needle) return items;
			return items.filter(
				(item) => item.value.startsWith(needle) || item.label.toLowerCase().includes(needle),
			);
		},
		handler: async (args, ctx) => {
			const parsed = parseGoalArgs(args);
			const result =
				parsed.action === "clear"
					? controller.clear(ctx)
					: parsed.action === "status"
						? controller.status()
						: controller.start(ctx, { condition: parsed.condition ?? "" });
			announce(ctx, result);
		},
	});

	pi.registerShortcut("ctrl+shift+g", {
		description: "Clear the session goal",
		handler: async (ctx) => {
			announce(ctx, controller.clear(ctx));
		},
	});

	pi.registerTool({
		name: "goal",
		label: "Goal",
		description:
			"Start, clear, or inspect this session's /goal. One goal at a time. After each settled turn a small model judges the condition from the transcript. Fires only while this Pi process stays open.",
		promptSnippet: "Start or clear a session /goal that keeps working until a condition is met",
		promptGuidelines: [
			"Use goal to start a session goal only for substantial work with a verifiable end state: tests pass, a build exits 0, a queue is empty. Do not start a goal to keep chatting, retry a failed tool call, or replace asking the user.",
			"When starting a goal, pass one measurable condition and how to prove it in the transcript, such as \"npm test exits 0\". Say why in reason.",
			"Use goal with action=clear when the user asks to stop, the condition is the wrong target, or you are about to do irreversible work the goal should not race. Say why in reason.",
			"Do not start a second goal. There is only one; start replaces the current goal. Call goal with action=status before replacing a goal you did not create in this turn.",
			"Never tell the user to type /goal when you can call goal yourself. Never keep a forgotten goal running after the job is done.",
			"Prefer goal over loop when the next turn should start as soon as this one finishes. Prefer loop when waiting on something outside this process.",
		],
		parameters: GoalToolParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if ((params.action === "start" || params.action === "clear") && !params.reason?.trim()) {
				return {
					content: [
						{
							type: "text",
							text: `Error: reason is required to ${params.action} a goal. Say what done looks like, or why it should stop.`,
						},
					],
					details: { ok: false, action: params.action },
				};
			}

			if (params.action === "status") {
				return toolResult(controller.status(), params.action);
			}

			if (params.action === "clear") {
				return toolResult(controller.clear(ctx, `Goal cleared (${params.reason?.trim()})`), params.action);
			}

			const condition = params.condition?.trim();
			if (!condition) {
				return {
					content: [{ type: "text", text: "Error: condition is required to start a goal." }],
					details: { ok: false, action: params.action },
				};
			}

			const result = controller.start(ctx, { condition });
			if (result.ok) {
				result.message = `${result.message} Reason: ${params.reason?.trim()}`;
			}
			return toolResult(result, params.action);
		},
		renderCall(args, theme) {
			const bits = [theme.fg("toolTitle", theme.bold("goal ")), theme.fg("muted", args.action)];
			if (args.condition) bits.push(` ${theme.fg("dim", summarizeText(args.condition))}`);
			return new Text(bits.join(""), 0, 0);
		},
	});

	pi.on("before_agent_start", async (event) => {
		const state = controller.getState();
		if (!state || (state.phase !== "active" && state.phase !== "evaluating")) return undefined;
		const reason = state.lastReason ? `\nLatest evaluator reason: ${state.lastReason}` : "";
		return {
			systemPrompt: `${event.systemPrompt}\n\n# Session goal\n\nKeep working until this condition is demonstrably true in the transcript. Do not stop to ask whether to continue.\n\n${state.condition}${reason}\n`,
		};
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
