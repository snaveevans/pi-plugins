import assert from "node:assert/strict";
import test from "node:test";
import { parseInitArgs } from "./parse.ts";

test("empty or blank args default to auto", () => {
	assert.equal(parseInitArgs(undefined), "auto");
	assert.equal(parseInitArgs(""), "auto");
	assert.equal(parseInitArgs("   "), "auto");
});

test("create aliases", () => {
	assert.equal(parseInitArgs("create"), "create");
	assert.equal(parseInitArgs("new"), "create");
	assert.equal(parseInitArgs("CREATE"), "create");
});

test("audit aliases", () => {
	assert.equal(parseInitArgs("audit"), "audit");
	assert.equal(parseInitArgs("review"), "audit");
	assert.equal(parseInitArgs("check"), "audit");
	assert.equal(parseInitArgs("lint"), "audit");
	assert.equal(parseInitArgs("fix"), "audit");
});

test("unknown first token falls back to auto", () => {
	assert.equal(parseInitArgs("foo bar"), "auto");
	assert.equal(parseInitArgs("audit-and-fix"), "auto");
});
