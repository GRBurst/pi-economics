// Step Q (spec §7, §9): the judge's default pair moves to qwenl; the retired `qwen` arm is gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmp } from "./helpers.ts";
import { cliRun, judgeBench } from "./q-fixtures.ts";

test("judge TASK JUDGE without arms judges qwenl against sonnet", () => {
	const b = judgeBench(["qwenl", "sonnet"]);
	const out = JSON.parse(cliRun(b.env, "judge", "T", "opus"));
	assert.deepEqual(Object.keys(out.verdicts).sort(), ["qwenl", "sonnet"]);
	assert.deepEqual(b.judged("opus"), ["qwenl", "sonnet"]);
	assert.throws(() => cliRun({ HOME: tmp() }, "bogus"), /\(default qwenl sonnet\)/);
});

test("judge-all --once without X judges qwenl against sonnet, and leaves a task with only old qwen runs alone", () => {
	const b = judgeBench(["qwenl", "sonnet"]);
	cliRun(b.env, "judge-all", "--once");
	assert.deepEqual([b.judged("opus"), b.judged("gpt")], [["qwenl", "sonnet"], ["qwenl", "sonnet"]]);
	const old = judgeBench(["qwen", "sonnet"]);
	cliRun(old.env, "judge-all", "--once");
	assert.deepEqual([old.judged("opus"), old.judged("gpt")], [null, null]);
});
