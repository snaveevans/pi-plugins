import { validateMaxCostUsd } from "./goal-record.ts";

/** Parse only a leading option: the rest of the command is free-text objective. */
export function parseGoalCostOption(raw: string): { ok: true; objective: string; maxCostUsd?: number } | { ok: false; message: string } {
	const text = raw.trim();
	if (!text.startsWith("--")) return { ok: true, objective: text };
	const match = /^--max-cost(?:\s+(\S+))?(?:\s+([\s\S]*))?$/.exec(text);
	if (!match || !match[1] || !/^\d+(?:\.\d{1,2})?$/.test(match[1])) {
		return { ok: false, message: "Use --max-cost <positive USD amount> at the start, e.g. /goal --max-cost 5.00 <objective>." };
	}
	const parsed = validateMaxCostUsd(Number(match[1]));
	if (!parsed.ok) return { ok: false, message: parsed.message };
	return { ok: true, objective: (match[2] ?? "").trim(), maxCostUsd: parsed.value };
}

export function formatGoalCost(maxCostUsd?: number, costUsedUsd = 0): string {
	return maxCostUsd === undefined
		? "Max estimated cost: none"
		: `Max estimated cost: $${maxCostUsd.toFixed(2)} USD ($${costUsedUsd.toFixed(4)} used)`;
}
