// Step Q (spec §7, §9): the judge's default pair moves to qwenl; the retired `qwen` arm is gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PAIR, defaultArms, resolvePaths } from "../src/config.ts";
import { JUDGES } from "../src/judge.ts";
import { runOne } from "../src/run.ts";
import { fakePrintPi, sourceRepo, tmp } from "./helpers.ts";
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

test("the bench's only OpenRouter use is the paid judge gpt: no default arm is on OpenRouter, the default pair is two default arms", () => {
	const onOpenRouter = (xs: Record<string, { model: string }>) => Object.entries(xs).filter(([, v]) => v.model.startsWith("openrouter/")).map(([n]) => n);
	assert.deepEqual(onOpenRouter(defaultArms()), []);
	assert.deepEqual(onOpenRouter(JUDGES), ["gpt"]);
	for (const a of Object.values(DEFAULT_PAIR)) assert.ok(a in defaultArms(), a);
});

test("run TASK qwen: the retired arm is unknown and nothing is created; the usage no longer offers it", async () => {
	const repo = sourceRepo();
	const paths = resolvePaths({ HOME: tmp(), PI_BENCH_DATA: tmp(), PI_BENCH_WORK: tmp(), PI_BENCH_EXT_DIR: "/ext" }, "/pkg");
	const task = { kind: "small", gitdir: repo.gitdir, sub: "proj", base: repo.base, prompt: "p", check: "true" };
	const pi = fakePrintPi(join(tmp(), "log"));
	await assert.rejects(runOne({ id: "U", task, arm: "qwen", rep: 1, paths, piBin: pi, env: { PATH: process.env.PATH! }, timeoutSec: 30 }), /unknown arm: qwen/);
	assert.equal(existsSync(join(paths.data, "runs/U.qwen.1")), false);
	assert.throws(() => cliRun({ HOME: tmp() }, "bogus"), /\(ARM: qwenl \| sonnet \| orch \| orch-<signs> \| arms\.json\)/);
});
