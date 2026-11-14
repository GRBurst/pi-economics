// Process-scope levers of the bench (redesign §10, M9): a factor named for a pi process lever lands in the run's
// settings.json, the run's assignment is a file the experiments engine reads, a compaction arm loads no
// infinite-context unless it adds it, and the report reads the meter's compaction, overflow and levers lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePaths } from "../src/config.ts";
import { armExtensions } from "../src/extensions.ts";
import { assignmentOf, materializeAgentDir, orchArms } from "../src/orch.ts";
import { meterMetrics } from "../src/metrics.ts";
import { buildReport, loadRows, renderReport } from "../src/report.ts";
import { runOne } from "../src/run.ts";
import type { Arm } from "../src/types.ts";
import { fakeRpcPi, sourceRepo, tmp } from "./helpers.ts";

const json = (f: string) => JSON.parse(readFileSync(f, "utf8"));
const base = orchArms()["orch-+-+"];
const compaction = (over: Partial<Arm> = {}): Arm => ({ ...base, factors: { ...base.factors, "pi.compaction.reserveTokens": "8000" }, ...over });

function paths(extra: Record<string, string> = {}) {
	const home = tmp();
	mkdirSync(join(home, ".pi/agent/notes"), { recursive: true });
	writeFileSync(join(home, ".pi/agent/AGENTS.md"), "on\n");
	writeFileSync(join(home, ".pi/agent/notes/2026-10-03-AGENTS.md.before"), "off\n");
	return resolvePaths({ HOME: home, PI_BENCH_EXT_DIR: "/ext", PI_BENCH_DATA: tmp(), PI_BENCH_WORK: tmp(), ...extra }, "/pkg");
}
const run = (arm: Arm, name = "c1") => {
	const dir = join(tmp(), "agent");
	materializeAgentDir({ dir, arm, paths: paths(), name });
	return dir;
};

test("T9.1 a factor naming a pi process lever is written into the run's settings.json, typed; the router factors are untouched", () => {
	const s = json(join(run(compaction()), "settings.json"));
	assert.deepEqual(s.compaction, { reserveTokens: 8000 });
	assert.equal(s.defaultThinkingLevel, "high", "the run's other settings stay");
	const t = json(join(run({ ...base, factors: { ...base.factors, "pi.compaction.enabled": "true", "pi.compaction.keepRecentTokens": "5000" } }), "settings.json"));
	assert.deepEqual(t.compaction, { enabled: true, keepRecentTokens: 5000 });
	assert.equal(json(join(run(base), "settings.json")).compaction, undefined, "no process lever, no key");
});

test("T9.1 an unknown pi lever or a level that is no number/boolean is an error naming it", () => {
	assert.throws(() => run({ ...base, factors: { ...base.factors, "pi.nothing": "1" } }), /pi\.nothing/);
	assert.throws(() => run(compaction({ factors: { "pi.compaction.reserveTokens": "lots" } })), /pi\.compaction\.reserveTokens/);
	assert.throws(() => run(compaction({ factors: { "pi.compaction.enabled": "5" } })), /pi\.compaction\.enabled/);
});

test("T9.2 the run's assignment file: v 1, a 12-hex design id, stratum bench, the arm's name, factors with their levers and typed levels", () => {
	const dir = run(compaction(), "orch-compact");
	const a = json(join(dir, "experiments/assignment.json"));
	assert.deepEqual(Object.keys(a), ["v", "design", "stratum", "arm", "factors"]);
	assert.equal(a.v, 1);
	assert.match(a.design, /^[0-9a-f]{12}$/);
	assert.equal(a.stratum, "bench");
	assert.equal(a.arm, "orch-compact");
	assert.deepEqual(a.factors, {
		routing: { lever: "task-router.routing", assigned: "on" },
		delegation: { lever: "task-router.delegation", assigned: "off" },
		t0Widened: { lever: "task-router.t0Widened", assigned: "on" },
		"pi.compaction.reserveTokens": { lever: "pi.compaction.reserveTokens", assigned: 8000 },
	});
	assert.deepEqual(json(join(dir, "experiments/settings.json")), { mode: "off" }, "the opt-in; the engine draws nothing");
	assert.notEqual(a.design, json(join(run(base, "orch-+-+"), "experiments/assignment.json")).design, "another set of levers, another design");
});

