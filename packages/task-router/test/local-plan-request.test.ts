// Local mode L7.T6–T8 (design §3.5.2; plan D50–D52, LD10): `plan_request` in a temporary repository. T6: the grounding
// check refuses before any overseer runs ("AC-P1"), as do a used slug and a dirty main checkout (D51). T7: the plan author
// and the red runs of its task checks on the main tip ("AC-P3", D52).
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Skeleton } from "../core/local/plan.ts";
import { planRequest } from "../core/local/planflow.ts";
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
