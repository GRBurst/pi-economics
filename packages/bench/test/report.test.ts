import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sessionMetrics } from "../src/metrics.ts";
import { agreement, buildReport, loadRows, renderReport, type Row } from "../src/report.ts";
import { resolvePaths } from "../src/config.ts";
import { tmp } from "./helpers.ts";

const jl = (f: string, lines: unknown[]) => {
	mkdirSync(join(f, ".."), { recursive: true });
	writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
};
const asst = (over: Record<string, unknown> = {}, content: unknown[] = []) => ({
	type: "message",
	message: { role: "assistant", stopReason: "stop", content, usage: { input: 100, cacheRead: 900, cacheWrite: 0, output: 50, cost: { total: 0.01 } }, ...over },
});

test("sessionMetrics: tokens, cost, peak context, retried 429s as errors, folds, edits, child sessions", () => {
	const dir = tmp();
	jl(join(dir, "main.jsonl"), [
		{ type: "session" },
		asst({}, [{ type: "toolCall", name: "edit" }, { type: "toolCall", name: "context_fold" }, { type: "toolCall", name: "bash" }]),
		asst({ stopReason: "error", usage: { input: 10, cacheRead: 0, cacheWrite: 0, output: 0, cost: { total: 0 } } }),
		asst({ usage: { input: 50, cacheRead: 2000, cacheWrite: 450, output: 10, cost: { total: 0.02 } } }),
		{ type: "custom", customType: "pi-retry:started" },
		{ type: "message", message: { role: "user", content: [] } },
	]);
	jl(join(dir, "subagents/abc/1_child.jsonl"), [asst({}, [{ type: "toolCall", name: "write" }])]);
	const m = sessionMetrics(dir);
	assert.equal(m.req, 4);
	assert.equal(m.errors, 1);
	assert.equal(m.peakCtx, 2500);
	assert.equal(m.folds, 1);
	assert.equal(m.edits, 2);
	assert.equal(m.toolCalls, 4);
	assert.equal(m.retryEvents, 1);
	assert.equal(m.childSessions, 1);
	assert.equal(m.costUsd, 0.04);
	assert.deepEqual(m.stopReasons, { stop: 3, error: 1 });
	assert.equal(sessionMetrics(join(dir, "missing")).req, 0);
});

// --- fixture bench dir -------------------------------------------------------------------------

const cand = (verdict: string) => ({ correct: 3, scope: 2, quality: 3, verdict, requirements: [], notes: "" });
function fixture() {
	const paths = resolvePaths({ HOME: tmp(), PI_BENCH_DATA: tmp(), PI_BENCH_WORK: tmp() }, "/pkg");
	const D = paths.data;
	const tasks = { S1: { kind: "small" }, S2: { kind: "small" }, L1: { kind: "large" }, X1: { kind: "scout" } };
	writeFileSync(join(D, "tasks.json"), JSON.stringify(tasks));
	// [arm, wallSec, checkExit, session cost]
	const runs: Record<string, [number, number | null, number]> = {
		"S1.qwen": [600, 0, 0], "S1.sonnet": [300, 0, 0.5], "S2.qwen": [900, 0, 0], "S2.sonnet": [400, 0, 0.6],
		"L1.qwen": [3000, 1, 0], "L1.sonnet": [2000, 0, 3], "X1.qwen": [200, null, 0], "X1.sonnet": [100, null, 0.2],
	};
	for (const [k, [wall, check, cost]] of Object.entries(runs)) {
		const [id, arm] = k.split(".");
		const R = join(D, "runs", `${k}.1`);
		mkdirSync(R, { recursive: true });
		writeFileSync(join(R, "result.json"), JSON.stringify({ id, arm, rep: 1, model: "m", think: "high", piexit: 0, checkExit: check, wallSec: wall, checkSec: 0, filesChanged: 1, baseSha: "x" }));
		jl(join(R, "session/s.jsonl"), [asst({ usage: { input: 1, cacheRead: 0, cacheWrite: 0, output: 1, cost: { total: cost } } })]);
	}
	// judges: verdicts by arm (de-blinded files); opus and gpt disagree on S2 qwen and L1 sonnet
	const verdicts: Record<string, Record<string, [string, string]>> = {
		S1: { qwen: ["pass", "pass"], sonnet: ["pass", "pass"] },
		S2: { qwen: ["pass", "partial"], sonnet: ["pass", "pass"] },
		L1: { qwen: ["fail", "fail"], sonnet: ["pass", "partial"] },
		X1: { qwen: ["partial", "partial"], sonnet: ["pass", "pass"] },
	};
	for (const [id, arms] of Object.entries(verdicts))
		(["opus", "gpt"] as const).forEach((j, i) => {
			mkdirSync(join(D, "judge", id), { recursive: true });
			writeFileSync(join(D, "judge", id, `${j}.json`), JSON.stringify({ id, judge: j, map: { A: "qwen", B: "sonnet" },
				arms: Object.fromEntries(Object.entries(arms).map(([a, v]) => [a, { ...cand(v[i]), capped: false }])), preference: "tie" }));
		});
	return paths;
}

test("loadRows joins runs, session metrics, task kind and judge verdicts", () => {
	const rows = loadRows(fixture());
	assert.equal(rows.length, 8);
	const r = rows.find((x) => x.id === "S2" && x.arm === "qwen")!;
	assert.equal(r.kind, "small");
	assert.equal(r.wallMin, 15);
	assert.equal(r.pass, 0.5, "one of two judges says pass");
	assert.equal(r.score, 0.75, "pass 1, partial 0.5 → mean");
	assert.equal(rows.find((x) => x.id === "L1" && x.arm === "sonnet")!.costUsd, 3);
});