test("T9.2 the same factors give the same design id in every arm (the arm name is no part of it)", () => {
	const x = json(join(run(orchArms()["orch----"], "orch----"), "experiments/assignment.json"));
	const y = json(join(run(orchArms()["orch-++-"], "orch-++-"), "experiments/assignment.json"));
	assert.equal(x.design, y.design);
	assert.notEqual(x.arm, y.arm);
});

test("T9.5 a compaction arm loads no infinite-context in the main or the children, whichever list names it; experiments joins last", () => {
	const p = paths();
	const mainOf = (arm: Arm, q = p) => armExtensions(arm, q);
	assert.deepEqual(mainOf(compaction()), ["actor-subagents", "token-meter", "task-router", "experiments"]);
	assert.ok(mainOf(base).includes("infinite-context") && !mainOf(base).includes("experiments"), "other orch arms are unchanged");
	const children = (arm: Arm, q = p) => {
		const dir = join(tmp(), "agent");
		materializeAgentDir({ dir, arm, paths: q, name: "c" });
		return json(join(dir, "actor-subagents/settings.json")).childExtensions as string[];
	};
	assert.deepEqual(children(compaction()), ["/ext/token-meter", "/ext/experiments"]);
	assert.deepEqual(children(base), ["/ext/infinite-context", "/ext/token-meter"]);
	// Review m1: the consumer's lists (PI_BENCH_BASE_EXTENSIONS, PI_BENCH_ORCH_EXTENSIONS) may name it too.
	const q = paths({ PI_BENCH_BASE_EXTENSIONS: "infinite-context,auth-ext", PI_BENCH_ORCH_EXTENSIONS: "infinite-context,search-ext" });
	assert.deepEqual(mainOf(compaction(), q), ["auth-ext", "actor-subagents", "token-meter", "task-router", "search-ext", "experiments"]);
	assert.deepEqual(children(compaction(), q), ["/ext/auth-ext", "/ext/token-meter", "/ext/search-ext", "/ext/experiments"]);
	assert.ok(mainOf(base, q).includes("infinite-context"), "an arm without a process lever keeps what the lists name");
});

test("review m1 an arm that asks for infinite-context with a compaction lever is refused with an error naming both (IC cancels compaction)", () => {
	const bad = compaction({ ic: true });
	assert.throws(() => armExtensions(bad, paths()), /infinite-context.*compaction|compaction.*infinite-context/);
	assert.throws(() => run(bad), /infinite-context/);
});

test("T9.4 a run's meter lines: compactions, context overflows, active time and the pe levers read back", () => {
	const dir = tmp();
	mkdirSync(join(dir, "meter"));
	const L = [
		{ v: 2, kind: "turn", sessionId: "m", status: 200, costUsd: 0.1, durationMs: 60000 },
		{ v: 2, kind: "compaction", sessionId: "m", status: 200, costUsd: 0.05 },
		{ v: 2, kind: "turn", sessionId: "m", status: "error", errorKind: "context_overflow", durationMs: 1000 },
		{ v: 2, kind: "turn", sessionId: "c", parentSessionId: "m", status: 200, costUsd: 0.2, durationMs: 30000 },
		{ v: 2, kind: "levers", sessionId: "m", eligible: true, levers: { "pi.compaction.reserveTokens": { v: 4000, s: "fixed" } } },
		{ v: 2, kind: "levers", sessionId: "m", eligible: true, levers: { "pi.compaction.reserveTokens": { v: 8000, s: "pe", a: 8000, rb: "confirmed", tier: "seed" }, "pi.compaction.enabled": { v: true, s: "fixed" } } },
	];
	writeFileSync(join(dir, "meter", "2026-11.jsonl"), L.map((l) => JSON.stringify(l)).join("\n") + "\nnot json\n");
	const m = meterMetrics(dir);
	assert.deepEqual({ ...m, costUsd: +m.costUsd.toFixed(2) }, { requests: 4, costUsd: 0.35, compactions: 1, overflows: 1, activeMin: 1.52, confirmed: 1, refused: 0, pe: { "pi.compaction.reserveTokens": 8000 } });
	assert.deepEqual(meterMetrics(join(dir, "none")), { requests: 0, costUsd: 0, compactions: 0, overflows: 0, activeMin: 0, confirmed: 0, refused: 0, pe: {} });
});

