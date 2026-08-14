/**
 * Parse /goal arguments and evaluator replies.
 */

export const MAX_CONDITION_CHARS = 4_000;
export const STUCK_IDLE_TURNS = 3;
export const MAX_TRANSCRIPT_CHARS = 24_000;

export type GoalAction = "clear" | "status";
export type GoalVerdict = "met" | "not_met" | "impossible";

export interface ParsedGoalArgs {
	action?: GoalAction;
	condition?: string;
}

export interface ParsedVerdict {
	verdict: GoalVerdict;
	reason: string;
}

const CLEAR_ALIASES = new Set(["clear", "stop", "off", "reset", "none", "cancel"]);
const STATUS_ALIASES = new Set(["status", "list"]);

const FAST_MODEL = /haiku|flash|mini|nano|lite|small|fast|grok-3-mini|gpt-4o-mini|gpt-4\.1-mini|gpt-4\.1-nano|o[34]-mini/;

export function parseGoalArgs(raw: string | undefined): ParsedGoalArgs {
	const text = raw?.trim() ?? "";
	if (!text) return { action: "status" };

	const lower = text.toLowerCase();
	if (CLEAR_ALIASES.has(lower)) return { action: "clear" };
	if (STATUS_ALIASES.has(lower)) return { action: "status" };

	return { condition: truncateCondition(text) };
}

export function truncateCondition(condition: string): string {
	if (condition.length <= MAX_CONDITION_CHARS) return condition;
	return `${condition.slice(0, MAX_CONDITION_CHARS)}\n\n[truncated at ${MAX_CONDITION_CHARS} characters]`;
}

export function parseVerdict(raw: string): ParsedVerdict | undefined {
	const text = raw.trim();
	if (!text) return undefined;

	const fromJson = parseVerdictJson(text);
	if (fromJson) return fromJson;

	return parseVerdictLines(text);
}

export function isFastModel(model: { id: string; name?: string }): boolean {
	const haystack = `${model.id} ${model.name ?? ""}`.toLowerCase();
	return FAST_MODEL.test(haystack);
}

export function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	if (totalSeconds < 100) return `${totalSeconds}s`;

	const totalMinutes = Math.max(1, Math.floor(totalSeconds / 60));
	if (totalMinutes <= 99) return `${totalMinutes}m`;

	const hours = Math.max(1, Math.floor(totalMinutes / 60));
	return `${hours}h`;
}

export function summarizeText(text: string, max = 64): string {
	const first = text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? text.trim();
	if (first.length <= max) return first;
	return `${first.slice(0, max - 1)}…`;
}

function parseVerdictJson(text: string): ParsedVerdict | undefined {
	const candidates = [text];
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenced?.[1]) candidates.unshift(fenced[1].trim());

	const braced = text.match(/\{[\s\S]*\}/);
	if (braced?.[0]) candidates.unshift(braced[0]);

	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate) as { verdict?: unknown; reason?: unknown };
			const verdict = normalizeVerdict(parsed.verdict);
			if (!verdict) continue;
			const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
			return { verdict, reason: reason || defaultReason(verdict) };
		} catch {
			// try the next candidate
		}
	}
	return undefined;
}

function parseVerdictLines(text: string): ParsedVerdict | undefined {
	const verdictLine = text.match(/\b(not[_\s-]?met|met|impossible|unmet|failed|achieved|done)\b/i);
	if (!verdictLine) return undefined;
	const verdict = normalizeVerdict(verdictLine[1]);
	if (!verdict) return undefined;

	const reasonLine = text.match(/\breason\s*[:\-]\s*(.+)$/im);
	const reason = reasonLine?.[1]?.trim() || text.replace(verdictLine[0], "").trim();
	return { verdict, reason: reason || defaultReason(verdict) };
}

function normalizeVerdict(raw: unknown): GoalVerdict | undefined {
	if (typeof raw !== "string") return undefined;
	const value = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
	if (value === "met" || value === "achieved" || value === "done" || value === "yes") return "met";
	if (value === "not_met" || value === "unmet" || value === "no") return "not_met";
	if (value === "impossible" || value === "failed") return "impossible";
	return undefined;
}

function defaultReason(verdict: GoalVerdict): string {
	if (verdict === "met") return "Condition looks satisfied.";
	if (verdict === "impossible") return "Condition cannot be satisfied.";
	return "Condition is not yet satisfied.";
}