test("loadRows reads the pilot layout (verdict.<judge>.md + map.json) and applies the check cap", () => {
	const paths = fixture();
	const J = join(paths.data, "judge/S1");
	rmSync(join(J, "opus.json"));
	writeFileSync(join(J, "map.json"), JSON.stringify({ A: "sonnet", B: "qwen" }));
	const block = "```json\n" + JSON.stringify({ A: cand("pass"), B: cand("pass"), preference: "A" }) + "\n```";
	writeFileSync(join(J, "verdict.opus.md"), "text\n" + block);
	// qwen's run in S1 gets a failing check
	const rf = join(paths.data, "runs/S1.qwen.1/result.json");
	writeFileSync(rf, JSON.stringify({ ...JSON.parse(readFileSync(rf, "utf8")), checkExit: 2 }));
	const rows = loadRows(paths);
	assert.equal(rows.find((x) => x.id === "S1" && x.arm === "qwen")!.verdicts.opus, "partial", "capped by the failing check");
	assert.equal(rows.find((x) => x.id === "S1" && x.arm === "sonnet")!.verdicts.opus, "pass");
});

test("loadRows: per-run layout judge/<id>/<run>/<judge>.json (any rep), overriding the pairwise records", () => {
	const paths = fixture();
	const D = paths.data;
	// per-run record for S1.qwen.1: opus says partial where the pairwise record says pass
	mkdirSync(join(D, "judge/S1/S1.qwen.1"), { recursive: true });
	writeFileSync(join(D, "judge/S1/S1.qwen.1/opus.json"), JSON.stringify({ id: "S1", run: "S1.qwen.1", arm: "qwen", rep: 1, judge: "opus", ...cand("partial"), capped: false }));
	// a rep-2 run judged per-run by both judges
	const R = join(D, "runs/S1.qwen.2");
	mkdirSync(R, { recursive: true });
	writeFileSync(join(R, "result.json"), JSON.stringify({ id: "S1", arm: "qwen", rep: 2, model: "m", think: "high", piexit: 0, checkExit: 0, wallSec: 600, checkSec: 0, filesChanged: 1, baseSha: "x" }));
	jl(join(R, "session/s.jsonl"), [asst({ usage: { input: 1, cacheRead: 0, cacheWrite: 0, output: 1, cost: { total: 0 } } })]);
	mkdirSync(join(D, "judge/S1/S1.qwen.2"), { recursive: true });
	for (const j of ["opus", "gpt"])
		writeFileSync(join(D, `judge/S1/S1.qwen.2/${j}.json`), JSON.stringify({ id: "S1", run: "S1.qwen.2", arm: "qwen", rep: 2, judge: j, ...cand("fail"), capped: false }));
	const rows = loadRows(paths);
	assert.equal(rows.length, 9);
	const r1 = rows.find((x) => x.run === "S1.qwen.1")!;
	assert.equal(r1.verdicts.opus, "partial", "per-run record wins over the pairwise record");
	assert.equal(r1.verdicts.gpt, "pass", "pairwise record still used for the other judge");
	assert.equal(r1.score, 0.75);
	const r2 = rows.find((x) => x.run === "S1.qwen.2")!;
	assert.deepEqual(r2.verdicts, { opus: "fail", gpt: "fail" }, "a rep-2 run gets per-run verdicts");
	assert.equal(r2.score, 0);
});

test("agreement: per-candidate Cohen's kappa between two judges", () => {
	const rows = loadRows(fixture());
	const a = agreement(rows, "opus", "gpt");
	assert.equal(a.n, 8);
	// 6 of 8 agree: po = .75; opus pass×5/partial×1/fail×... computed from the fixture
	const labels = rows.map((r) => [r.verdicts.opus, r.verdicts.gpt]);
	assert.equal(labels.filter(([x, y]) => x === y).length, 6);
	assert.ok(a.kappa > 0 && a.kappa < 1);
	assert.equal(a.agree, 6);
});

test("buildReport: per-factor bootstrap CIs, arm contrast, interaction OLS, agreement", () => {
	const rows: Row[] = loadRows(fixture());
	const rep = buildReport(rows, { factors: ["arm", "kind"], seed: 1, iters: 500 });
	const arm = rep.factors.find((f) => f.factor === "arm")!;
	const sonnet = arm.levels.find((l) => l.level === "sonnet")!;
	const qwen = arm.levels.find((l) => l.level === "qwen")!;
	assert.equal(sonnet.n, 4);
	assert.ok(sonnet.metrics.pass.mean > qwen.metrics.pass.mean);
	assert.ok(sonnet.metrics.wallMin.mean < qwen.metrics.wallMin.mean);
	assert.ok(sonnet.metrics.costUsd.mean > qwen.metrics.costUsd.mean);
	const c = arm.contrasts.find((x) => x.level === "sonnet" && x.vs === "qwen")!;
	assert.ok(c.score.mean > 0);
	assert.ok(rep.ols.terms.some((t) => t.name === "arm=sonnet:kind=small"));
	assert.equal(rep.ols.outcome, "score");
	assert.equal(rep.agreement.n, 8);
});

test("renderReport: markdown tables for factors, contrasts, OLS and kappa", () => {
	const rows = loadRows(fixture());
	const md = renderReport(buildReport(rows, { factors: ["arm", "kind"], seed: 1, iters: 200 }));
	for (const s of ["# Bench report", "## arm", "## kind", "| level |", "95% CI", "arm=sonnet:kind=small", "Cohen's κ", "## Interactions"]) assert.ok(md.includes(s), s);
});
