import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Pi's default 272k catalog window remains unchanged. This only adjusts the
// active session's compaction threshold; the upstream endpoint must allow 1m.
const WINDOWS = { "272k": 272000, "1m": 1050000 } as const;
type Selection = keyof typeof WINDOWS;
const ENTRY_TYPE = "openai-context-window";

function catalogModel(ctx: ExtensionContext) {
	const model = ctx.model;
	if (!model || (model.provider !== "openai" && model.provider !== "openai-codex")) return undefined;
	const original = ctx.modelRegistry.find(model.provider, model.id);
	// Do not enlarge models with a different published limit (e.g. Codex Spark).
	return original?.contextWindow === WINDOWS["272k"] ? original : undefined;
}

function selectionFromEntry(data: unknown): Selection | undefined {
	if (!data || typeof data !== "object" || !("selection" in data)) return undefined;
	const selection = data.selection;
	return selection === "1m" || selection === "272k" ? selection : undefined;
}

export default function (pi: ExtensionAPI) {
	let selection: Selection = "272k";

	async function apply(ctx: ExtensionContext): Promise<boolean> {
		const original = catalogModel(ctx);
		if (!original) return false;
		if (ctx.model?.contextWindow === WINDOWS[selection]) return true;
		return pi.setModel({ ...original, contextWindow: WINDOWS[selection] });
	}

	pi.on("session_start", async (_event, ctx) => {
		selection = "272k";
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
			selection = selectionFromEntry(entry.data) ?? selection;
		}
		await apply(ctx);
	});

	pi.on("model_select", async (event, ctx) => {
		if (selection === "1m" && event.model === ctx.model) await apply(ctx);
	});

	pi.registerCommand("openai-context", {
		description: "Choose the OpenAI context window: 272k or 1m (session only)",
		getArgumentCompletions: (prefix) => Object.keys(WINDOWS)
			.filter((value) => value.startsWith(prefix))
			.map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			const choice = args.trim().toLowerCase();
			if (!choice) {
				const window = catalogModel(ctx) ? `${ctx.model?.contextWindow} tokens` : "not available for this model";
				ctx.ui.notify(`OpenAI context: ${window}. Use /openai-context 272k or /openai-context 1m.`, "info");
				return;
			}
			if (choice !== "272k" && choice !== "1m") {
				ctx.ui.notify("Choose 272k or 1m: /openai-context 272k|1m", "error");
				return;
			}
			if (!catalogModel(ctx)) {
				ctx.ui.notify("This OpenAI model does not have a 272k catalog window; no change made.", "error");
				return;
			}
			const previous = selection;
			selection = choice;
			try {
				if (!await apply(ctx)) {
					selection = previous;
					ctx.ui.notify("OpenAI authentication unavailable; no change made.", "error");
					return;
				}
			} catch (error) {
				selection = previous;
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Could not switch context: ${message}`, "error");
				return;
			}
			pi.appendEntry(ENTRY_TYPE, { selection });
			ctx.ui.notify(`OpenAI context set to ${choice} (${WINDOWS[choice]} tokens) for this session.`, "info");
		},
	});
}
