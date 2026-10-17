import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildJudgePrompt, buildSingleJudgePrompt, capVerdict, deblind, JUDGES, loadOrCreateMap, parseSingle, parseVerdicts, runJudge, runSingleJudge } from "../src/judge.ts";
import { makeRefs } from "../src/refs.ts";
import { resolvePaths } from "../src/config.ts";
import { runOne } from "../src/run.ts";
import { fakePrintPi, script, sourceRepo, tmp } from "./helpers.ts";

// --- blind map ---------------------------------------------------------------------------------

test("blind map follows the rng, is written to map.json and never redrawn", () => {
	const f = join(tmp(), "judge/T1/map.json");
	assert.deepEqual(loadOrCreateMap(f, "qwen", "sonnet", () => 0.1), { A: "qwen", B: "sonnet" });
	assert.deepEqual(JSON.parse(readFileSync(f, "utf8")), { A: "qwen", B: "sonnet" });
	// the second judge of the same task gets the same blinding even if the draw would differ
	assert.deepEqual(loadOrCreateMap(f, "qwen", "sonnet", () => 0.9), { A: "qwen", B: "sonnet" });
	const g = join(tmp(), "map.json");
	assert.deepEqual(loadOrCreateMap(g, "qwen", "sonnet", () => 0.9), { A: "sonnet", B: "qwen" });
});

test("blind map is random: both orientations occur with the default rng", () => {
	const seen = new Set<string>();
	for (let i = 0; i < 60; i++) seen.add(JSON.stringify(loadOrCreateMap(join(tmp(), "m.json"), "x", "y")));
	assert.equal(seen.size, 2);
});

// --- rubric parse ------------------------------------------------------------------------------

const cand = (verdict: string) => ({ correct: 3, scope: 2, quality: 3, verdict, requirements: [{ req: "r", status: "met" }], notes: "n" });
const block = (o: unknown) => "```json\n" + JSON.stringify(o) + "\n```";

test("parseVerdicts takes the last fenced json block and checks the rubric shape", () => {
	const good = { A: cand("pass"), B: cand("Fail"), preference: "A", preferenceReason: "why" };
	const text = `Reasoning ${block({ example: true })}\nMore.\n${block(good)}\n`;
	const v = parseVerdicts(text)!;
	assert.equal(v.A.verdict, "pass");
	assert.equal(v.B.verdict, "fail", "case-insensitive");
	assert.equal(v.preference, "A");
	assert.equal(v.A.requirements[0].status, "met");
});

test("parseVerdicts rejects prose, broken json, unknown verdicts and bad preference", () => {
	assert.equal(parseVerdicts("no block at all"), null);
	assert.equal(parseVerdicts("```json\n{not json\n```"), null);
	assert.equal(parseVerdicts(block({ A: cand("pass"), B: cand("great"), preference: "A" })), null);
	assert.equal(parseVerdicts(block({ A: cand("pass"), preference: "A" })), null, "B missing");
	assert.equal(parseVerdicts(block({ A: cand("pass"), B: cand("pass"), preference: "C" })), null);
});

// --- check failure caps at partial -------------------------------------------------------------

test("a failing harness check caps pass at partial; other cases are untouched", () => {
	assert.deepEqual(capVerdict("pass", 1), { verdict: "partial", capped: true });
	assert.deepEqual(capVerdict("pass", 124), { verdict: "partial", capped: true });
	assert.deepEqual(capVerdict("pass", 0), { verdict: "pass", capped: false });
	assert.deepEqual(capVerdict("pass", null), { verdict: "pass", capped: false });
	assert.deepEqual(capVerdict("partial", 2), { verdict: "partial", capped: false });
	assert.deepEqual(capVerdict("fail", 2), { verdict: "fail", capped: false });
});

test("deblind maps A/B back to arms, applies the cap and maps the preference", () => {
	const v = parseVerdicts(block({ A: cand("pass"), B: cand("pass"), preference: "B", preferenceReason: "r" }))!;
	const by = deblind({ A: "sonnet", B: "qwen" }, v, { sonnet: 0, qwen: 1 });
	assert.equal(by.arms.sonnet.verdict, "pass");
	assert.equal(by.arms.qwen.verdict, "partial");
	assert.equal(by.arms.qwen.capped, true);
	assert.equal(by.preference, "qwen");
	assert.equal(deblind({ A: "a", B: "b" }, { ...v, preference: "tie" }, {}).preference, "tie");
});

// --- prompt ------------------------------------------------------------------------------------

