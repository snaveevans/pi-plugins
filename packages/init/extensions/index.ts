/**
 * Session /init for Pi.
 *
 * Creates or audits AGENTS.md for the current repo. The extension gathers
 * grounded repo facts deterministically, then hands off to the session model
 * with a best-practices-grounded prompt (mirrors /loop and /goal: the
 * extension sets up the turn, the session does the work).
 *
 * No tool, no hotkey, no persisted state — /init is a one-shot.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Box, Text, type AutocompleteItem } from "@earendil-works/pi-tui";
import { findGitRoot, inspectProject, type ProjectFacts } from "./inspect.ts";
import { buildAuditPrompt, buildCreatePrompt, summarizeCondition } from "./prompt.ts";
import { parseInitArgs, type InitAction } from "./parse.ts";

export const CUSTOM_TYPE = "session-init";

export interface InitEventDetails {
	kind: "create" | "audit";
	targetPath: string;
	summary: string;
}

export default function sessionInit(pi: ExtensionAPI) {
	pi.registerMessageRenderer<InitEventDetails>(CUSTOM_TYPE, (message, { expanded, outputPad }, theme) => {
		const details = message.details;
		const kind = details?.kind ?? "create";
		const color = kind === "audit" ? "warning" : "accent";
		const title = theme.fg(color, `init · ${kind}`) + theme.fg("muted", details?.targetPath ? ` · ${details.targetPath}` : "");
		const summary = details?.summary ?? "";
		const box = new Box(outputPad, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text(title, 0, 0));
		box.addChild(new Text(theme.fg("dim", expanded ? (message.content as string) : summary), 0, 0));
		return box;
	});

	pi.registerCommand("init", {
		description: "Create or audit AGENTS.md for this repo",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] => {
			const items: AutocompleteItem[] = [
				{ value: "audit", label: "audit", description: "Audit and fix the existing AGENTS.md" },
				{ value: "create", label: "create", description: "Create AGENTS.md (only if missing)" },
			];
			const needle = prefix.trim().toLowerCase();
			if (!needle) return items;
			return items.filter((item) => item.value.startsWith(needle) || item.label.toLowerCase().includes(needle));
		},
		handler: async (args, ctx) => {
			await runInit(pi, ctx, parseInitArgs(args));
		},
	});
}

async function runInit(pi: ExtensionAPI, ctx: ExtensionCommandContext, action: InitAction) {
	const cwd = ctx.cwd;
	const root = findGitRoot(cwd) ?? cwd;
	const facts = inspectProject(root, cwd);
	const targetPath = facts.agentsMd.path;
	const exists = facts.agentsMd.exists;

	let mode: "create" | "audit";
	if (action === "create") {
		if (exists) {
			ctx.ui.notify(`AGENTS.md already exists at ${targetPath}. Use /init audit (or /init with no args).`, "warning");
			return;
		}
		mode = "create";
	} else if (action === "audit") {
		if (!exists) {
			ctx.ui.notify(`No AGENTS.md at ${targetPath} to audit. Use /init create (or /init with no args).`, "warning");
			return;
		}
		mode = "audit";
	} else {
		mode = exists ? "audit" : "create";
	}

	ctx.ui.notify(`${mode === "create" ? "Creating" : "Auditing"} AGENTS.md — gathering repo context…`, "info");

	const prompt =
		mode === "create"
			? buildCreatePrompt(facts)
			: buildAuditPrompt(facts, facts.agentsMd.content ?? "");

	const summary = summarizeCondition(facts, mode);
	const details: InitEventDetails = { kind: mode, targetPath, summary };

	try {
		pi.sendMessage(
			{
				customType: CUSTOM_TYPE,
				content: prompt,
				display: true,
				details,
			},
			{ triggerTurn: true, deliverAs: "followUp" },
		);
	} catch (error) {
		ctx.ui.notify(`Failed to start /init: ${error instanceof Error ? error.message : String(error)}`, "error");
	}
}

// Re-exports for tests / external use.
export { findGitRoot, inspectProject, type ProjectFacts };
