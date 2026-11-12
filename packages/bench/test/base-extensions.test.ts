// The consumer's own extensions: PI_BENCH_BASE_EXTENSIONS, loaded by every run (every arm, an orchestrator and its
// children, every judge), and PI_BENCH_ORCH_EXTENSIONS, loaded by the orchestrator factor arms and their children
// only. The bench's arms name only the flake's own extensions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultArms, resolvePaths } from "../src/config.ts";
import { printArgs } from "../src/driver-print.ts";
import { rpcArgs } from "../src/driver-rpc.ts";
import { extensionsOf } from "../src/extensions.ts";
import { runJudge, runSingleJudge } from "../src/judge.ts";
import { CHILD_EXTENSIONS, materializeAgentDir, ORCH_EXTENSIONS, orchArms } from "../src/orch.ts";
import { makeRefs } from "../src/refs.ts";
import { loadRows } from "../src/report.ts";
import { runOne } from "../src/run.ts";
import { fakePrintPi, fakeRpcPi, script, sourceRepo, tmp } from "./helpers.ts";
import { cand, cliRun, judgeBench, OLD_QWEN } from "./q-fixtures.ts";

/** The extensions the bench names itself (modules/bench.nix, the default of `bench.extensions`: the flake's own and the registry's `actor-subagents`, `task-router`). */
const OWN = ["actor-subagents", "infinite-context", "pi-retry", "task-router", "token-meter"];

const env = (base?: string, orch?: string): Record<string, string> => ({
	...(base === undefined ? {} : { PI_BENCH_BASE_EXTENSIONS: base }),
	...(orch === undefined ? {} : { PI_BENCH_ORCH_EXTENSIONS: orch }),
});
const paths = (base?: string, orch?: string) =>
	resolvePaths({ HOME: tmp(), PI_BENCH_DATA: tmp(), PI_BENCH_WORK: tmp(), PI_BENCH_EXT_DIR: "/ext", ...env(base, orch) }, "/pkg");
