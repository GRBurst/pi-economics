// Local mode L7.T6–T8 (design §3.5.2; plan D50–D52, LD10): `plan_request` in a temporary repository. T6: the grounding
// check refuses before any overseer runs ("AC-P1"), as do a used slug and a dirty main checkout (D51). T7: the plan author
// and the red runs of its task checks on the main tip ("AC-P3", D52). T8: the plan file committed on main (LD10, D50).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkBypass, MAIN_REF_TYPE } from "../core/local/merge.ts";
import { renderPlan, type Skeleton, skeletonHash } from "../core/local/plan.ts";
import { planRequest } from "../core/local/planflow.ts";
import { PLAN_TYPE } from "../core/local/plans.ts";
import { rig } from "./overseer-rig.ts";
import { planRig } from "./plan-rig.ts";

const INPUT = { slug: "parser", request: "add a parser", acceptance: ["the parser test passes"], files: ["src/a.ts"], symbols: ["parse"] };

test("AC-P1 a missing file and an absent symbol are refused together, before any overseer runs", async () => {
  const x = planRig();
  const before = x.mainSha();
  const r = await planRequest(x.ports, { ...INPUT, files: ["src/a.ts", "src/gone.ts"], symbols: ["parse", "tokenize", "par"] }, x.r.dir);
  assert.equal(r.status, "refused");
  assert.equal(r.reason, "grounding");
  assert.ok(r.detail.includes("src/gone.ts"), r.detail);
  assert.ok(r.detail.includes("tokenize"), r.detail);
  assert.ok(r.detail.includes("par") && !r.detail.includes("parse"), "a symbol is a whole word; parse is found");
  assert.equal(x.runs.length, 0);
  assert.equal(x.mainSha(), before);
  assert.deepEqual(x.entries, []);
});

test("AC-P1 a slug a plan already uses is refused", async () => {
  const x = planRig();
  x.plans.put({ slug: "parser", repo: x.r.dir, file: "docs/plans/parser.md", skeletonHash: "a".repeat(64), approvedBy: "rv-0", triggers: [] });
  const r = await planRequest(x.ports, INPUT, x.r.dir);
  assert.equal(r.status, "refused");
  assert.equal(r.reason, "slug");
  assert.equal(x.runs.length, 0);
  const y = planRig();
  y.r.commit("docs/plans/parser.md", "# Plan: parser\n");
  const s = await planRequest(y.ports, INPUT, y.r.dir);
  assert.equal(s.reason, "slug", "a plan file of that name on main uses it too");
  assert.equal(y.runs.length, 0);
});

test("D51 a dirty main checkout is refused before authoring", async () => {
  const x = planRig();
  writeFileSync(join(x.r.dir, "src/b.ts"), "changed\n");
  const r = await planRequest(x.ports, INPUT, x.r.dir);
  assert.equal(r.status, "refused");
  assert.equal(r.reason, "main-dirty");
  assert.ok(r.detail.includes(x.r.dir));
  assert.equal(x.runs.length, 0);
});

test("a cwd outside any repository is an error", async () => {
  const x = planRig();
  const r = await planRequest(x.ports, INPUT, x.r.base);
  assert.equal(r.status, "error");
  assert.equal(x.runs.length, 0);
});

/** A two-task skeleton on the rig's files; `check` is M1.T1's (default: fails on the main tip, as a task check should). */
const skeleton = (check = "test -f src/parse.ts", o: { files?: string[] } = {}): Skeleton => ({ invariants: ["no new dependency"], milestones: [{
  id: "M1", goal: "parse the input", acceptance: ["the parser test passes"], branch: "task", dependsOn: [], tasks: [
    { id: "M1.T1", goal: "add the parser", files: o.files ?? ["src/a.ts"], create: ["src/parse.ts"], forbidden: [], check, dependsOn: [] },
    { id: "M1.T2", goal: "wire it", files: ["src/b.ts"], forbidden: [], check: "grep -q parse src/b.ts", dependsOn: ["M1.T1"] }] }] });