test("T9.6 the report rows carry the meter's figures and a process-lever section appears only for runs that have them", () => {
	const p = paths();
	const runDir = join(p.data, "runs/T.orch-compact.1");
	mkdirSync(join(runDir, "agent/meter"), { recursive: true });
	writeFileSync(join(p.data, "tasks.json"), JSON.stringify({ T: { kind: "small" } }));
	writeFileSync(join(runDir, "result.json"), JSON.stringify({ id: "T", arm: "orch-compact", rep: 1, model: "m", think: "high", piexit: 0, checkExit: 0, wallSec: 60, checkSec: 1, filesChanged: 1, baseSha: "x" }));
	writeFileSync(join(p.data, "arms.json"), JSON.stringify({ "orch-compact": compaction() }));
	writeFileSync(join(runDir, "agent/meter/2026-11.jsonl"), [
		{ v: 2, kind: "turn", sessionId: "m", status: 200, costUsd: 0.1, durationMs: 60000 },
		{ v: 2, kind: "compaction", sessionId: "m", status: 200, costUsd: 0.05 },
		{ v: 2, kind: "levers", sessionId: "m", eligible: true, levers: { "pi.compaction.reserveTokens": { v: 8000, s: "pe", a: 8000, rb: "confirmed", tier: "seed" } } },
	].map((l) => JSON.stringify(l)).join("\n") + "\n");
	const rows = loadRows(p);
	assert.equal(rows[0].compactions, 1);
	assert.equal(rows[0].overflows, 0);
	assert.equal(rows[0].activeMin, 1);
	assert.equal(rows[0].meterCostUsd, 0.15);
	assert.equal(rows[0]["pi.compaction.reserveTokens"], "8000");
	const md = renderReport(buildReport(rows, { factors: ["arm"], iters: 20 }));
	assert.ok(md.includes("## Process levers"));
	assert.ok(md.includes("| orch-compact | 1 | 1 | 0 | 1 | 1 | 0 |"), md);
	assert.ok(md.includes("Local cost (active time × rate) is not computed here"));
	const plain = renderReport(buildReport([{ ...rows[0], compactions: undefined, activeMin: undefined }], { factors: ["arm"], iters: 20 }));
	assert.equal(plain.includes("## Process levers"), false, "a bench without meter figures reports as before");
});

/** An extension directory that links experiments (the registry of a host with experiments.enable). */
const extWithExperiments = () => {
	const dir = tmp();
	writeFileSync(join(dir, "experiments"), "");
	return dir;
};

test("review m6 a process arm whose extension directory lacks the experiments link fails before the run, naming it; other arms are not asked", async () => {
	const p = paths({ PI_BENCH_EXT_DIR: tmp() });
	writeFileSync(join(p.data, "arms.json"), JSON.stringify({ "orch-compact": compaction() }));
	const repo = sourceRepo();
	const task = { kind: "small", gitdir: repo.gitdir, sub: "proj", base: repo.base, prompt: "p", check: "true" };
	const o = { id: "T", task, rep: 1, paths: p, piBin: "/nonexistent/pi", env: { PATH: process.env.PATH! }, timeoutSec: 20, killGraceSec: 1, quietMs: 200 };
	await assert.rejects(runOne({ ...o, arm: "orch-compact" }), /experiments.*programs\.piEconomics\.experiments\.enable|experiments.*link/);
	assert.equal(existsSync(join(p.data, "runs/T.orch-compact.1/agent")), false, "nothing was written before the check");
});

