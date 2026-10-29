// Step Q (spec §7): runs of the retired `qwen` arm stay reportable and judgeable. Green before and after Q.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultArms, resolvePaths } from "../src/config.ts";
import { loadRows } from "../src/report.ts";
import { tmp } from "./helpers.ts";
import { cand, cliRun, judgeBench, OLD_QWEN } from "./q-fixtures.ts";

// Q.1
test("report: an arm without factors adds nothing to a row, so old qwen runs report the same with or without the arm", () => {
	const paths = resolvePaths({ HOME: tmp(), PI_BENCH_DATA: tmp(), PI_BENCH_WORK: tmp() }, "/pkg");
	const D = paths.data;
	writeFileSync(join(D, "tasks.json"), JSON.stringify({ S1: { kind: "small" } }));
	for (const arm of ["qwen", "sonnet"]) {
		mkdirSync(join(D, "runs", `S1.${arm}.1`), { recursive: true });
		writeFileSync(join(D, "runs", `S1.${arm}.1`, "result.json"), JSON.stringify({ id: "S1", arm, rep: 1, model: "m", think: "high", piexit: 0, checkExit: 0, wallSec: 60, checkSec: 0, filesChanged: 1, baseSha: "x" }));
	}
	mkdirSync(join(D, "judge/S1"), { recursive: true });
	writeFileSync(join(D, "judge/S1/opus.json"), JSON.stringify({ id: "S1", judge: "opus", map: { A: "qwen", B: "sonnet" },
		arms: { qwen: { ...cand("partial"), capped: false }, sonnet: { ...cand("pass"), capped: false } }, preference: "B" }));
	const without = loadRows(paths);
	writeFileSync(join(D, "arms.json"), JSON.stringify({ qwen: OLD_QWEN }));
	assert.deepEqual(loadRows(paths), without);
	const factors = Object.keys(Object.values(defaultArms()).find((a) => a.factors)!.factors!);
	const row = without.find((r) => r.arm === "qwen")!;
	assert.deepEqual(factors.filter((f) => f in row), [], "no factor column on an old qwen row");
	assert.equal(row.verdicts.opus, "partial");
});

// Q.2
test("judge TASK JUDGE qwen sonnet and judge-all qwen: old qwen runs stay judgeable with explicit arms", () => {
	const b = judgeBench(["qwen", "sonnet"]);
	cliRun(b.env, "judge", "T", "opus", "qwen", "sonnet");
	assert.deepEqual(b.judged("opus"), ["qwen", "sonnet"]);
	cliRun(b.env, "judge-all", "--once", "qwen");
	assert.deepEqual(b.judged("gpt"), ["qwen", "sonnet"]);
});

test("judge: a task's recorded blind map wins over the requested pair, so both judges see the same two runs", () => {
	const b = judgeBench(["qwen", "qwenl", "sonnet"]);
	cliRun(b.env, "judge", "T", "opus", "qwen", "sonnet");
	cliRun(b.env, "judge", "T", "gpt", "qwenl", "sonnet");
	assert.deepEqual(b.judged("gpt"), ["qwen", "sonnet"]);
});
