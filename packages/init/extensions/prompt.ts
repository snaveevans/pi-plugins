/**
 * /init prompt composition.
 *
 * Both prompts embed current best-practice guidance (synthesized from
 * ETH-Zurich "Evaluating AGENTS.md" 2025, HumanLayer, philschmid, the
 * Linux-Foundation-stewarded spec, and others). The extension gathers
 * grounded repo facts; the model does the authoring/auditing.
 */

import { factsToMarkdown, type ProjectFacts } from "./inspect.ts";

export const BEST_PRACTICES = `## What a good AGENTS.md looks like (best-practice guidance)

AGENTS.md is plain Markdown. No required fields, no frontmatter schema. It is loaded at the start of every session, so every line costs tokens on every turn.

Length: keep it short. Aim for 60–200 lines; under 300 hard. (Codex caps at 32 KiB.) Sparse and high-signal beats comprehensive. Auto-generated or bloated files measurably hurt task success and raise cost — less is more.

Include:
- Project overview — one short paragraph: what it is, primary language/framework with versions, and the one architectural constraint agents can't infer from the code.
- Commands — exact, copy-pasteable, with flags and pinned versions. Install / dev / build / test / lint / typecheck / single-test. Tools you name here get used far more often, so name the ones that matter (e.g. \`pnpm\` not \`npm\`, \`uv\` not \`pip\`).
- Project structure — directories mapped to responsibilities, only the ones an agent must understand before editing. Not an exhaustive tree; agents discover the rest.
- Conventions — only rules that differ from language/framework defaults. Imperative voice ("Use X", "Do not Y").
- Boundaries, three tiers: ✅ Always / ⚠️ Ask first / 🚫 Never.
- Testing — how to run the suite and a single test; when to add tests.
- Verification / Definition of Done — a checklist the agent self-runs before declaring work finished.
- Security — never commit secrets/.env; reference secret storage, never secrets themselves.

Avoid:
- Secrets, tokens, customer data — assume the file is public.
- Exhaustive directory listings or long architecture essays — they don't help navigation and bloat context.
- Duplicating the README or existing docs — link instead ("see docs/foo.md for X").
- A vague persona ("helpful assistant"). State a role only if it changes behavior.
- Commands without flags, or commands that aren't real scripts.
- Prose-only rules — use tables and bullets.
- Stale paths/commands — verify against the repo.
- Conflicting or duplicated instructions.

Mark content the AI must not rewrite with HTML-comment fences:
<!-- BEGIN USER-SPECIFIED -->
…intentional, possibly unconventional decisions and their rationale…
<!-- END USER-SPECIFIED -->

Treat it as code: commit it, review changes in the same PR that changes the convention, keep it in sync with reality.`;

export function buildCreatePrompt(facts: ProjectFacts): string {
	return `Create an AGENTS.md for this repository.

${BEST_PRACTICES}

## Your task

Author the file at:
${facts.agentsMd.path}

Use the repo facts below as ground truth. Before listing a command, confirm the script/tool actually exists (the facts list the detected package manager, package.json scripts, and configs). If a common command isn't present, omit it rather than inventing one. Derive the package manager and exact commands from the facts — do not assume npm when the repo uses pnpm, etc.

Start with the sections this repo actually needs (commonly ## Overview, ## Commands, ## Project structure, ## Conventions, ## Boundaries, ## Testing, ## Verification). Keep the whole file under ~150 lines. Prefer bullets and tables over prose. Include a three-tier Boundaries section and a Definition-of-Done verification checklist.

${facts.otherAgentFiles.length ? `Note: other agent-instruction files already exist in this repo (${facts.otherAgentFiles.map((f) => f.path).join(", ")}). Do not duplicate their content; you may note that AGENTS.md is the source of truth and the others import/symlink to it.\n` : ""}Write the file now, then report in 3–5 bullets: what you included, which commands you verified, and anything you were unsure about (so the human can confirm).

<repo-facts>
${factsToMarkdown(facts)}
</repo-facts>`;
}

export function buildAuditPrompt(facts: ProjectFacts, existing: string): string {
	return `Audit the existing AGENTS.md for this repository, then fix it in place.

${BEST_PRACTICES}

## Your task

Target file:
${facts.agentsMd.path}

The current file and the repo facts are below. Use the facts to catch stale or missing commands and paths. Make fixes directly by editing the file, then summarize what you changed and why. If the file is already good, say so and make no changes.

Check specifically for:
- Missing or thin sections — especially Commands, Boundaries, and Verification.
- Commands that don't match the detected scripts/package manager (e.g. listing \`npm test\` when the repo uses pnpm and has no such script).
- Stale paths or referenced files that don't exist in the repo.
- Content that duplicates the README — should link instead.
- Overly long sections — trim to what changes behavior.
- Missing three-tier boundaries (Always / Ask first / Never).
- Any secrets, tokens, or customer data.
- Vague persona or prose-only rules.
- Length over ~200 lines — propose trims.
- Conflicting or duplicated instructions.

${facts.otherAgentFiles.length ? `Other agent-instruction files exist (${facts.otherAgentFiles.map((f) => f.path).join(", ")}). Flag duplication between them and AGENTS.md; recommend AGENTS.md as the source of truth.\n` : ""}Keep the file under ~150 lines after edits.

<current-agents-md>
${existing}
</current-agents-md>

<repo-facts>
${factsToMarkdown(facts)}
</repo-facts>`;
}

export function summarizeCondition(facts: ProjectFacts, mode: "create" | "audit"): string {
	const bits: string[] = [];
	if (facts.packageManager) bits.push(facts.packageManager);
	if (facts.ecosystems.length) bits.push(facts.ecosystems.join("/"));
	if (facts.monorepo) bits.push("monorepo");
	bits.push(mode === "create" ? "new file" : "audit");
	return bits.join(" · ");
}