test("T9.2 runOne writes the assignment under the arm's name and the factor arm's extension list ends in experiments", async () => {
	const p = paths({ PI_BENCH_EXT_DIR: extWithExperiments() });
	writeFileSync(join(p.data, "arms.json"), JSON.stringify({ "orch-compact": compaction() }));
	const repo = sourceRepo();
	const task = { kind: "small", gitdir: repo.gitdir, sub: "proj", base: repo.base, prompt: "p", check: "true" };
	const pi = fakeRpcPi(`emit({ type: "agent_start" }); probe(0); say("done"); emit({ type: "agent_settled" });`);
	await runOne({ id: "T", task, arm: "orch-compact", rep: 1, paths: p, piBin: pi, env: { PATH: process.env.PATH! }, timeoutSec: 20, killGraceSec: 1, quietMs: 200 });
	const R = join(p.data, "runs/T.orch-compact.1");
	assert.equal(json(join(R, "agent/experiments/assignment.json")).arm, "orch-compact");
	const args = readFileSync(join(R, "probe.json.args"), "utf8").split("\n");
	assert.ok(args.includes(`${p.extDir}/experiments`) && !args.includes(`${p.extDir}/infinite-context`));
});

test("review m4 / m3 one experiment, one design id: the union of the factors and levels over every arm (the baseline included), however the arm is named", () => {
	const lo = compaction({ factors: { ...base.factors, "pi.compaction.reserveTokens": "4000" } });
	const hi = compaction();
	const plain = orchArms()["orch----"];
	const arms = { "orch----": plain, lo, hi };
	const id = (name: string, arm: Arm, all: Record<string, Arm> = arms) => (assignmentOf(name, arm, all) as { design: string }).design;
	assert.equal(id("orch----", plain), id("lo", lo));
	assert.equal(id("lo", lo), id("hi", hi));
	assert.notEqual(id("hi", hi), id("hi", hi, { hi }), "another arm set, another design (one level of the lever only)");
	assert.notEqual(id("hi", hi), id("hi", hi, { hi, lo: { ...lo, factors: { ...lo.factors, "pi.compaction.reserveTokens": "2000" } } }), "the levels are part of it");
	// the baseline's own file names only its own factors
	assert.deepEqual(Object.keys((assignmentOf("orch----", plain, arms) as { factors: object }).factors), ["routing", "delegation", "t0Widened"]);
	// three levels of a lever are fine (the id hashes lever ids and the sorted levels)
	const three = { ...arms, mid: compaction({ factors: { ...base.factors, "pi.compaction.reserveTokens": "6000" } }) };
	assert.match(id("mid", three.mid, three), /^[0-9a-f]{12}$/);
});

test("m3 runOne gives the arm's file the design of the whole arm set (arms.json)", async () => {
	const p = paths({ PI_BENCH_EXT_DIR: extWithExperiments() });
	writeFileSync(join(p.data, "arms.json"), JSON.stringify({ "orch-compact": compaction(), "orch-compact2": compaction({ factors: { ...base.factors, "pi.compaction.reserveTokens": "4000" } }) }));
	const repo = sourceRepo();
	const task = { kind: "small", gitdir: repo.gitdir, sub: "proj", base: repo.base, prompt: "p", check: "true" };
	const pi = fakeRpcPi(`emit({ type: "agent_start" }); probe(0); say("done"); emit({ type: "agent_settled" });`);
	const ids: string[] = [];
	for (const arm of ["orch-compact", "orch-compact2", "orch----"]) {
		await runOne({ id: "T", task, arm, rep: 1, paths: p, piBin: pi, env: { PATH: process.env.PATH! }, timeoutSec: 20, killGraceSec: 1, quietMs: 200 });
		ids.push(json(join(p.data, `runs/T.${arm}.1/agent/experiments/assignment.json`)).design);
	}
	assert.equal(new Set(ids).size, 1);
});
