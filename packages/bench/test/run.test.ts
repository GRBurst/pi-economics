import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultArms, resolvePaths, timeoutSec } from "../src/config.ts";
import { buildPrompt } from "../src/prompt.ts";
import { checkout, RETRY_SETTINGS } from "../src/workdir.ts";
import { needsDevenvShim, runEnv } from "../src/env.ts";
import { printArgs } from "../src/driver-print.ts";
import { runOne } from "../src/run.ts";
import type { Task } from "../src/types.ts";
import { fakePrintPi, script, sourceRepo, tmp } from "./helpers.ts";

const g = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();

function taskFor(repo: ReturnType<typeof sourceRepo>, over: Partial<Task> = {}): Task {
	return { kind: "small", gitdir: repo.gitdir, sub: "proj", base: repo.base, prompt: "Change a.txt.", check: "test -f changed.txt", ...over };
}

test("checkout: git archive of base:sub into a fresh single-commit repo with native-retry settings", () => {
	const repo = sourceRepo();
	const dataDir = tmp();
	const work = join(tmp(), "work");
	writeFileSync(join(dataDir, "extra.md"), "extra\n");
	const sha = checkout(taskFor(repo, { overlay: { "a.txt": repo.next }, extraFiles: { "extra.md": "extra.md" } }), work, dataDir);
	assert.equal(g(work, "rev-parse", "HEAD"), sha);
	assert.equal(g(work, "rev-list", "--count", "HEAD"), "1", "no source history");
	assert.equal(g(work, "config", "commit.gpgsign"), "false");
	assert.equal(readFileSync(join(work, "keep.txt"), "utf8"), "keep\n");
	assert.equal(existsSync(join(work, "outside.txt")), false, "only the sub directory");
	assert.equal(readFileSync(join(work, "a.txt"), "utf8"), "two\n", "overlay file from a later commit");
	assert.equal(readFileSync(join(work, "extra.md"), "utf8"), "extra\n");
	assert.deepEqual(JSON.parse(readFileSync(join(work, ".pi/settings.json"), "utf8")), RETRY_SETTINGS);
	assert.deepEqual(RETRY_SETTINGS, { retry: { enabled: true, maxRetries: 100, baseDelayMs: 2000, maxAgentDelayMs: 2000 } });
	assert.equal(g(work, "status", "--porcelain"), "", "settings are untracked and excluded");
	assert.match(readFileSync(join(work, ".git/info/exclude"), "utf8"), /^\.pi\/settings\.json$/m);
});

test("checkout without sub archives the whole tree", () => {
	const repo = sourceRepo();
	const work = join(tmp(), "w");
	checkout(taskFor(repo, { sub: "" }), work, tmp());
	assert.equal(existsSync(join(work, "outside.txt")), true);
	assert.equal(existsSync(join(work, "proj/a.txt")), true);
});

test("preface: work tasks are non-interactive with gates approved, commit and report; scouts are read-only", () => {
	const work = buildPrompt("small", "Fix it.");
	assert.match(work, /non-interactively/);
	assert.match(work, /already approved/);
	assert.match(work, /commit your changes with git/);
	assert.match(work, /short report/);
	assert.ok(work.endsWith("## Task\nFix it."));
	const scout = buildPrompt("scout", "Where is X?");
	assert.match(scout, /Do not modify any files/);
	assert.doesNotMatch(scout, /commit your changes/);
	assert.ok(scout.endsWith("## Task\nWhere is X?"));
});

test("print args: explicit extension list, claude-auth for anthropic arms, session dir, prompt last", () => {
	const arms = defaultArms();
	const a = printArgs(arms.sonnet, "/ext", "/sess", "PROMPT");
	assert.deepEqual(a.slice(0, 7), ["-p", "--model", "anthropic/claude-sonnet-5-5", "--thinking", "high", "-ne", "--approve"]);
	assert.ok(a.join(" ").includes("-e /ext/claude-auth"), "claude-auth is required for anthropic models");
	assert.ok(a.join(" ").includes("-e /ext/infinite-context"));
	assert.deepEqual(a.slice(-3), ["--session-dir", "/sess", "PROMPT"]);
	for (const [name, arm] of Object.entries(arms))
		if (arm.model.startsWith("anthropic/")) assert.ok(arm.extensions.includes("claude-auth"), name);
});

test("timeout default is 5400 s, BENCH_TIMEOUT overrides", () => {
	assert.equal(timeoutSec({}), 5400);
	assert.equal(timeoutSec({ BENCH_TIMEOUT: "60" }), 60);
});

test("paths: bench data under ~/.pi/agent/bench, workdir under the runtime dir, both overridable", () => {
	const p = resolvePaths({ HOME: "/h", XDG_RUNTIME_DIR: "/run/u" }, "/pkg");
	assert.equal(p.data, "/h/.pi/agent/bench");
	assert.equal(p.work, "/run/u/pi/tmp/bench");
	assert.equal(p.extDir, "/h/.pi/agent/extensions");
	assert.equal(p.probeExt, "/pkg/probe");
	assert.equal(p.shimBin, "/pkg/bin");
	const q = resolvePaths({ HOME: "/h", PI_BENCH_DATA: "/d", PI_BENCH_WORK: "/w", PI_BENCH_EXT_DIR: "/e" }, "/pkg");
	assert.deepEqual([q.data, q.work, q.extDir], ["/d", "/w", "/e"]);
});

