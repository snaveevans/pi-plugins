/**
 * Repo fact-gathering for /init.
 *
 * Deterministically inspects the working repo so the session model can author
 * or audit AGENTS.md from grounded facts instead of rediscovering them (and
 * instead of inventing commands). Pure detectors are exported for testing.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface AgentFileRef {
	kind: string;
	path: string;
}

export interface PackageJsonFacts {
	name?: string;
	version?: string;
	description?: string;
	scripts: Record<string, string>;
	packageManager?: string;
	engines?: Record<string, string>;
	workspaces?: string[];
	dependencies?: string[];
	devDependencies?: string[];
}

export interface AgentsMdFact {
	path: string;
	exists: boolean;
	content?: string;
}

export interface ProjectFacts {
	root: string;
	cwd: string;
	hasGit: boolean;
	agentsMd: AgentsMdFact;
	ecosystems: string[];
	packageManager?: string;
	packageJson?: PackageJsonFacts;
	testFrameworks: string[];
	lintTools: string[];
	ci: string[];
	readme: boolean;
	gitignore: boolean;
	monorepo: boolean;
	otherAgentFiles: AgentFileRef[];
	topDirs: string[];
}

/** Max bytes of an existing AGENTS.md to feed into an audit prompt. */
export const MAX_EXISTING_BYTES = 64_000;

function lowerSet(xs: string[]): Set<string> {
	return new Set(xs.map((x) => x.toLowerCase()));
}

function anyStartsWith(names: Set<string>, prefix: string): boolean {
	for (const n of names) if (n.startsWith(prefix)) return true;
	return false;
}

export function detectPackageManager(entries: string[], packageManager?: string): string | undefined {
	if (packageManager) {
		const match = packageManager.match(/^([^@\s]+)@/);
		if (match) return match[1];
		return packageManager;
	}
	const names = lowerSet(entries);
	if (names.has("pnpm-lock.yaml")) return "pnpm";
	if (names.has("bun.lockb") || names.has("bun.lock")) return "bun";
	if (names.has("yarn.lock")) return "yarn";
	if (names.has("deno.lock")) return "deno";
	if (names.has("package-lock.json") || names.has("package.json")) return "npm";
	return undefined;
}

export function detectEcosystems(entries: string[]): string[] {
	const names = lowerSet(entries);
	const out: string[] = [];
	if (names.has("deno.json") || names.has("deno.jsonc")) {
		out.push("deno");
	} else if (names.has("package.json")) {
		out.push("node");
	}
	if (["pyproject.toml", "requirements.txt", "setup.py", "pipfile", "uv.lock", "poetry.lock", "setup.cfg"].some((f) => names.has(f))) {
		out.push("python");
	}
	if (names.has("cargo.toml")) out.push("rust");
	if (names.has("go.mod")) out.push("go");
	if (names.has("gemfile")) out.push("ruby");
	if (names.has("pom.xml") || names.has("build.gradle") || names.has("build.gradle.kts")) out.push("jvm");
	if (names.has("composer.json")) out.push("php");
	if (names.has("package.swift")) out.push("swift");
	if (entries.some((e) => /\.csproj$|\.fsproj$|\.sln$/.test(e.toLowerCase()))) out.push("dotnet");
	return out;
}

const JEST_CONFIGS = [
	"jest.config.js", "jest.config.ts", "jest.config.cjs", "jest.config.mjs", "jest.config.json",
];

export function detectTestFrameworks(entries: string[], deps: string[] = []): string[] {
	const names = lowerSet(entries);
	const depSet = lowerSet(deps);
	const out: string[] = [];
	if (JEST_CONFIGS.some((f) => names.has(f)) || depSet.has("jest")) out.push("jest");
	if (names.has("vitest.config.ts") || names.has("vitest.config.js") || names.has("vitest.config.mjs") || names.has("vitest.config.cjs") || depSet.has("vitest")) out.push("vitest");
	if (names.has("pytest.ini") || names.has("conftest.py") || names.has("tox.ini")) out.push("pytest");
	if (names.has("playwright.config.ts") || names.has("playwright.config.js") || depSet.has("@playwright/test")) out.push("playwright");
	if (names.has("cypress.config.ts") || names.has("cypress.config.js") || depSet.has("cypress")) out.push("cypress");
	if (names.has("cargo.toml")) out.push("cargo-test");
	if (names.has("go.mod")) out.push("go-test");
	return out;
}

