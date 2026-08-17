/**
 * Argument parsing for /init.
 */

export type InitAction = "auto" | "create" | "audit";

const CREATE_ALIASES = new Set(["create", "new"]);
const AUDIT_ALIASES = new Set(["audit", "review", "check", "lint", "fix"]);

export function parseInitArgs(raw: string | undefined): InitAction {
	const text = raw?.trim().toLowerCase() ?? "";
	if (!text) return "auto";
	const first = text.split(/\s+/)[0];
	if (!first) return "auto";
	if (CREATE_ALIASES.has(first)) return "create";
	if (AUDIT_ALIASES.has(first)) return "audit";
	return "auto";
}
