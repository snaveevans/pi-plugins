import assert from "node:assert/strict";
import test from "node:test";
import { clampInterval, formatDuration, MIN_INTERVAL_MS, parseLoopArgs } from "./parse.ts";

test("parses leading compact interval", () => {
	assert.deepEqual(parseLoopArgs("5m check the deploy"), {
		intervalMs: 5 * 60_000,
		prompt: "check the deploy",
	});
});

test("parses trailing every-clause", () => {
	assert.deepEqual(parseLoopArgs("check the deploy every 2 hours"), {
		intervalMs: 2 * 3_600_000,
		prompt: "check the deploy",
	});
});

test("parses actions", () => {
	assert.deepEqual(parseLoopArgs("stop"), { action: "stop" });
	assert.deepEqual(parseLoopArgs("off"), { action: "stop" });
	assert.deepEqual(parseLoopArgs("status"), { action: "status" });
	assert.deepEqual(parseLoopArgs("now"), { action: "now" });
});

test("prompt only uses default interval later", () => {
	assert.deepEqual(parseLoopArgs("check the deploy"), {
		prompt: "check the deploy",
	});
});

test("clamps short intervals", () => {
	assert.deepEqual(clampInterval(1000), { ms: MIN_INTERVAL_MS, clamped: true });
});

test("formats seconds below 100s, minutes through 99m, then hours", () => {
	assert.equal(formatDuration(0), "0s");
	assert.equal(formatDuration(500), "1s");
	assert.equal(formatDuration(20_000), "20s");
	assert.equal(formatDuration(99_000), "99s");
	assert.equal(formatDuration(100_000), "1m");
	assert.equal(formatDuration(5 * 60_000), "5m");
	assert.equal(formatDuration(99 * 60_000), "99m");
	assert.equal(formatDuration(100 * 60_000), "1h");
	assert.equal(formatDuration(2 * 3_600_000), "2h");
});