export function detectLintTools(entries: string[]): string[] {
	const names = lowerSet(entries);
	const out: string[] = [];
	if (anyStartsWith(names, ".eslintrc") || names.has("eslint.config.js") || names.has("eslint.config.mjs") || names.has("eslint.config.ts") || names.has("eslint.config.cjs")) out.push("eslint");
	if (names.has("biome.json") || names.has("biome.jsonc")) out.push("biome");
	if (anyStartsWith(names, ".prettierrc") || names.has("prettier.config.js") || names.has("prettier.config.mjs") || names.has("prettier.config.cjs")) out.push("prettier");
	if (names.has("ruff.toml") || names.has(".ruff.toml")) out.push("ruff");
	if (names.has(".flake8") || names.has("setup.cfg")) out.push("flake8");
	if (names.has(".golangci.yml") || names.has(".golangci.yaml") || names.has(".golangci.toml")) out.push("golangci-lint");
	if (names.has(".rubocop.yml") || names.has("rubocop.yml")) out.push("rubocop");
	if (names.has(".clippy.toml") || names.has("clippy.toml")) out.push("clippy");
	if (names.has("deno.json") || names.has("deno.jsonc")) out.push("deno-lint");
	return out;
}

export function detectCi(entries: string[], hasGithubWorkflows: boolean): string[] {
	const names = lowerSet(entries);
	const out: string[] = [];
	if (hasGithubWorkflows) out.push("github-actions");
	if (names.has(".gitlab-ci.yml")) out.push("gitlab-ci");
	if (names.has(".circleci")) out.push("circleci");
	if (names.has("azure-pipelines.yml")) out.push("azure-pipelines");
	if (names.has("jenkinsfile")) out.push("jenkins");
	if (names.has(".buildkite") || names.has("buildkite.yml") || names.has("buildkite.yaml")) out.push("buildkite");
	return out;
}

/** Root-level other-agent instruction files. (.github/copilot-instructions.md is
 *  checked separately in inspectProject, since it lives in a subdirectory.) */
export function detectOtherAgentFiles(entries: string[]): AgentFileRef[] {
	const names = lowerSet(entries);
	const out: AgentFileRef[] = [];
	if (names.has("claude.md")) out.push({ kind: "claude", path: "CLAUDE.md" });
	if (names.has("gemini.md")) out.push({ kind: "gemini", path: "GEMINI.md" });
	if (names.has(".cursorrules")) out.push({ kind: "cursor", path: ".cursorrules" });
	if (names.has("copilot-instructions.md")) out.push({ kind: "copilot", path: "copilot-instructions.md" });
	return out;
}

export function detectMonorepo(entries: string[], packageJson?: PackageJsonFacts): boolean {
	const names = lowerSet(entries);
	if (names.has("pnpm-workspace.yaml")) return true;
	if (names.has("lerna.json") || names.has("nx.json") || names.has("turbo.json")) return true;
	if (packageJson?.workspaces && packageJson.workspaces.length > 0) return true;
	return false;
}

/** Walk up from `start` to the nearest directory containing `.git`. */
export function findGitRoot(start: string): string | null {
	let current = start;
	while (true) {
		if (existsSync(join(current, ".git"))) return current;
		const parent = join(current, "..");
		if (parent === current) return null;
		current = parent;
	}
}

export function inspectProject(root: string, cwd: string): ProjectFacts {
	const rawEntries = listDir(root);
	const entryNames = rawEntries.map((e) => e.name);
	const names = lowerSet(entryNames);

	const agentsMdPath = join(root, "AGENTS.md");
	const agentsMdStat = existsSync(agentsMdPath) ? safeStat(agentsMdPath) : undefined;
	let agentsMdContent: string | undefined;
	if (agentsMdStat?.isFile()) {
		try {
			const buf = readFileSync(agentsMdPath);
			agentsMdContent = buf.subarray(0, MAX_EXISTING_BYTES).toString("utf8");
			if (buf.length > MAX_EXISTING_BYTES) agentsMdContent += "\n\n[truncated]";
		} catch {
			// leave undefined
		}
	}

	const packageJson = readPackageJson(join(root, "package.json"));
	const allDeps = [...(packageJson?.dependencies ?? []), ...(packageJson?.devDependencies ?? [])];

	const hasGithubDir = rawEntries.some((e) => e.name.toLowerCase() === ".github" && e.isDirectory);
	const githubWorkflows = hasGithubDir ? listDir(join(root, ".github", "workflows")) : [];
	const hasGithubWorkflows = githubWorkflows.some((e) => /\.(ya?ml)$/i.test(e.name));

	const otherAgentFiles = detectOtherAgentFiles(entryNames);
	if (hasGithubDir && existsSync(join(root, ".github", "copilot-instructions.md"))) {
		otherAgentFiles.push({ kind: "copilot", path: ".github/copilot-instructions.md" });
	}
	if (hasGithubDir && existsSync(join(root, ".github", "instructions"))) {
		otherAgentFiles.push({ kind: "copilot", path: ".github/instructions/*.instructions.md" });
	}

	return {
		root,
		cwd,
		hasGit: existsSync(join(root, ".git")),
		agentsMd: { path: agentsMdPath, exists: Boolean(agentsMdStat?.isFile()), content: agentsMdContent },
		ecosystems: detectEcosystems(entryNames),
		packageManager: detectPackageManager(entryNames, packageJson?.packageManager),
		packageJson,
		testFrameworks: detectTestFrameworks(entryNames, allDeps),
		lintTools: detectLintTools(entryNames),
		ci: detectCi(entryNames, hasGithubWorkflows),
		readme: names.has("readme.md") || names.has("readme") || names.has("readme.txt"),
		gitignore: names.has(".gitignore"),
		monorepo: detectMonorepo(entryNames, packageJson),
		otherAgentFiles,
		topDirs: rawEntries.filter((e) => e.isDirectory && !e.name.startsWith(".")).map((e) => e.name).sort(),
	};
}

