import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/cli.ts";
import { fakePrintPi, script, sourceRepo, tmp } from "./helpers.ts";

const cli = join(dirname(fileURLToPath(import.meta.url)), "../src/cli.ts");
// The child inherits the parent environment: judge.ts pipes git into tar through `bash`, and on NixOS a bash started
// with a bare {PATH} re-sources /etc/profile, which rewrites PATH (git gone). Overrides win.
const run = (env: Record<string, string>, ...args: string[]) =>
	execFileSync("node", ["--experimental-strip-types", "--no-warnings", cli, ...args], { env: { ...process.env, ...env }, encoding: "utf8" });

test("pool runs at most `par` jobs at once and finishes all", async () => {
	let live = 0, peak = 0;
	const done: number[] = [];
	await pool([1, 2, 3, 4, 5], 2, async (n) => {
		peak = Math.max(peak, ++live);
		await new Promise((r) => setTimeout(r, 20));
		live--;
		done.push(n);
	});
	assert.equal(peak, 2);
	assert.deepEqual(done.sort(), [1, 2, 3, 4, 5]);
});

test("pi-bench run | report through the CLI, with data and work dirs from the environment", () => {
	const repo = sourceRepo();
	const data = tmp();
	const work = tmp();
	writeFileSync(join(data, "tasks.json"), JSON.stringify({ T1: { kind: "small", gitdir: repo.gitdir, sub: "proj", base: repo.base, prompt: "p", check: "true" } }));
	const env = { PI_BENCH_DATA: data, PI_BENCH_WORK: work, PI_BENCH_EXT_DIR: "/ext", PI_BENCH_PI: fakePrintPi(join(tmp(), "log")), HOME: tmp() };
	const out = run(env, "run", "T1", "sonnet", "2");
	assert.equal(JSON.parse(out.trim().split("\n").at(-1)!).rep, 2);
	assert.ok(existsSync(join(data, "runs/T1.sonnet.2/result.json")));
	const metrics = run(env, "metrics").trim().split("\n").map((l) => JSON.parse(l));
	assert.equal(metrics[0].run, "T1.sonnet.2");
	const rep = run(env, "report", "--factors", "arm");
	assert.match(rep, /# Bench report/);
	assert.match(rep, /## arm/);
	assert.ok(readFileSync(join(data, "reports", readdirSync(join(data, "reports"))[0]), "utf8").includes("# Bench report"));
});

test("judge --all: absolute verdict per run for tasks with ≥2 runs, skips single-run tasks, idempotent", () => {
	const repo = sourceRepo();
	const data = tmp();
	const work = tmp();
	const task = { kind: "small", gitdir: repo.gitdir, sub: "proj", base: repo.base, refs: [repo.next], prompt: "p", check: "true" };
	writeFileSync(join(data, "tasks.json"), JSON.stringify({ JA: task, JB: task }));
	const envBase = { PI_BENCH_DATA: data, PI_BENCH_WORK: work, PI_BENCH_EXT_DIR: "/ext", HOME: tmp() };
	const agentPi = fakePrintPi(join(tmp(), "alog"));
	for (const [id, arms] of [["JA", ["qwenl", "sonnet"]], ["JB", ["qwenl"]]] as [string, string[]][])
		for (const arm of arms)
			run({ ...envBase, PI_BENCH_PI: agentPi }, "run", id, arm, "1");
	run(envBase, "refs");
	const jlog = join(tmp(), "jlog");
	const verdict = "```json\n" + JSON.stringify({ correct: 3, scope: 2, quality: 3, verdict: "pass", requirements: [], notes: "" }) + "\n```";
	const judgePi = script(`#!/bin/sh\necho judged >> ${jlog}\ncat <<'EOF'\n${verdict}\nEOF\n`);
	const judgeAll = () => run({ ...envBase, PI_BENCH_PI: judgePi }, "judge", "--all", "--judges", "opus", "--parallel", "2");
	judgeAll();
	assert.ok(existsSync(join(data, "judge/JA/JA.qwenl.1/opus.json")), "JA qwenl judged");
	assert.ok(existsSync(join(data, "judge/JA/JA.sonnet.1/opus.json")), "JA sonnet judged");
	assert.equal(existsSync(join(data, "judge/JB")), false, "single-run task skipped");
	assert.equal(readFileSync(jlog, "utf8").trim().split("\n").length, 2);
	judgeAll(); // idempotent: judged runs are skipped
	assert.equal(readFileSync(jlog, "utf8").trim().split("\n").length, 2, "no re-judging");
});

test("pi-bench with no or an unknown command prints usage and fails", () => {
	assert.throws(() => run({ HOME: tmp() }, "bogus"), /usage: pi-bench/);
});
import { readdirSync } from "node:fs";