test("judge prompt: rubric, cap rule, reference, both candidates, no arm names, truncation", () => {
	const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
	const p = buildJudgePrompt({
		kind: "small", task: "Do the thing.", refNote: "ref also touches lockfile",
		reference: { name: "patch", text: "REFDIFF" }, maxPatchLines: 10,
		A: { check: "check A: 0", report: "report A", patch: long },
		B: { check: "check B: 1", report: "report B", patch: "diff B" },
	});
	for (const s of ["strict, fair code reviewer", "correct (0-3)", "scope (0-2)", "quality (0-3)", "caps the verdict at partial", "```json",
		"Do the thing.", "REFDIFF", "ref also touches lockfile", "## Candidate A", "## Candidate B", "report A", "diff B", "[... truncated: 30 lines total"])
		assert.ok(p.includes(s), s);
	assert.ok(!p.includes("line 15"), "patch cut at 10 lines");
	assert.doesNotMatch(p, /qwen|sonnet|opus/i);
});

test("scout prompt names the reference as an answer and asks for answer-quality judgement", () => {
	const p = buildJudgePrompt({ kind: "scout", task: "Q?", reference: { name: "answer", text: "ANS" }, A: { check: "", report: "r", patch: "" }, B: { check: "", report: "r", patch: "" } });
	assert.match(p, /investigation tasks/);
	assert.match(p, /ANS/);
});

// --- references --------------------------------------------------------------------------------

test("makeRefs: patch tasks get base..last relative to sub (minus excludes), scouts copy their answer", () => {
	const repo = sourceRepo();
	const data = tmp();
	mkdirSync(join(data, "tasks/X"), { recursive: true });
	writeFileSync(join(data, "tasks/X/ref_answer.md"), "the answer\n");
	const tasks = {
		P: { kind: "small", gitdir: repo.gitdir, sub: "proj", base: repo.base, refs: [`${repo.base}..${repo.next}`], prompt: "p" },
		Q: { kind: "small", gitdir: repo.gitdir, sub: "proj", base: repo.base, refs: [repo.next], refExclude: ["b.txt"], prompt: "p" },
		X: { kind: "scout", gitdir: repo.gitdir, base: repo.base, ref_answer: "X", prompt: "p" },
	};
	makeRefs(tasks, data);
	const P = readFileSync(join(data, "refs/P.patch"), "utf8");
	assert.match(P, /diff --git a\/a\.txt b\/a\.txt/, "paths relative to sub");
	assert.match(P, /b\.txt/);
	assert.doesNotMatch(readFileSync(join(data, "refs/Q.patch"), "utf8"), /b\.txt/);
	assert.equal(readFileSync(join(data, "refs/X.md"), "utf8"), "the answer\n");
});

// --- end to end with fake agents and a fake judge ----------------------------------------------

const FAKE_JUDGE_VERDICT = block({ A: cand("pass"), B: cand("pass"), preference: "A", preferenceReason: "ok" });

test("runJudge: blind packet, prompt via stdin, read-only tools, capped result recorded", async () => {
	const repo = sourceRepo();
	const paths = resolvePaths({ HOME: tmp(), PI_BENCH_DATA: tmp(), PI_BENCH_WORK: tmp(), PI_BENCH_EXT_DIR: "/ext" }, "/pkg");
	const env = { PATH: process.env.PATH! };
	const task = { kind: "small", gitdir: repo.gitdir, sub: "proj", base: repo.base, refs: [repo.next], prompt: "Change a.txt.", check: "test -f changed.txt" };
	writeFileSync(join(paths.data, "tasks.json"), JSON.stringify({ J1: task }));
	makeRefs({ J1: task }, paths.data);
	const ok = fakePrintPi(join(tmp(), "log"));
	await runOne({ id: "J1", task, arm: "qwenl", rep: 1, paths, piBin: ok, env, timeoutSec: 30 });
	await runOne({ id: "J1", task: { ...task, check: "exit 1" }, arm: "sonnet", rep: 1, paths, piBin: ok, env, timeoutSec: 30 });

	const log = join(tmp(), "judgelog");
	const judgePi = script(`#!/bin/sh
printf '%s\\n' "$@" > ${log}.args
cat > ${log}.stdin
pwd > ${log}.cwd
echo 'I reasoned.'
cat <<'EOF'
${FAKE_JUDGE_VERDICT}
EOF
`);
	const rng = () => 0.9; // A = sonnet (y), B = qwenl (x)
	const res = await runJudge({ id: "J1", judge: "opus", x: "qwenl", y: "sonnet", paths, piBin: judgePi, env, rng, timeoutSec: 30 });

	const args = readFileSync(log + ".args", "utf8").split("\n");
	assert.equal(args[args.indexOf("--tools") + 1], "read,grep,find,ls");
	assert.ok(args.includes("-ne") && args.includes("-ns"));
	assert.ok(args.join(" ").includes("-e /ext/claude-auth"));
	assert.ok(args.includes(JUDGES.opus.model));
	assert.ok(!args.some((a) => a.includes("strict, fair code reviewer")), "prompt is not in argv");
	const stdin = readFileSync(log + ".stdin", "utf8");
	assert.match(stdin, /strict, fair code reviewer/);
	assert.match(stdin, /Change a\.txt\./);
	assert.doesNotMatch(stdin, /qwenl|sonnet/, "blind");
	const J = join(paths.data, "judge/J1");
	assert.ok(readFileSync(log + ".cwd", "utf8").trim().endsWith("/judge/J1/pkt"));
	for (const f of ["A.patch", "B.patch", "A.report.md", "B.check.txt", "reference.patch", "baseline/keep.txt"]) assert.ok(existsSync(join(J, "pkt", f)), f);
	assert.deepEqual(JSON.parse(readFileSync(join(J, "map.json"), "utf8")), { A: "sonnet", B: "qwenl" });
	assert.match(readFileSync(join(J, "verdict.opus.md"), "utf8"), /I reasoned/);
	const out = JSON.parse(readFileSync(join(J, "opus.json"), "utf8"));
	assert.equal(res.arms.sonnet.verdict, "partial", "sonnet's check failed: capped");
	assert.equal(res.arms.qwenl.verdict, "pass");
	assert.equal(out.arms.sonnet.capped, true);
	assert.equal(out.preference, "sonnet");
	assert.deepEqual(out.map, { A: "sonnet", B: "qwenl" });
});