test("devenv shim is selected only for tasks whose check needs devenv", () => {
	assert.equal(needsDevenvShim({ kind: "large", gitdir: "", base: "", prompt: "", check: "devenv shell -- just verify" }), true);
	assert.equal(needsDevenvShim({ kind: "large", gitdir: "", base: "", prompt: "", check: "nix flake check" }), false);
	assert.equal(needsDevenvShim({ kind: "scout", gitdir: "", base: "", prompt: "", check: null }), false);
	const p = resolvePaths({ HOME: "/h", PI_BENCH_WORK: "/w" }, "/pkg");
	const withShim = runEnv({ PATH: "/usr/bin" }, p, true, "/w/runs/x/tmp");
	assert.equal(withShim.PATH, "/pkg/bin:/usr/bin");
	assert.equal(withShim.XDG_CACHE_HOME, "/w/cache");
	assert.equal(withShim.XDG_DATA_HOME, "/w/data");
	assert.equal(withShim.TMPDIR, "/w/runs/x/tmp");
	assert.equal(runEnv({ PATH: "/usr/bin" }, p, false, "/t").PATH, "/usr/bin");
});

function benchEnv() {
	const paths = resolvePaths({ HOME: tmp(), PI_BENCH_DATA: tmp(), PI_BENCH_WORK: tmp(), PI_BENCH_EXT_DIR: "/ext" }, "/pkg");
	return paths;
}

test("runOne: result.json shape, saved prompt/final/diff/check, native retry in the checkout", async () => {
	const repo = sourceRepo();
	const paths = benchEnv();
	const log = join(tmp(), "log");
	const task = taskFor(repo);
	const res = await runOne({ id: "T1", task, arm: "sonnet", rep: 1, paths, piBin: fakePrintPi(log), env: { PATH: process.env.PATH! }, timeoutSec: 60 });
	const R = join(paths.data, "runs/T1.sonnet.1");
	const onDisk = JSON.parse(readFileSync(join(R, "result.json"), "utf8"));
	assert.deepEqual(onDisk, res);
	assert.deepEqual(Object.keys(res).sort(), ["arm", "baseSha", "checkExit", "checkSec", "filesChanged", "id", "model", "piexit", "rep", "think", "wallSec"]);
	assert.equal(res.piexit, 0);
	assert.equal(res.checkExit, 0);
	assert.equal(res.filesChanged, 1);
	assert.equal(res.model, "anthropic/claude-sonnet-5-5");
	assert.equal(res.think, "high");
	assert.match(readFileSync(join(R, "final.md"), "utf8"), /final report/);
	assert.match(readFileSync(join(R, "prompt.md"), "utf8"), /## Task\nChange a\.txt\./);
	const diff = readFileSync(join(R, "diff.patch"), "utf8");
	assert.match(diff, /changed\.txt/);
	assert.doesNotMatch(diff, /\.pi\/settings/);
	assert.ok(existsSync(join(R, "check.log")));
	const args = readFileSync(log + ".args", "utf8").split("\n");
	assert.ok(args.includes("-ne") && args.includes("--approve"));
	assert.ok(readFileSync(log + ".cwd", "utf8").trim().endsWith("/runs/T1.sonnet.1/work"));
});

test("runOne: scouts run no check and report checkExit null; failing check is recorded", async () => {
	const repo = sourceRepo();
	const paths = benchEnv();
	const pi = fakePrintPi(join(tmp(), "log"));
	const env = { PATH: process.env.PATH! };
	const scout = await runOne({ id: "X", task: taskFor(repo, { kind: "scout", check: "false" }), arm: "qwenl", rep: 1, paths, piBin: pi, env, timeoutSec: 60 });
	assert.equal(scout.checkExit, null);
	const bad = await runOne({ id: "B", task: taskFor(repo, { check: "exit 3" }), arm: "qwenl", rep: 2, paths, piBin: pi, env, timeoutSec: 60 });
	assert.equal(bad.checkExit, 3);
	assert.equal(bad.rep, 2);
});

test("runOne: a run over the time limit is killed and reports piexit 124", async () => {
	const repo = sourceRepo();
	const paths = benchEnv();
	const slow = script("#!/bin/sh\nsleep 30\n");
	const t0 = Date.now();
	const res = await runOne({ id: "S", task: taskFor(repo), arm: "qwenl", rep: 1, paths, piBin: slow, env: { PATH: process.env.PATH! }, timeoutSec: 1, killGraceSec: 1 });
	assert.equal(res.piexit, 124);
	assert.ok(Date.now() - t0 < 10_000);
});

test("runOne: unknown arm is an error before anything is created", async () => {
	const repo = sourceRepo();
	const paths = benchEnv();
	await assert.rejects(runOne({ id: "U", task: taskFor(repo), arm: "nope", rep: 1, paths, piBin: "pi", env: {}, timeoutSec: 1 }), /unknown arm/);
	assert.equal(existsSync(join(paths.data, "runs/U.nope.1")), false);
});