/** The names after each `-e`, in order, without the extension directory. */
const loaded = (args: string[]) => args.flatMap((a, i) => (args[i - 1] === "-e" ? [a.replace(/^\/ext\//, "")] : []));

test("resolvePaths: both lists are comma-separated, entries trimmed, empty ones dropped; unset or empty is none", () => {
	const none = resolvePaths({ HOME: "/h" }, "/pkg");
	assert.deepEqual([none.baseExtensions, none.orchExtensions], [[], []]);
	const empty = resolvePaths({ HOME: "/h", PI_BENCH_BASE_EXTENSIONS: "", PI_BENCH_ORCH_EXTENSIONS: "" }, "/pkg");
	assert.deepEqual([empty.baseExtensions, empty.orchExtensions], [[], []]);
	const set = resolvePaths({ HOME: "/h", PI_BENCH_BASE_EXTENSIONS: " auth-ext,log-ext,, ", PI_BENCH_ORCH_EXTENSIONS: "search-ext ," }, "/pkg");
	assert.deepEqual([set.baseExtensions, set.orchExtensions], [["auth-ext", "log-ext"], ["search-ext"]]);
});

test("extensionsOf: the base names first, then the list's own, then the extras; the first occurrence of a name wins", () => {
	assert.deepEqual(extensionsOf(["infinite-context", "auth-ext"], ["auth-ext"], ["search-ext"]), ["auth-ext", "infinite-context", "search-ext"]);
	assert.deepEqual(extensionsOf(["a", "b", "a"], []), ["a", "b"]);
	assert.deepEqual(extensionsOf([], ["s", "s"], ["s", "t"]), ["s", "t"]);
});

test("the arms, the orchestrator's and the children's lists name only the flake's own extensions", () => {
	for (const [name, arm] of Object.entries(defaultArms())) assert.deepEqual(arm.extensions.filter((e) => !OWN.includes(e)), [], name);
	assert.deepEqual(ORCH_EXTENSIONS, ["actor-subagents", "infinite-context", "pi-retry", "token-meter", "task-router"]);
	assert.deepEqual(CHILD_EXTENSIONS, ["infinite-context", "pi-retry", "token-meter"]);
	assert.deepEqual(defaultArms().sonnet.extensions, ["infinite-context"]);
	assert.deepEqual(defaultArms().orch.extensions, ["infinite-context", "actor-subagents"]);
});

test("print arms load the base extensions first, then their own, and never the orchestrator's extras", () => {
	const arms = defaultArms();
	const p = paths("auth-ext", "search-ext");
	assert.deepEqual(loaded(printArgs(arms.sonnet, p, "/s", "P")), ["auth-ext", "infinite-context"]);
	assert.deepEqual(loaded(printArgs(arms.qwenl, p, "/s", "P")), ["auth-ext", "infinite-context"]);
	assert.deepEqual(loaded(printArgs(arms.sonnet, paths(), "/s", "P")), ["infinite-context"], "no base: an anthropic arm loads only its own");
	assert.deepEqual(loaded(printArgs(OLD_QWEN, paths("auth-ext"), "/s", "P")), ["auth-ext", "infinite-context"], "an old arm that names a base extension loads it once");
});

test("orchestrator factor arms: base, then the orchestrator's list, then the extras, then the probe; the smoke orch arm (no factors) gets no extras", () => {
	const p = paths("auth-ext", "search-ext");
	for (const [id, arm] of Object.entries(orchArms()))
		assert.deepEqual(loaded(rpcArgs(arm, p, "/s")), ["auth-ext", ...ORCH_EXTENSIONS, "search-ext", "/pkg/probe"], id);
	assert.deepEqual(loaded(rpcArgs(defaultArms().orch, p, "/s")), ["auth-ext", "infinite-context", "actor-subagents", "/pkg/probe"]);
});

/** A fake ~/.pi/agent with both AGENTS.md variants. */
function agentSrc(): string {
	const home = tmp();
	mkdirSync(join(home, ".pi/agent/notes"), { recursive: true });
	writeFileSync(join(home, ".pi/agent/AGENTS.md"), "on\n");
	writeFileSync(join(home, ".pi/agent/notes/2026-10-03-AGENTS.md.before"), "off\n");
	return home;
}

test("materializeAgentDir: the children load the base extensions, their own list, then the orchestrator's extras", () => {
	const p = resolvePaths({ HOME: agentSrc(), PI_BENCH_EXT_DIR: "/ext", ...env("auth-ext", "search-ext") }, "/pkg");
	const dir = join(tmp(), "agent");
	materializeAgentDir({ dir, arm: orchArms()["orch----"], paths: p });
	assert.deepEqual(JSON.parse(readFileSync(join(dir, "actor-subagents/settings.json"), "utf8")).childExtensions,
		["auth-ext", ...CHILD_EXTENSIONS, "search-ext"].map((e) => `/ext/${e}`));
});

test("runOne: a factor arm's parent and children get the extras, a print arm does not", async () => {
	const repo = sourceRepo();
	const p = resolvePaths({ HOME: agentSrc(), PI_BENCH_DATA: tmp(), PI_BENCH_WORK: tmp(), PI_BENCH_EXT_DIR: "/ext", ...env("auth-ext", "search-ext") }, "/pkg");
	const task = { kind: "small", gitdir: repo.gitdir, sub: "proj", base: repo.base, prompt: "p", check: "true" };
	const runEnv = { PATH: process.env.PATH! };
	const rpcPi = fakeRpcPi(`emit({ type: "agent_start" }); probe(0); say("done"); emit({ type: "agent_settled" });`);
	await runOne({ id: "O", task, arm: "orch-++-", rep: 1, paths: p, piBin: rpcPi, env: runEnv, timeoutSec: 20, killGraceSec: 1, quietMs: 200 });
	const R = join(p.data, "runs/O.orch-++-.1");
	assert.deepEqual(loaded(readFileSync(join(R, "probe.json.args"), "utf8").split("\n")), ["auth-ext", ...ORCH_EXTENSIONS, "search-ext", "/pkg/probe"]);
	const children = JSON.parse(readFileSync(join(R, "agent/actor-subagents/settings.json"), "utf8")).childExtensions;
	assert.deepEqual(children, ["auth-ext", ...CHILD_EXTENSIONS, "search-ext"].map((e) => `/ext/${e}`));
	const log = join(tmp(), "plog");
	await runOne({ id: "O", task, arm: "sonnet", rep: 1, paths: p, piBin: fakePrintPi(log), env: runEnv, timeoutSec: 20 });
	assert.deepEqual(loaded(readFileSync(log + ".args", "utf8").split("\n")), ["auth-ext", "infinite-context"]);
});

const FAKE_SINGLE = "```json\n" + JSON.stringify(cand("pass")) + "\n```";
const FAKE_PAIR = "```json\n" + JSON.stringify({ A: cand("pass"), B: cand("partial"), preference: "A", preferenceReason: "r" }) + "\n```";

test("judges load the base extensions, each once, and nothing else (not the orchestrator's extras); without a base, none", async () => {
	for (const [base, want] of [["auth-ext", ["auth-ext"]], ["auth-ext,log-ext,auth-ext", ["auth-ext", "log-ext"]], [undefined, []]] as [string | undefined, string[]][]) {
		const p = paths(base, "search-ext");
		const repo = sourceRepo();
		const task = { kind: "small", gitdir: repo.gitdir, sub: "proj", base: repo.base, refs: [repo.next], prompt: "p", check: "true" };
		writeFileSync(join(p.data, "tasks.json"), JSON.stringify({ J: task }));
		makeRefs({ J: task }, p.data);
		const runEnv = { PATH: process.env.PATH! };
		const agent = fakePrintPi(join(tmp(), "alog"));
		for (const arm of ["qwenl", "sonnet"]) await runOne({ id: "J", task, arm, rep: 1, paths: p, piBin: agent, env: runEnv, timeoutSec: 30 });
		const log = join(tmp(), "jlog");
		const judge = (answer: string) => script(`#!/bin/sh\nprintf '%s\\n' "$@" > ${log}.args\ncat >/dev/null\ncat <<'EOF'\n${answer}\nEOF\n`);
		const args = () => readFileSync(`${log}.args`, "utf8").trim().split("\n");
		await runJudge({ id: "J", judge: "opus", x: "qwenl", y: "sonnet", paths: p, piBin: judge(FAKE_PAIR), env: runEnv, rng: () => 0.1, timeoutSec: 30 });
		assert.deepEqual(loaded(args()), want, `pairwise, base ${base}`);
		await runSingleJudge({ id: "J", run: "J.sonnet.1", judge: "opus", paths: p, piBin: judge(FAKE_SINGLE), env: runEnv, timeoutSec: 30 });
		assert.deepEqual(loaded(args()), want, `per run, base ${base}`);
	}
});

test("an old run whose arm named a consumer extension (auth-ext) still runs, reports and judges, with or without the base list", () => {
	for (const base of [undefined, "auth-ext"]) {
		const b = judgeBench(["qwen", "sonnet"], env(base, "search-ext"));
		assert.deepEqual(loaded(b.args("qwen")), base ? ["auth-ext", "infinite-context"] : ["infinite-context", "auth-ext"], `base ${base}`);
		assert.deepEqual(loaded(b.args("sonnet")), [...(base ? ["auth-ext"] : []), "infinite-context"], `base ${base}`);
		cliRun(b.env, "judge", "T", "opus", "qwen", "sonnet");
		assert.deepEqual(b.judged("opus"), ["qwen", "sonnet"]);
		const rows = loadRows(resolvePaths({ HOME: tmp(), PI_BENCH_DATA: b.data }, "/pkg"));
		assert.deepEqual(rows.map((r) => r.arm), ["qwen", "sonnet"]);
		assert.ok(rows.every((r) => r.verdicts.opus), `every row has the opus verdict (base ${base})`);
	}
});

test("the usage names PI_BENCH_BASE_EXTENSIONS and PI_BENCH_ORCH_EXTENSIONS", () => {
	assert.throws(() => cliRun({ HOME: tmp() }, "bogus"), /PI_BENCH_BASE_EXTENSIONS/);
	assert.throws(() => cliRun({ HOME: tmp() }, "bogus"), /PI_BENCH_ORCH_EXTENSIONS/);
});