// --- per-run absolute judging ------------------------------------------------------------------

test("parseSingle takes the last fenced json block and validates the rubric shape", () => {
	const text = `Reasoning ${block({ example: true })}\nMore.\n${block(cand("Fail"))}\n`;
	const v = parseSingle(text)!;
	assert.equal(v.verdict, "fail", "case-insensitive");
	assert.equal(v.correct, 3);
	assert.equal(parseSingle("no block at all"), null);
	assert.equal(parseSingle("```json\n{not json\n```"), null);
	assert.equal(parseSingle(block({ A: cand("pass") })), null, "no verdict field");
	assert.equal(parseSingle(block(cand("great"))), null, "unknown verdict");
});

test("single judge prompt: rubric, cap rule, reference, one candidate, no arm or run names", () => {
	const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
	const p = buildSingleJudgePrompt({
		kind: "small", task: "Do the thing.", reference: { name: "patch", text: "REFDIFF" },
		candidate: { check: "check C: 0", report: "report C", patch: long }, maxPatchLines: 10,
	});
	for (const s of ["strict, fair code reviewer", "correct (0-3)", "scope (0-2)", "quality (0-3)", "caps the verdict at partial", "```json",
		"Do the thing.", "REFDIFF", "## Candidate", "candidate.check.txt", "candidate.report.md", "candidate.patch", "report C", "[... truncated: 30 lines total"]) 
		assert.ok(p.includes(s), s);
	assert.ok(!p.includes("line 15"), "patch cut at 10 lines");
	assert.doesNotMatch(p, /qwen|sonnet|opus|orch/); // blind: no arm or run names
});

test("scout single prompt names the reference as an answer and asks for answer-quality judgement", () => {
	const p = buildSingleJudgePrompt({ kind: "scout", task: "Q?", reference: { name: "answer", text: "ANS" }, candidate: { check: "", report: "r", patch: "" } });
	assert.match(p, /investigation tasks/);
	assert.match(p, /ANS/);
});

