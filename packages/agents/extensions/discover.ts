/**
 * Discover session-agent markdown files from package defaults,
 * user/project vendor folders, and Pi-local overrides.
 *
 * Same name: later (higher-precedence) files win. Unknown frontmatter is ignored.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export interface SessionAgent {
	name: string;
	description: string;
	/** Markdown body. This is the identity; appended to the system prompt. */
	prompt: string;
	filePath: string;
	source: AgentSource;
}

export type AgentSource =
	| "package"
	| "user-vendor"
	| "user-pi"
	| "project-vendor"
	| "project-pi";

const SKIP_NAMES = new Set(["readme.md"]);

export function packageAgentsDir(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	let current = here;
	for (let i = 0; i < 6; i++) {
		const pkgPath = join(current, "package.json");
		if (existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string };
				if (pkg.name === "pi-session-agents") {
					return join(current, "agents");
				}
			} catch {
				// keep walking
			}
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return join(here, "..", "agents");
}

export function discoverAgents(cwd: string, options?: { includeProject?: boolean }): SessionAgent[] {
	const includeProject = options?.includeProject ?? true;
	const byName = new Map<string, SessionAgent>();

	function absorb(agents: SessionAgent[]) {
		for (const agent of agents) {
			byName.set(agent.name, agent);
		}
	}

	// Lowest → highest. Last write wins.
	absorb(loadAgentsFromDir(packageAgentsDir(), "package"));
	absorb(loadUserVendorAgents());
	absorb(loadAgentsFromDir(join(getAgentDir(), "agents"), "user-pi"));

	if (includeProject) {
		const ancestors = projectAncestorDirs(cwd);
		for (const dir of ancestors) {
			absorb(loadProjectVendorAgents(dir));
		}
		for (const dir of ancestors) {
			absorb(loadAgentsFromDir(join(dir, CONFIG_DIR_NAME, "agents"), "project-pi"));
		}
	}

	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findAgent(agents: SessionAgent[], name: string): SessionAgent | undefined {
	const needle = name.trim().toLowerCase();
	return agents.find((agent) => agent.name.toLowerCase() === needle);
}

function loadUserVendorAgents(): SessionAgent[] {
	const home = homedir();
	const dirs = [
		join(home, ".agents", "agents"),
		join(home, ".copilot", "agents"),
		join(home, ".config", "opencode", "agent"),
		join(home, ".config", "opencode", "agents"),
		join(home, ".claude", "agents"),
	];
	return dirs.flatMap((dir) => loadAgentsFromDir(dir, "user-vendor"));
}

function loadProjectVendorAgents(dir: string): SessionAgent[] {
	const dirs = [
		join(dir, ".agents", "agents"),
		join(dir, ".github", "agents"),
		join(dir, ".opencode", "agent"),
		join(dir, ".opencode", "agents"),
		join(dir, ".claude", "agents"),
	];
	return dirs.flatMap((folder) => loadAgentsFromDir(folder, "project-vendor"));
}

/**
 * Ancestors from the git root (or cwd if not in a repo) down to cwd.
 * Farther directories are first so closer files override.
 */
function projectAncestorDirs(cwd: string): string[] {
	const gitRoot = findGitRoot(cwd);
	const stop = gitRoot ?? cwd;
	const dirs: string[] = [];
	let current = cwd;

	while (true) {
		dirs.push(current);
		if (current === stop) break;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}

	return dirs.reverse();
}

function findGitRoot(start: string): string | null {
	let current = start;
	while (true) {
		if (existsSync(join(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

function loadAgentsFromDir(dir: string, source: AgentSource): SessionAgent[] {
	if (!isDirectory(dir)) return [];

	const agents: SessionAgent[] = [];
	for (const filePath of listMarkdownFiles(dir)) {
		const agent = readAgentFile(filePath, source);
		if (agent) agents.push(agent);
	}
	return agents;
}

function listMarkdownFiles(dir: string): string[] {
	const files: string[] = [];
	let entries: ReturnType<typeof readdirSync>;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return files;
	}

	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.name.startsWith(".")) continue;

		if (entry.isDirectory()) {
			files.push(...listMarkdownFiles(full));
			continue;
		}

		if (!entry.isFile() && !entry.isSymbolicLink()) continue;
		if (!entry.name.endsWith(".md")) continue;
		if (SKIP_NAMES.has(entry.name.toLowerCase())) continue;
		files.push(full);
	}

	return files;
}

function readAgentFile(filePath: string, source: AgentSource): SessionAgent | undefined {
	let content: string;
	try {
		content = readFileSync(filePath, "utf-8");
	} catch {
		return undefined;
	}

	const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
	const prompt = body.trim();
	if (!prompt) return undefined;

	const name = resolveName(frontmatter.name, filePath);
	if (!name) return undefined;

	return {
		name,
		description: resolveDescription(frontmatter.description, prompt),
		prompt,
		filePath,
		source,
	};
}

function resolveName(raw: unknown, filePath: string): string | undefined {
	if (typeof raw === "string" && raw.trim()) {
		return raw.trim();
	}

	const file = basename(filePath);
	const withoutAgent = file.endsWith(".agent.md") ? file.slice(0, -".agent.md".length) : undefined;
	const withoutMd = file.endsWith(".md") ? file.slice(0, -".md".length) : file;
	const name = (withoutAgent ?? withoutMd).trim();
	return name || undefined;
}

function resolveDescription(raw: unknown, prompt: string): string {
	if (typeof raw === "string" && raw.trim()) return raw.trim();
	const firstLine = prompt.split(/\r?\n/).find((line) => line.trim());
	return firstLine?.trim() ?? "";
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}