test("AC-P3 the plan author runs in the main checkout with the request, the grounding, the repository map and the limits", async () => {
  const x = planRig();
  x.script.push([skeleton()]);
  await planRequest(x.ports, INPUT, x.r.dir);
  assert.equal(x.runs.length, 1);
  const a = x.runs[0]!;
  assert.equal(a.role, "plan-author");
  assert.equal(a.cwd, x.r.dir);
  assert.equal(a.worktree, undefined);
  assert.equal(a.submit.name, "submit_plan");
  assert.equal(a.submit.resubmits, x.settings.plans.rounds);
  for (const part of ["add a parser", "the parser test passes", "src/a.ts", "parse", "test/a.test.ts", "README",
    `${x.settings.plans.splitFiles}`, `${x.settings.plans.milestoneTasks}`]) assert.ok(a.input.includes(part), part);
});

test("AC-P3 a vacuous task check: the author's execute gets isError with a check finding targeting the task id", async () => {
  const x = planRig(), o = rig({ overseer: { resubmits: 0 } });
  x.ports.overseer = o.ov;
  const out: Array<{ text: string; isError?: boolean; terminate?: boolean }> = [];
  for (let i = 0; i < 2; i++) o.script.push(async () => out.push(await o.tool().execute(skeleton("true"))));
  o.script.push(async () => out.push(await o.tool().execute(skeleton())));
  await planRequest(x.ports, INPUT, x.r.dir);
  assert.deepEqual(out.map((y) => [y.isError, y.terminate]), [[true, undefined], [true, undefined], [undefined, true]]);
  assert.ok(out[0]!.text.startsWith("invalid: F1 [blocking] check M1.T1: "), out[0]!.text);
  assert.ok(out[0]!.text.includes("`true` exit 0"), out[0]!.text);
  assert.ok(!out[0]!.text.includes("M1.T2"), "M1.T2's check fails on the main tip");
});

test("review L7 F3: the fallback attempt gets its own plans.rounds: its first vacuous submission is a resubmit, not final", async () => {
  const x = planRig(), o = rig({ overseer: { resubmits: 0 } });
  x.ports.overseer = o.ov;
  const out: Array<{ text: string; isError?: boolean; terminate?: boolean }> = [];
  for (let i = 0; i < 2; i++) o.script.push(async () => out.push(await o.tool().execute(skeleton("true"))));
  o.script.push(() => o.h.a.emit({ type: "kill", name: "ovs-plan-author-1", ts: 0 })); // attempt 1 dies after its rounds
  o.script.push(async () => out.push(await o.tool().execute(skeleton("true"))));
  o.script.push(async () => out.push(await o.tool().execute(skeleton())));
  const r = await planRequest(x.ports, INPUT, x.r.dir);
  assert.equal(o.h.a.apiSpawns.length, 2);
  assert.deepEqual(out.map((y) => [y.isError, y.terminate]), [[true, undefined], [true, undefined], [true, undefined], [undefined, true]]);
  assert.ok(out[2]!.text.startsWith("invalid: F1 [blocking] check M1.T1: "), out[2]!.text);
  assert.equal(r.status, "approved", r.detail);
});

test("AC-P3 after plans.rounds vacuous rounds the skeleton is accepted, vacuousCheck recorded on that task", async () => {
  const x = planRig();
  x.script.push([skeleton("true"), skeleton("true"), skeleton("true")]);
  const r = await planRequest(x.ports, INPUT, x.r.dir);
  assert.deepEqual(x.replies.map((y) => y.ok), [false, false, true]);
  const sk = (x.replies[2]!.value as { ok: true; sk: Skeleton }).sk;
  assert.equal(sk.milestones[0]!.tasks[0]!.vacuousCheck, true);
  assert.equal(sk.milestones[0]!.tasks[1]!.vacuousCheck, undefined);
  assert.notEqual(r.status, "error");
  assert.ok(x.checks.every((c) => c.cwd.startsWith(x.r.base) && c.cwd !== x.r.dir), "red runs in temporary worktrees");
  assert.equal(x.r.git(["worktree", "list", "--porcelain"]).split("\n").filter((l) => l.startsWith("worktree ")).length, 1, "all removed");
});

