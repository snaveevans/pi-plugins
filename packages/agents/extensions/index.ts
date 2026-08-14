/**
 * Session agents for Pi.
 *
 * `/agent` (or Ctrl+Shift+A) puts this session into a named agent.
 * The markdown body is appended to the system prompt every turn, so
 * compaction cannot eat the identity. State is stored on the session
 * and restored on resume.
 *
 * This does not spawn a subprocess. The main session is the agent.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { discoverAgents, findAgent, type SessionAgent } from "./discover.ts";

const ENTRY_TYPE = "session-agent";
const STATUS_KEY = "session-agent";
const NONE = "none";

interface AgentStateData {
	name?: string | null;
}

export default function sessionAgents(pi: ExtensionAPI) {
	let activeName: string | undefined;

	pi.registerFlag("agent", {
		description: "Session agent to activate (name, or 'none')",
		type: "string",
	});

	pi.registerCommand("agent", {
		description: "Switch this session's agent (persona). Does not spawn a subagent.",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] => {
			const agents = currentAgents();
			const items: AutocompleteItem[] = [
				{ value: NONE, label: NONE, description: "Clear the session agent" },
				...agents.map((agent) => ({
					value: agent.name,
					label: agent.name,
					description: agent.description,
				})),
			];
			const needle = prefix.trim().toLowerCase();
			if (!needle) return items;
			return items.filter(
				(item) =>
					item.value.toLowerCase().startsWith(needle) ||
					item.label.toLowerCase().includes(needle),
			);
		},
		handler: async (args, ctx) => {
			const agents = currentAgents(ctx);
			const raw = args?.trim();

			if (!raw) {
				await pickAgent(agents, ctx);
				return;
			}

			if (isNone(raw)) {
				clearAgent(ctx);
				return;
			}

			const agent = findAgent(agents, raw);
			if (!agent) {
				const available = agents.map((item) => item.name).join(", ") || "(none discovered)";
				ctx.ui.notify(`Unknown agent "${raw}". Available: ${available}`, "error");
				return;
			}

			activateAgent(agent, ctx);
		},
	});

	pi.registerShortcut("ctrl+shift+a", {
		description: "Cycle session agent",
		handler: async (ctx) => {
			cycleAgent(currentAgents(ctx), ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const agents = currentAgents(ctx);
		const flag = pi.getFlag("agent");

		if (typeof flag === "string" && flag.trim()) {
			if (isNone(flag)) {
				clearAgent(ctx, { quiet: true });
				return;
			}
			const agent = findAgent(agents, flag);
			if (agent) {
				activateAgent(agent, ctx, { persist: true, quiet: true });
				ctx.ui.notify(`Agent "${agent.name}" activated`, "info");
			} else {
				ctx.ui.notify(`Unknown --agent "${flag.trim()}"`, "warning");
				restoreFromSession(agents, ctx);
			}
			return;
		}

		restoreFromSession(agents, ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const agent = activeAgent(currentAgents(ctx));
		if (!agent) return undefined;

		return {
			systemPrompt: `${event.systemPrompt}

# Session agent: ${agent.name}

${agent.prompt}
`,
		};
	});

	function currentAgents(ctx?: ExtensionContext): SessionAgent[] {
		const cwd = ctx?.cwd ?? process.cwd();
		const includeProject = ctx ? ctx.isProjectTrusted() : true;
		return discoverAgents(cwd, { includeProject });
	}

	function activeAgent(agents: SessionAgent[]): SessionAgent | undefined {
		if (!activeName) return undefined;
		return findAgent(agents, activeName);
	}

	function activateAgent(
		agent: SessionAgent,
		ctx: ExtensionContext,
		options?: { persist?: boolean; quiet?: boolean },
	) {
		activeName = agent.name;
		if (options?.persist !== false) persist(agent.name);
		updateStatus(ctx);
		if (!options?.quiet) {
			ctx.ui.notify(`Agent "${agent.name}" activated`, "info");
		}
	}

	function clearAgent(ctx: ExtensionContext, options?: { quiet?: boolean }) {
		activeName = undefined;
		persist(null);
		updateStatus(ctx);
		if (!options?.quiet) {
			ctx.ui.notify("Session agent cleared", "info");
		}
	}

	function restoreFromSession(agents: SessionAgent[], ctx: ExtensionContext) {
		const saved = lastSavedName(ctx);
		if (!saved) {
			updateStatus(ctx);
			return;
		}
		const agent = findAgent(agents, saved);
		if (!agent) {
			activeName = undefined;
			updateStatus(ctx);
			ctx.ui.notify(`Saved agent "${saved}" is no longer available`, "warning");
			return;
		}
		activateAgent(agent, ctx, { persist: false, quiet: true });
	}

	function lastSavedName(ctx: ExtensionContext): string | undefined {
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
			const data = entry.data as AgentStateData | undefined;
			const name = data?.name;
			if (typeof name === "string" && name.trim() && !isNone(name)) return name.trim();
			return undefined;
		}
		return undefined;
	}

	function persist(name: string | null) {
		pi.appendEntry(ENTRY_TYPE, { name });
	}

	function updateStatus(ctx: ExtensionContext) {
		if (activeName) {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", `agent:${activeName}`));
		} else {
			ctx.ui.setStatus(STATUS_KEY, undefined);
		}
	}

	async function pickAgent(agents: SessionAgent[], ctx: ExtensionContext) {
		if (agents.length === 0) {
			ctx.ui.notify("No agents discovered. Add a markdown file under agents/. See docs/agent-format.md.", "warning");
			return;
		}

		const options = [
			...agents.map((agent) => (agent.name === activeName ? `${agent.name} (active)` : agent.name)),
			"(none)",
		];
		const choice = await ctx.ui.select("Session agent", options);
		if (!choice) return;
		if (choice === "(none)" || choice.startsWith("(none)")) {
			clearAgent(ctx);
			return;
		}

		const name = choice.replace(/ \(active\)$/, "");
		const agent = findAgent(agents, name);
		if (!agent) {
			ctx.ui.notify(`Unknown agent "${name}"`, "error");
			return;
		}
		activateAgent(agent, ctx);
	}

	function cycleAgent(agents: SessionAgent[], ctx: ExtensionContext) {
		if (agents.length === 0) {
			ctx.ui.notify("No agents discovered", "warning");
			return;
		}

		const names = [NONE, ...agents.map((agent) => agent.name)];
		const current = activeName ?? NONE;
		const index = names.indexOf(current);
		const next = names[(index === -1 ? 0 : index + 1) % names.length];

		if (isNone(next)) {
			clearAgent(ctx);
			return;
		}

		const agent = findAgent(agents, next);
		if (agent) activateAgent(agent, ctx);
	}
}

function isNone(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	return normalized === NONE || normalized === "off" || normalized === "clear";
}
