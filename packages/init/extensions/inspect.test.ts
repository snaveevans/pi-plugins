import assert from "node:assert/strict";
import test from "node:test";
import {
	detectCi,
	detectEcosystems,
	detectLintTools,
	detectMonorepo,
	detectOtherAgentFiles,
	detectPackageManager,
	detectTestFrameworks,
} from "./inspect.ts";

test("detectPackageManager prefers the packageManager field", () => {
	assert.equal(detectPackageManager(["package.json", "package-lock.json"], "pnpm@9.12.0"), "pnpm");
	assert.equal(detectPackageManager([], "yarn@4.1.1"), "yarn");
});

test("detectPackageManager falls back to lockfiles", () => {
	assert.equal(detectPackageManager(["pnpm-lock.yaml", "package.json"]), "pnpm");
	assert.equal(detectPackageManager(["bun.lock", "package.json"]), "bun");
	assert.equal(detectPackageManager(["yarn.lock", "package.json"]), "yarn");
	assert.equal(detectPackageManager(["package-lock.json", "package.json"]), "npm");
	assert.equal(detectPackageManager(["deno.lock"]), "deno");
});

test("detectPackageManager defaults to npm for a plain package.json", () => {
	assert.equal(detectPackageManager(["package.json"]), "npm");
	assert.equal(detectPackageManager(["README.md"]), undefined);
});

test("detectEcosystems maps config files to ecosystems", () => {
	assert.deepEqual(detectEcosystems(["package.json", "pnpm-lock.yaml"]), ["node"]);
	assert.deepEqual(detectEcosystems(["deno.json"]), ["deno"]);
	assert.deepEqual(detectEcosystems(["pyproject.toml", "uv.lock"]), ["python"]);
	assert.deepEqual(detectEcosystems(["Cargo.toml"]), ["rust"]);
	assert.deepEqual(detectEcosystems(["go.mod"]), ["go"]);
	assert.deepEqual(detectEcosystems(["package.json", "requirements.txt"]), ["node", "python"]);
});

test("detectTestFrameworks reads config files and deps", () => {
	assert.deepEqual(detectTestFrameworks(["vitest.config.ts"], ["vitest"]), ["vitest"]);
	assert.deepEqual(detectTestFrameworks(["jest.config.js", "package.json"], ["jest"]), ["jest"]);
	assert.deepEqual(detectTestFrameworks(["pytest.ini", "conftest.py"]), ["pytest"]);
	assert.deepEqual(detectTestFrameworks(["Cargo.toml"]), ["cargo-test"]);
	assert.deepEqual(detectTestFrameworks(["go.mod"]), ["go-test"]);
	assert.deepEqual(detectTestFrameworks(["README.md"], []), []);
});

test("detectLintTools finds eslint, biome, prettier, ruff", () => {
	const found = detectLintTools([".eslintrc.json", "biome.json", ".prettierrc", "ruff.toml"]);
	assert.ok(found.includes("eslint"));
	assert.ok(found.includes("biome"));
	assert.ok(found.includes("prettier"));
	assert.ok(found.includes("ruff"));
});

test("detectLintTools picks up flat eslint config", () => {
	assert.ok(detectLintTools(["eslint.config.mjs"]).includes("eslint"));
});

test("detectCi detects github actions and gitlab", () => {
	assert.deepEqual(detectCi([".gitlab-ci.yml"], true), ["github-actions", "gitlab-ci"]);
	assert.deepEqual(detectCi(["README.md"], false), []);
});

test("detectOtherAgentFiles finds root-level CLAUDE.md, GEMINI.md, .cursorrules", () => {
	assert.deepEqual(detectOtherAgentFiles(["CLAUDE.md", "GEMINI.md", ".cursorrules"]), [
		{ kind: "claude", path: "CLAUDE.md" },
		{ kind: "gemini", path: "GEMINI.md" },
		{ kind: "cursor", path: ".cursorrules" },
	]);
	// .github/copilot-instructions.md is detected in inspectProject (subdirectory), not here.
	assert.deepEqual(detectOtherAgentFiles(["README.md"]), []);
});

test("detectMonorepo flags workspaces and monorepo tooling", () => {
	assert.equal(detectMonorepo(["pnpm-workspace.yaml"]), true);
	assert.equal(detectMonorepo(["turbo.json"]), true);
	assert.equal(detectMonorepo(["package.json"], { scripts: {}, workspaces: ["apps/*"] }), true);
	assert.equal(detectMonorepo(["package.json"], { scripts: {} }), false);
	assert.equal(detectMonorepo(["README.md"]), false);
});