test("runSingleJudge: blind per-run packet, check cap applied, record under judge/<id>/<run>/", async () => {
	const repo = sourceRepo();
	const paths = resolvePaths({ HOME: tmp(), PI_BENCH_DATA: tmp(), PI_BENCH_WORK: tmp(), PI_BENCH_EXT_DIR: "/ext" }, "/pkg");
	const env = { PATH: process.env.PATH! };
	const task = { kind: "small", gitdir: repo.gitdir, sub: "proj", base: repo.base, refs: [repo.next], prompt: "Change a.txt.", check: "test -f changed.txt" };
	writeFileSync(join(paths.data, "tasks.json"), JSON.stringify({ J3: task }));
	makeRefs({ J3: task }, paths.data);
	const ok = fakePrintPi(join(tmp(), "log"));
	await runOne({ id: "J3", task, arm: "qwenl", rep: 1, paths, piBin: ok, env, timeoutSec: 30 });
	await runOne({ id: "J3", task: { ...task, check: "exit 1" }, arm: "sonnet", rep: 1, paths, piBin: ok, env, timeoutSec: 30 });

	const log = join(tmp(), "sjlog");
	const judgePi = script(`#!/bin/sh
cat > ${log}.stdin
pwd > ${log}.cwd
cat <<'EOF'
${block(cand("pass"))}
EOF
`);
	// the judge says pass, but the run's harness check failed → capped to partial
	const capped = await runSingleJudge({ id: "J3", run: "J3.sonnet.1", judge: "opus", paths, piBin: judgePi, env, timeoutSec: 30 });
	assert.equal(capped.verdict, "partial", "capped by the failing check");
	assert.equal(capped.capped, true);
	assert.match(readFileSync(log + ".stdin", "utf8"), /Change a\.txt\./);
	assert.doesNotMatch(readFileSync(log + ".stdin", "utf8"), /qwenl|sonnet/, "blind: no arm or run names in the prompt");
	const cwd = readFileSync(log + ".cwd", "utf8").trim();
	assert.match(cwd, /\/judge\/J3\/pkt-[0-9a-f]{8}$/);
	assert.doesNotMatch(cwd, /qwenl|sonnet/, "blind: the judge's cwd names no arm");
	const J = join(paths.data, "judge/J3/J3.sonnet.1");
	const P = cwd;
	for (const f of ["candidate.patch", "candidate.report.md", "candidate.check.txt", "reference.patch", "baseline/keep.txt"])
		assert.ok(existsSync(join(P, f)), f);
	for (const f of ["prompt.opus.md", "verdict.opus.md", "opus.json"])
		assert.ok(existsSync(join(J, f)), f);
	const out = JSON.parse(readFileSync(join(J, "opus.json"), "utf8"));
	assert.deepEqual(out, { id: "J3", run: "J3.sonnet.1", arm: "sonnet", rep: 1, judge: "opus", correct: 3, scope: 2, quality: 3,
		verdict: "partial", requirements: [{ req: "r", status: "met" }], notes: "n", capped: true });

	// the passing run: no cap; the baseline still extracts when the tmpfs work dir is gone (task gitdir fallback)
	rmSync(join(paths.work, "runs/J3.qwenl.1"), { recursive: true, force: true });
	const good = await runSingleJudge({ id: "J3", run: "J3.qwenl.1", judge: "opus", paths, piBin: judgePi, env, timeoutSec: 30 });
	assert.equal(good.verdict, "pass");
	assert.equal(good.capped, false);
	assert.ok(existsSync(join(readFileSync(log + ".cwd", "utf8").trim(), "baseline/keep.txt")), "baseline from the task gitdir");
});

test("runSingleJudge: an answer without a rubric block is an error, nothing recorded", async () => {
	const repo = sourceRepo();
	const paths = resolvePaths({ HOME: tmp(), PI_BENCH_DATA: tmp(), PI_BENCH_WORK: tmp(), PI_BENCH_EXT_DIR: "/ext" }, "/pkg");
	const env = { PATH: process.env.PATH! };
	const task = { kind: "small", gitdir: repo.gitdir, sub: "proj", base: repo.base, refs: [repo.next], prompt: "p", check: null };
	writeFileSync(join(paths.data, "tasks.json"), JSON.stringify({ J4: task }));
	makeRefs({ J4: task }, paths.data);
	const ok = fakePrintPi(join(tmp(), "log"));
	await runOne({ id: "J4", task, arm: "qwenl", rep: 1, paths, piBin: ok, env, timeoutSec: 30 });
	const bad = script("#!/bin/sh\ncat >/dev/null\necho 'just prose'\n");
	await assert.rejects(runSingleJudge({ id: "J4", run: "J4.qwenl.1", judge: "gpt", paths, piBin: bad, env, timeoutSec: 30 }), /no valid rubric/);
	assert.equal(existsSync(join(paths.data, "judge/J4/J4.qwenl.1/gpt.json")), false);
});

test("runJudge: an answer without a rubric block is an error, not a verdict", async () => {
	const repo = sourceRepo();
	const paths = resolvePaths({ HOME: tmp(), PI_BENCH_DATA: tmp(), PI_BENCH_WORK: tmp(), PI_BENCH_EXT_DIR: "/ext" }, "/pkg");
	const env = { PATH: process.env.PATH! };
	const task = { kind: "small", gitdir: repo.gitdir, sub: "proj", base: repo.base, refs: [repo.next], prompt: "p", check: null };
	writeFileSync(join(paths.data, "tasks.json"), JSON.stringify({ J2: task }));
	makeRefs({ J2: task }, paths.data);
	const ok = fakePrintPi(join(tmp(), "log"));
	await runOne({ id: "J2", task, arm: "qwenl", rep: 1, paths, piBin: ok, env, timeoutSec: 30 });
	await runOne({ id: "J2", task, arm: "sonnet", rep: 1, paths, piBin: ok, env, timeoutSec: 30 });
	const bad = script("#!/bin/sh\ncat >/dev/null\necho 'just prose'\n");
	await assert.rejects(runJudge({ id: "J2", judge: "gpt", x: "qwenl", y: "sonnet", paths, piBin: bad, env, timeoutSec: 30 }), /no valid rubric/);
	assert.equal(existsSync(join(paths.data, "judge/J2/gpt.json")), false);
});
