import assert from "node:assert/strict";
import test from "node:test";
import {
	formatDuration,
	isFastModel,
	MAX_CONDITION_CHARS,
	parseGoalArgs,
	parseVerdict,
	truncateCondition,
} from "./parse.ts";

test("empty args are status", () => {
	assert.deepEqual(parseGoalArgs(""), { action: "status" });
	assert.deepEqual(parseGoalArgs(undefined), { action: "status" });
	assert.deepEqual(parseGoalArgs("status"), { action: "status" });
});

test("parses clear aliases", () => {
	for (const alias of ["clear", "stop", "off", "reset", "none", "cancel"]) {
		assert.deepEqual(parseGoalArgs(alias), { action: "clear" });
	}
});

test("everything else is a condition", () => {
	assert.deepEqual(parseGoalArgs("all tests in test/auth pass"), {
		condition: "all tests in test/auth pass",
	});
});

test("truncates long conditions", () => {
	const condition = "x".repeat(MAX_CONDITION_CHARS + 20);
	const parsed = parseGoalArgs(condition);
	assert.ok(parsed.condition?.includes(`[truncated at ${MAX_CONDITION_CHARS} characters]`));
	assert.equal(truncateCondition("short"), "short");
});

test("parses JSON verdicts, including fenced and messy text", () => {
	assert.deepEqual(parseVerdict('{"verdict":"met","reason":"npm test exited 0"}'), {
		verdict: "met",
		reason: "npm test exited 0",
	});
	assert.deepEqual(
		parseVerdict('Here you go:\n```json\n{"verdict":"not_met","reason":"auth tests still fail"}\n```'),
		{ verdict: "not_met", reason: "auth tests still fail" },
	);
	assert.deepEqual(parseVerdict("Verdict: impossible\nReason: the module does not exist"), {
		verdict: "impossible",
		reason: "the module does not exist",
	});
	assert.equal(parseVerdict("I am not sure yet"), undefined);
});

test("detects fast evaluator models", () => {
	assert.equal(isFastModel({ id: "claude-haiku-4-5" }), true);
	assert.equal(isFastModel({ id: "gpt-4o-mini", name: "GPT-4o mini" }), true);
	assert.equal(isFastModel({ id: "gemini-2.5-flash" }), true);
	assert.equal(isFastModel({ id: "claude-opus-4-6" }), false);
});

test("formats seconds below 100s, minutes through 99m, then hours", () => {
	assert.equal(formatDuration(0), "0s");
	assert.equal(formatDuration(20_000), "20s");
	assert.equal(formatDuration(99_000), "99s");
	assert.equal(formatDuration(100_000), "1m");
	assert.equal(formatDuration(99 * 60_000), "99m");
	assert.equal(formatDuration(100 * 60_000), "1h");
});