test("D52 a check exiting 127 still broken after plans.rounds fails plan_request", async () => {
  const x = planRig();
  const before = x.mainSha();
  x.script.push([skeleton("no-such-command-x"), skeleton("no-such-command-x"), skeleton("no-such-command-x")]);
  const r = await planRequest(x.ports, INPUT, x.r.dir);
  assert.deepEqual(x.replies.map((y) => y.ok), [false, false, true]);
  assert.ok(x.replies[0]!.reasons!.some((t) => t.includes("check M1.T1") && t.includes("exit 127")), String(x.replies[0]!.reasons));
  assert.equal(r.status, "error");
  assert.equal(r.reason, "broken-check");
  assert.ok(r.detail.includes("M1.T1"));
  assert.equal(x.mainSha(), before);
});

test("AC-P3 validation errors count toward plans.rounds", async () => {
  const x = planRig();
  const bad = skeleton("test -f src/parse.ts", { files: ["src/gone.ts"] });
  x.script.push([bad, skeleton("true"), bad]);
  const r = await planRequest(x.ports, INPUT, x.r.dir);
  assert.deepEqual(x.replies.map((y) => y.ok), [false, false, true]);
  assert.ok(x.replies[0]!.reasons!.some((t) => t.includes("src/gone.ts")));
  assert.equal(r.status, "error");
  assert.equal(r.reason, "invalid");
  assert.ok(r.detail.includes("src/gone.ts"));
  const y = planRig();
  y.script.push([bad, skeleton("true"), skeleton("true")]);
  await planRequest(y.ports, INPUT, y.r.dir);
  assert.equal((y.replies[2]!.value as { ok: true; sk: Skeleton }).sk.milestones[0]!.tasks[0]!.vacuousCheck, true);
});

test("an author that cannot run is an error; an aborted one is aborted (D49)", async () => {
  const x = planRig();
  x.script.push("fail");
  const r = await planRequest(x.ports, INPUT, x.r.dir);
  assert.deepEqual([r.status, r.reason], ["error", "author-unavailable"]);
  const y = planRig();
  y.ports.overseer = { ready: () => true, run: async () => ({ ok: false, outcome: "aborted" }) };
  const s = await planRequest(y.ports, INPUT, y.r.dir);
  assert.deepEqual([s.status, s.reason], ["error", "aborted"]);
});

// ── L7.T8: render, commit on main, record, return (LD10, D50) ──

test("LD10 an approved skeleton is committed on main as plans.dir/<slug>.md; recorded; the result names the first unit", async () => {
  const x = planRig();
  const tip = x.mainSha();
  x.script.push([skeleton()]);
  const r = await planRequest(x.ports, INPUT, x.r.dir);
  assert.equal(r.status, "approved", r.detail);
  const head = x.mainSha();
  assert.equal(x.r.git(["rev-parse", `${head}^`]), tip, "one commit on the old tip");
  assert.equal(x.r.git(["log", "-1", "--format=%s", head]), "plan(parser): approved rv-1");
  assert.equal(x.r.git(["diff", "--name-only", tip, head]), "docs/plans/parser.md");
  const text = readFileSync(join(x.r.dir, "docs/plans/parser.md"), "utf8");
  assert.equal(text, renderPlan({ slug: "parser", request: INPUT.request }, skeleton(), new Set()));
  assert.equal(x.r.git(["status", "--porcelain"]), "", "the main checkout is fast-forwarded and clean");
  assert.deepEqual(x.entries.map((e) => e.type), [MAIN_REF_TYPE, PLAN_TYPE]);
  assert.deepEqual(x.entries[0]!.data, { repo: x.r.dir, branch: "main", sha: head });
  assert.deepEqual(x.entries[1]!.data, { slug: "parser", repo: x.r.dir, file: "docs/plans/parser.md", skeletonHash: skeletonHash(skeleton()), approvedBy: "rv-1", triggers: [] });
  assert.deepEqual([r.path, r.commit, r.reviewId, r.next], ["docs/plans/parser.md", head, "rv-1", { slug: "parser", id: "M1.T1" }]);
  assert.ok(r.detail.includes('start_branch {"plan": {"slug": "parser", "id": "M1.T1"}}'), r.detail);
  assert.deepEqual(await checkBypass({ git: x.git, settings: x.settings, refs: x.refs }, [x.r.dir]), [], "no gatebypass afterwards");
});