function readPackageJson(path: string): PackageJsonFacts | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		const workspaces = Array.isArray(raw.workspaces)
			? (raw.workspaces as string[])
			: raw.workspaces && typeof raw.workspaces === "object" && Array.isArray((raw.workspaces as { packages?: unknown }).packages)
				? ((raw.workspaces as { packages: string[] }).packages)
				: undefined;
		return {
			name: asString(raw.name),
			version: asString(raw.version),
			description: asString(raw.description),
			scripts: asStringMap(raw.scripts),
			packageManager: asString(raw.packageManager),
			engines: asStringMap(raw.engines),
			workspaces,
			dependencies: Object.keys((raw.dependencies as Record<string, unknown> | undefined) ?? {}),
			devDependencies: Object.keys((raw.devDependencies as Record<string, unknown> | undefined) ?? {}),
		};
	} catch {
		return undefined;
	}
}

interface DirEntry {
	name: string;
	isDirectory: boolean;
	isFile: boolean;
}

function listDir(dir: string): DirEntry[] {
	try {
		return readdirSync(dir, { withFileTypes: true }).map((e) => ({
			name: e.name,
			isDirectory: e.isDirectory(),
			isFile: e.isFile(),
		}));
	} catch {
		return [];
	}
}

function safeStat(path: string) {
	try {
		return statSync(path);
	} catch {
		return undefined;
	}
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function asStringMap(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object") return {};
	const out: Record<string, string> = {};
	for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
		if (typeof val === "string") out[key] = val;
	}
	return out;
}

export function factsToMarkdown(facts: ProjectFacts): string {
	const lines: string[] = [];
	lines.push(`Repo root: ${facts.root}`);
	lines.push(`Working dir: ${facts.cwd}`);
	lines.push(`Git repo: ${facts.hasGit ? "yes" : "no"}`);
	lines.push(`AGENTS.md: ${facts.agentsMd.path} (${facts.agentsMd.exists ? "exists" : "missing"})`);
	if (facts.ecosystems.length) lines.push(`Ecosystem: ${facts.ecosystems.join(", ")}`);
	if (facts.packageManager) lines.push(`Package manager: ${facts.packageManager}`);
	if (facts.monorepo) lines.push(`Monorepo: yes`);

	if (facts.packageJson) {
		const pj = facts.packageJson;
		lines.push("package.json:");
		if (pj.name) lines.push(`  name: ${pj.name}${pj.version ? `@${pj.version}` : ""}`);
		if (pj.description) lines.push(`  description: ${pj.description}`);
		if (pj.packageManager) lines.push(`  packageManager: ${pj.packageManager}`);
		if (pj.engines && Object.keys(pj.engines).length) {
			lines.push(`  engines: ${Object.entries(pj.engines).map(([k, v]) => `${k} ${v}`).join(", ")}`);
		}
		const scriptNames = Object.keys(pj.scripts);
		if (scriptNames.length) {
			const shown = scriptNames.slice(0, 16);
			lines.push(`  scripts: ${shown.join(", ")}${scriptNames.length > shown.length ? ", …" : ""}`);
			for (const key of ["install", "dev", "build", "test", "lint", "typecheck", "format"]) {
				if (pj.scripts[key]) lines.push(`    ${key} → ${pj.scripts[key]}`);
			}
		}
		if (pj.workspaces && pj.workspaces.length) lines.push(`  workspaces: ${pj.workspaces.join(", ")}`);
	}

	if (facts.testFrameworks.length) lines.push(`Test frameworks: ${facts.testFrameworks.join(", ")}`);
	if (facts.lintTools.length) lines.push(`Lint/format: ${facts.lintTools.join(", ")}`);
	if (facts.ci.length) lines.push(`CI: ${facts.ci.join(", ")}`);
	if (facts.readme) lines.push("README: present");
	if (facts.gitignore) lines.push(".gitignore: present");
	if (facts.otherAgentFiles.length) lines.push(`Other agent files: ${facts.otherAgentFiles.map((f) => `${f.path} (${f.kind})`).join(", ")}`);
	if (facts.topDirs.length) lines.push(`Top-level dirs: ${facts.topDirs.join(", ")}`);
	return lines.join("\n");
}
