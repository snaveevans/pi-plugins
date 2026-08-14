/**
 * Parse `/loop` arguments and interval tokens.
 *
 * Supported interval forms:
 *   5m   30s   2h   1d
 *   every 5m   every 2 hours
 *   5 minutes
 *
 * Interval may lead or trail the prompt:
 *   /loop 5m check the deploy
 *   /loop check the deploy every 5m
 */

export const MIN_INTERVAL_MS = 10_000;
export const MAX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

export interface ParsedLoopArgs {
	action?: "stop" | "status" | "now";
	intervalMs?: number;
	prompt?: string;
}

const ACTION_ALIASES: Record<string, NonNullable<ParsedLoopArgs["action"]>> = {
	stop: "stop",
	off: "stop",
	clear: "stop",
	cancel: "stop",
	status: "status",
	list: "status",
	now: "now",
	run: "now",
	fire: "now",
};

const UNIT_MS: Record<string, number> = {
	s: 1000,
	sec: 1000,
	secs: 1000,
	second: 1000,
	seconds: 1000,
	m: 60_000,
	min: 60_000,
	mins: 60_000,
	minute: 60_000,
	minutes: 60_000,
	h: 3_600_000,
	hr: 3_600_000,
	hrs: 3_600_000,
	hour: 3_600_000,
	hours: 3_600_000,
	d: 86_400_000,
	day: 86_400_000,
	days: 86_400_000,
};

const COMPACT_INTERVAL = /^(\d+(?:\.\d+)?)(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i;
const EVERY_CLAUSE = /\bevery\s+(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\b/i;
const SPACED_INTERVAL = /^(\d+(?:\.\d+)?)\s+(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i;

export function parseLoopArgs(raw: string | undefined): ParsedLoopArgs {
	const text = raw?.trim() ?? "";
	if (!text) return {};

	const action = ACTION_ALIASES[text.toLowerCase()];
	if (action) return { action };

	const every = text.match(EVERY_CLAUSE);
	if (every) {
		const intervalMs = toIntervalMs(every[1], every[2]);
		const prompt = `${text.slice(0, every.index).trim()} ${text.slice((every.index ?? 0) + every[0].length).trim()}`.trim();
		return { intervalMs, prompt: prompt || undefined };
	}

	const tokens = text.split(/\s+/);
	const first = parseIntervalToken(tokens[0] ?? "");
	if (first !== undefined) {
		const prompt = tokens.slice(1).join(" ").trim();
		return { intervalMs: first, prompt: prompt || undefined };
	}

	if (tokens.length >= 2) {
		const leadingSpaced = parseIntervalToken(`${tokens[0]} ${tokens[1]}`);
		if (leadingSpaced !== undefined) {
			const prompt = tokens.slice(2).join(" ").trim();
			return { intervalMs: leadingSpaced, prompt: prompt || undefined };
		}

		const last = parseIntervalToken(tokens[tokens.length - 1] ?? "");
		if (last !== undefined) {
			const prompt = tokens.slice(0, -1).join(" ").trim();
			return { intervalMs: last, prompt: prompt || undefined };
		}

		const trailingSpaced = parseIntervalToken(`${tokens[tokens.length - 2]} ${tokens[tokens.length - 1]}`);
		if (trailingSpaced !== undefined) {
			const prompt = tokens.slice(0, -2).join(" ").trim();
			return { intervalMs: trailingSpaced, prompt: prompt || undefined };
		}
	}

	return { prompt: text };
}

export function parseIntervalToken(token: string): number | undefined {
	const compact = token.match(COMPACT_INTERVAL);
	if (compact) return toIntervalMs(compact[1], compact[2]);
	const spaced = token.match(SPACED_INTERVAL);
	if (spaced) return toIntervalMs(spaced[1], spaced[2]);
	return undefined;
}

export function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	if (totalSeconds < 100) return `${totalSeconds}s`;

	const totalMinutes = Math.max(1, Math.floor(totalSeconds / 60));
	if (totalMinutes <= 99) return `${totalMinutes}m`;

	const hours = Math.max(1, Math.floor(totalMinutes / 60));
	return `${hours}h`;
}

export function formatClock(ms: number): string {
	return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export function clampInterval(ms: number): { ms: number; clamped: boolean } {
	if (ms < MIN_INTERVAL_MS) return { ms: MIN_INTERVAL_MS, clamped: true };
	if (ms > MAX_INTERVAL_MS) return { ms: MAX_INTERVAL_MS, clamped: true };
	return { ms, clamped: false };
}

function toIntervalMs(rawValue: string, rawUnit: string): number {
	const value = Number(rawValue);
	const unit = UNIT_MS[rawUnit.toLowerCase()];
	if (!Number.isFinite(value) || value <= 0 || unit === undefined) {
		throw new Error(`Invalid interval "${rawValue}${rawUnit}"`);
	}
	return value * unit;
}