test("LD10 main checked out nowhere: the ref moves; a milestone branch's first unit is the milestone", async () => {
  const x = planRig();
  x.r.git(["switch", "-q", "-c", "side"]);
  const tip = x.mainSha();
  const sk = skeleton();
  sk.milestones[0]!.branch = "milestone";
  x.script.push([sk]);
  const r = await planRequest(x.ports, INPUT, x.r.dir);
  assert.equal(r.status, "approved", r.detail);
  assert.equal(x.r.git(["rev-parse", `${x.mainSha()}^`]), tip);
  assert.equal(x.r.git(["show", `main:docs/plans/parser.md`]) + "\n", renderPlan({ slug: "parser", request: INPUT.request }, sk, new Set()));
  assert.deepEqual(r.next, { slug: "parser", id: "M1" });
});

test("LD10 a main checkout made dirty during authoring refuses the commit; nothing is recorded", async () => {
  const x = planRig();
  const tip = x.mainSha();
  x.script.push([skeleton()]);
  const run = x.overseer.run.bind(x.overseer);
  x.ports.overseer = { ready: () => true, run: async (a) => { writeFileSync(join(x.r.dir, "src/b.ts"), "dirty\n"); return run(a); } };
  const r = await planRequest(x.ports, INPUT, x.r.dir);
  assert.deepEqual([r.status, r.reason], ["refused", "main-dirty"]);
  assert.equal(x.mainSha(), tip);
  assert.deepEqual(x.entries, []);
});

test("review F7: a task check the git guard blocks is never run; a check finding, and after plans.rounds plan_request fails", async () => {
  const x = planRig();
  const bad = "git push origin HEAD:main";
  x.script.push([skeleton(bad), skeleton(bad), skeleton(bad)]);
  const r = await planRequest(x.ports, INPUT, x.r.dir);
  assert.ok(!x.checks.some((c) => c.cmd === bad), "never run");
  assert.deepEqual(x.replies.map((y) => y.ok), [false, false, true]);
  assert.ok(x.replies[0]!.reasons!.some((t) => t.includes("check M1.T1") && t.includes("request_merge")), String(x.replies[0]!.reasons));
  assert.equal(r.reason, "broken-check");
  assert.ok(r.detail.includes(`M1.T1: \`${bad}\` was not run: `), r.detail);
});

test("review F11: an abort during a red run ends plan_request aborted; the red run gets the signal; main is unchanged", async () => {
  const x = planRig();
  const before = x.mainSha(), ctl = new AbortController(), run = x.ports.run, got: Array<AbortSignal | undefined> = [];
  x.ports.signal = ctl.signal;
  x.ports.run = (cmd, cwd, ms, signal) => { got.push(signal); ctl.abort(); return run(cmd, cwd, ms, signal); };
  x.script.push([skeleton()]);
  const r = await planRequest(x.ports, INPUT, x.r.dir);
  assert.deepEqual([r.status, r.reason], ["error", "aborted"], r.detail);
  assert.deepEqual(got, [ctl.signal], "one red run, with the signal; none after the abort");
  assert.equal(x.mainSha(), before);
  assert.equal(x.plans.get("parser"), undefined);
});

test("caps: an author whose members are at their caps names why in the detail", async () => {
  const x = planRig();
  x.ports.overseer = { ready: () => true, run: async () => ({ ok: false, outcome: "error", why: "opus reached its dailyCap (1)" }) };
  const r = await planRequest(x.ports, INPUT, x.r.dir);
  assert.deepEqual([r.status, r.reason, r.detail], ["error", "author-unavailable", "the plan author is unavailable (error): opus reached its dailyCap (1)"]);
});
