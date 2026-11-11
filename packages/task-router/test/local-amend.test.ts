// Local mode L7.T14–T15 (design §3.5.4, §3.5.5; AC-P6): `amend_plan` in a temporary repository. Step 1: the trigger must be
// open; the one the model may open itself is `interface-break`, accepted iff its evidence command fails in the active
// worktree. Step 2: the amended skeleton passes the rules of §3.2.4 (only the amendment's own findings count) and leaves
// checked tasks (ticked or merged) as they are. Step 3: a delta review, or a plan-review for an interface-break, an amended
// task in publicApiGlobs or a milestone added or removed. Steps 4–5: approved, the plan is re-rendered and committed on main;
// rejected, the findings return, and after plans.rounds rejections the plan author rewrites the milestone itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { canonical, parsePlan, renderPlan, type Skeleton, skeletonHash, type Task } from "../core/local/plan.ts";
import { amendPlan, type AmendInput } from "../core/local/planflow.ts";
import { startBranch } from "../core/local/worktree.ts";
import { planRig, type PlanRig } from "./plan-rig.ts";

const T1: Task = { id: "M1.T1", goal: "write the parser", files: ["src/a.ts"], create: ["src/parse.ts"], forbidden: [], check: "test -f src/parse.ts", dependsOn: [] };
const T2: Task = { id: "M1.T2", goal: "wire it", files: ["src/b.ts"], forbidden: [], check: "grep -q parse src/b.ts", dependsOn: ["M1.T1"] };
const SK: Skeleton = { invariants: ["parse stays pure"], milestones: [
  { id: "M1", goal: "a parser", acceptance: ["the parser test passes"], branch: "task", dependsOn: [], tasks: [T1, T2] }] };
const FILE = "docs/plans/parser.md";

/** The rig with the plan approved (its file on main, `ticks` checked, its record in the store). */
function approved(ticks: string[] = [], sk: Skeleton = SK): PlanRig {
  const x = planRig();
  x.r.commit(FILE, renderPlan({ slug: "parser", request: "add a parser" }, sk, new Set(ticks)), "plan(parser): approved rv-0");
  x.plans.put({ slug: "parser", repo: x.r.dir, file: FILE, skeletonHash: skeletonHash(sk), approvedBy: "rv-0", triggers: [] });
  return x;
}
const start = async (x: PlanRig, id: string): Promise<string> => {
  const r = await startBranch({ git: x.git, store: x.branches, settings: x.settings, plans: x.plans }, { plan: { slug: "parser", id } }, x.r.dir);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.value.worktree;
};
const merged = (x: PlanRig, id: string): void =>
  x.branches.put({ repo: x.r.dir, branch: `lm/parser/${id}`, worktree: join(x.r.base, id), base: x.mainSha(), plan: { slug: "parser", id },
    state: "merged", rejections: 0, fixerRuns: 0 });
const amend = (o: Partial<AmendInput> = {}): AmendInput => ({ slug: "parser", trigger: { id: "t1" },
  changes: [{ op: "replace", id: "M1.T2", task: { ...T2, files: ["src/b.ts", "test/a.test.ts"] } }], reason: "the wiring needs the test", ...o });
/** Everything a refusal must leave as it was: refs, worktrees, the entries. */
const state = (x: PlanRig): string =>
  [x.r.git(["for-each-ref"]), x.r.git(["worktree", "list", "--porcelain"]), JSON.stringify(x.entries)].join("\n");
async function refused(x: PlanRig, input: AmendInput): Promise<{ reason?: string; detail: string }> {
  const before = state(x);
  const r = await amendPlan(x.ports, input, x.r.dir);
  assert.equal(r.status, "refused", r.detail);
  assert.equal(state(x), before, "a refusal changes nothing");
  assert.equal(x.runs.length, 0, "no overseer runs");
  return r;
}

test("AC-P6 trigger: without an open trigger amend_plan is refused", async () => {
  const x = approved();
  assert.deepEqual(await refused(x, amend()), { status: "refused", reason: "trigger", detail: "no replan trigger is open; finish the task as planned" });
  x.plans.open("parser", "over-budget", "M1.T1");
  x.plans.close("parser", "t1");
  x.plans.open("parser", "non-whitelisted", "M1.T1");
  assert.equal((await refused(x, amend())).detail, "trigger t1 is not open; the open triggers: t2");
  assert.equal((await refused(x, amend({ trigger: { id: "new" } }))).detail, "a new trigger needs kind interface-break and an evidenceCommand");
  assert.deepEqual(await refused(x, amend({ slug: "none" })), { status: "refused", reason: "no-plan", detail: "no approved plan none; plan_request makes one" });
});

test("AC-P6 evidence: a new interface-break is accepted iff its evidence command fails in the active worktree", async () => {
  const x = approved();
  const wt = await start(x, "M1.T1");
  const no = await refused(x, amend({ trigger: { id: "new", kind: "interface-break", evidenceCommand: "true" } }));
  assert.deepEqual(no, { status: "refused", reason: "evidence", detail: `the evidence command \`true\` exits 0 in ${wt}; an interface-break needs a command that fails` });
  assert.deepEqual(x.plans.get("parser")!.triggers, []);
  x.script.push([{ verdict: "APPROVE", summary: "fine", findings: [] }]);
  const yes = await amendPlan(x.ports, amend({ trigger: { id: "new", kind: "interface-break", evidenceCommand: "false" } }), x.r.dir);
  assert.ok(!["trigger", "evidence"].includes(yes.reason ?? ""), yes.detail);
  assert.equal(yes.trigger, "t1");
  assert.deepEqual(x.plans.get("parser")!.triggers[0], { id: "t1", kind: "interface-break", task: "M1.T1", open: yes.status !== "approved" });
  assert.deepEqual(x.checks.filter((c) => c.cmd === "false"), [{ cmd: "false", cwd: wt }]);
});

test("AC-P6 validation: the amended skeleton's own errors refuse it; unknown ids and changes without a task too", async () => {
  const x = approved();
  x.plans.open("parser", "over-budget", "M1.T2");
  const bad = await refused(x, amend({ changes: [{ op: "replace", id: "M1.T2", task: { ...T2, dependsOn: ["M9.T1"] } }] }));
  assert.deepEqual([bad.reason, bad.detail], ["invalid", "the amended plan is invalid: M1.T2: dependsOn names unknown id M9.T1"]);
  assert.equal((await refused(x, amend({ changes: [{ op: "replace", id: "M1.T9", task: T2 }] }))).detail, "the amended plan is invalid: change 1: no task M1.T9");
  assert.equal((await refused(x, amend({ changes: [{ op: "add" }] }))).detail, "the amended plan is invalid: change 1: add needs a task");
  assert.equal((await refused(x, amend({ changes: [{ op: "remove", id: "M1.T1" }] }))).detail,
    "the amended plan is invalid: M1.T2: dependsOn names unknown id M1.T1");
  assert.equal((await refused(x, amend({ changes: [{ op: "add", after: "M1.T1", task: { ...T2, id: "M1.T3", files: ["src/c.ts"], dependsOn: [] } }] }))).detail,
    "the amended plan is invalid: M1.T3: file src/c.ts does not exist");
});

test("AC-P6 validation: what the repository did since the approval is no error of the amendment", async () => {
  const x = approved();
  x.r.commit("src/parse.ts", "export {};\n"); // M1.T1's create exists now
  merged(x, "M1.T1");
  x.plans.open("parser", "over-budget", "M1.T2");
  x.script.push([{ verdict: "APPROVE", summary: "fine", findings: [] }]);
  const r = await amendPlan(x.ports, amend(), x.r.dir);
  assert.ok(!["invalid", "checked"].includes(r.reason ?? ""), r.detail);
});

test("AC-P6 checked tasks (ticked or merged) cannot change", async () => {
  const ticked = approved(["M1.T1"]);
  ticked.plans.open("parser", "over-budget", "M1.T2");
  const r = await refused(ticked, amend({ changes: [{ op: "replace", id: "M1.T1", task: { ...T1, goal: "write it" } }] }));
  assert.deepEqual([r.reason, r.detail], ["checked", "M1.T1 is checked (ticked or merged); it cannot change"]);
  const done = approved();
  merged(done, "M1.T1");
  done.plans.open("parser", "over-budget", "M1.T2");
  assert.equal((await refused(done, amend({ changes: [{ op: "remove", id: "M1.T2" }, { op: "remove", id: "M1.T1" }] }))).detail,
    "M1.T1 is checked (ticked or merged); it cannot change");
  assert.equal((await refused(done, amend({ changes: [{ op: "remove", id: "M1" }] }))).detail, "M1.T1 is checked (ticked or merged); it cannot change");
});

// ── L7.T15 (design §3.5.4 steps 3–5): the review kind, the applied amendment, the rounds ──
const APPROVE = { verdict: "APPROVE", summary: "fine", findings: [] };
const REVISE = { verdict: "REVISE", summary: "no", findings: [{ id: "F1", category: "plan", target: "M1.T2", defect: "too wide", evidence: "e", fix: "narrow it", blocking: true }] };
/** The plan as main has it. */
const onMain = (x: PlanRig) => parsePlan(x.r.git(["show", `main:${FILE}`]) + "\n")!;
const WIDER = { ...T2, files: ["src/b.ts", "test/a.test.ts"] };
/** A task as the review input shows it: one line of canonical JSON. */
const line = (t: Task): string => JSON.stringify(JSON.parse(canonical(t)));

test("AC-P6 review kind: a delta review by default; approved, the plan is re-rendered on main with the unchanged ticks", async () => {
  const x = approved(["M1.T1"]);
  x.r.commit("src/parse.ts", "export {};\n");
  merged(x, "M1.T1");
  const wt = await start(x, "M1.T2");
  x.plans.open("parser", "over-budget", "M1.T2");
  x.script.push([APPROVE]);
  const before = x.mainSha();
  const r = await amendPlan(x.ports, amend(), x.r.dir);
  assert.equal(r.status, "approved", r.detail);
  assert.deepEqual([r.full, r.trigger, r.reviewId], [false, "t1", "rv-1"]);
  assert.deepEqual(x.runs.map((a) => a.role), ["delta"]);
  const input = x.runs[0]!.input;
  for (const part of ["Trigger: t1 over-budget (task M1.T2)", "Reason: the wiring needs the test", "Old tasks:", line(T2), "Proposed tasks:",
    line(WIDER), "Dependants: none"]) assert.ok(input.split("\n").includes(part), `${part} in\n${input}`);
  // committed on main (its parent the old tip), recorded, the trigger closed, the ticks of unchanged tasks kept
  assert.equal(x.r.git(["rev-parse", "main^"]), before);
  assert.equal(x.r.git(["log", "-1", "--format=%s", "main"]), "plan(parser): amended rv-1");
  assert.equal(r.commit, x.mainSha());
  const now = onMain(x);
  assert.deepEqual(now.sk.milestones[0]!.tasks[1], WIDER);
  assert.deepEqual([...now.ticks], ["M1.T1"]);
  const rec = x.plans.get("parser")!;
  assert.deepEqual([rec.skeletonHash, rec.approvedBy, rec.triggers], [skeletonHash(now.sk), "rv-1", [{ id: "t1", kind: "over-budget", task: "M1.T2", open: false }]]);
  assert.equal(r.detail, `plan amended: ${FILE} at ${x.mainSha().slice(0, 7)}; trigger t1 is closed`);
  // the live branch of the amended task takes its new whitelist and check
  assert.deepEqual(x.branches.get(x.r.dir, "lm/parser/M1.T2")!.files, ["src/b.ts", "test/a.test.ts"]);
  assert.equal(x.branches.get(x.r.dir, "lm/parser/M1.T2")!.worktree, wt);
});

test("AC-P6 review kind: plan-review for publicApiGlobs, an interface-break and an added milestone", async () => {
  const cases: Array<[string, Record<string, unknown>, Partial<AmendInput>, string?]> = [
    ["publicApiGlobs", { plans: { publicApiGlobs: ["src/b.*"] } }, {}],
    ["interface-break", {}, { trigger: { id: "new", kind: "interface-break", evidenceCommand: "false" } }],
    ["milestone added", {}, { changes: [{ op: "add", task: { ...T2, id: "M2.T1", files: ["test/a.test.ts"], check: "grep -q wire test/a.test.ts", dependsOn: [] } }] }],
    ["delta", {}, {}, "delta"],
  ];
  for (const [name, settings, o, role = "plan-review"] of cases) {
    const x = planRig({ settings });
    x.r.commit(FILE, renderPlan({ slug: "parser", request: "add a parser" }, SK, new Set()), "plan(parser): approved rv-0");
    x.plans.put({ slug: "parser", repo: x.r.dir, file: FILE, skeletonHash: skeletonHash(SK), approvedBy: "rv-0", triggers: [] });
    x.plans.open("parser", "over-budget", "M1.T2");
    x.script.push([APPROVE]);
    const r = await amendPlan(x.ports, amend(o), x.r.dir);
    assert.equal(r.status, "approved", `${name}: ${r.detail}`);
    assert.deepEqual([x.runs.map((a) => a.role), r.full], [[role], role === "plan-review"], name);
    if (role === "plan-review") assert.ok(x.runs[0]!.input.includes("\n# Plan: parser\n"), `${name}: the whole plan`);
  }
});

test("AC-P6 rejected: the findings come back; the plan and the trigger stay", async () => {
  const x = approved();
  x.plans.open("parser", "over-budget", "M1.T2");
  x.script.push([REVISE]);
  const before = x.mainSha();
  const r = await amendPlan(x.ports, amend(), x.r.dir);
  assert.deepEqual([r.status, r.reason, r.trigger, r.full], ["rejected", undefined, "t1", false]);
  assert.equal(r.findings?.length, 1);
  assert.match(r.findings![0]!, /^F1 \[blocking\] plan M1\.T2: too wide/);
  assert.equal(r.detail, "the plan amendment was rejected (1 of plans.rounds 2); answer the findings with a new amend_plan");
  assert.equal(x.mainSha(), before);
  assert.deepEqual(x.plans.openTriggers("parser").map((t) => [t.id, t.rejected]), [["t1", 1]]);
});

test("rounds exhausted: after plans.rounds rejections the plan author rewrites the milestone, applied without a review", async () => {
  const x = approved();
  x.plans.open("parser", "over-budget", "M1.T2");
  x.script.push([REVISE], [REVISE]);
  assert.equal((await amendPlan(x.ports, amend(), x.r.dir)).status, "rejected");
  const T3 = { id: "M1.T3", goal: "test the wiring", files: ["test/a.test.ts"], forbidden: [], check: "grep -q wire test/a.test.ts", dependsOn: ["M1.T2"] };
  const rewritten: Skeleton = { ...SK, milestones: [{ ...SK.milestones[0]!, tasks: [T1, T2, T3] }] };
  const vacuousToo: Skeleton = { ...SK, milestones: [{ ...SK.milestones[0]!, tasks: [T1, T2, { ...T3, check: "true" }] }] };
  x.script.push([{ ...SK, invariants: [] }, vacuousToo, rewritten]);
  const r = await amendPlan(x.ports, amend(), x.r.dir);
  assert.equal(r.status, "approved", r.detail);
  assert.deepEqual(x.runs.map((a) => a.role), ["delta", "delta", "plan-author"]);
  assert.ok(x.runs[2]!.input.includes("Rewrite milestone M1"), x.runs[2]!.input);
  assert.deepEqual(x.replies.slice(-3).map((c) => c.ok), [false, false, true], "another milestone changed; a vacuous check; then accepted");
  assert.match(x.replies.at(-3)!.reasons!.join("; "), /invariants changed; rewrite only M1/);
  assert.deepEqual(x.checks.filter((c) => c.cmd.startsWith("grep -q wire")).length, 1, "only the new task's check ran red");
  assert.equal(onMain(x).sk.milestones[0]!.tasks.length, 3);
  assert.equal(x.r.git(["log", "-1", "--format=%s", "main"]), "plan(parser): amended rv-3");
  assert.equal(x.plans.openTriggers("parser").length, 0);
  assert.match(r.detail, /^the amendment was rejected 2 times; the plan author rewrote M1: plan amended: /);
});

test("an amended task whose check passes on the main tip is marked vacuous; one that cannot run is refused", async () => {
  const x = approved();
  x.plans.open("parser", "over-budget", "M1.T2");
  x.script.push([APPROVE]);
  const r = await amendPlan(x.ports, amend({ changes: [{ op: "replace", id: "M1.T2", task: { ...T2, check: "true" } }] }), x.r.dir);
  assert.equal(r.status, "approved", r.detail);
  assert.equal(onMain(x).sk.milestones[0]!.tasks[1]!.vacuousCheck, true);
  const y = approved();
  y.plans.open("parser", "over-budget", "M1.T2");
  const no = await refused(y, amend({ changes: [{ op: "replace", id: "M1.T2", task: { ...T2, check: "no-such-command-x" } }] }));
  assert.deepEqual([no.reason, no.detail], ["broken-check", "the amended checks cannot run: M1.T2: `no-such-command-x` exit 127"]);
});

test("review F7: an amended check or an evidence command the git guard blocks is never run", async () => {
  const bad = "git push origin HEAD:main";
  const x = approved();
  x.plans.open("parser", "over-budget", "M1.T2");
  const no = await refused(x, amend({ changes: [{ op: "replace", id: "M1.T2", task: { ...T2, check: bad } }] }));
  assert.equal(no.reason, "broken-check");
  assert.ok(no.detail.startsWith(`the amended checks cannot run: M1.T2: \`${bad}\` was not run: `), no.detail);
  const y = approved();
  await start(y, "M1.T1");
  const ev = await refused(y, amend({ trigger: { id: "new", kind: "interface-break", evidenceCommand: bad } }));
  assert.equal(ev.reason, "evidence");
  assert.ok(ev.detail.startsWith(`the evidence command \`${bad}\` was not run: `), ev.detail);
  assert.ok(![...x.checks, ...y.checks].some((c) => c.cmd === bad), "never run");
});

test("review F11: an abort during the evidence command or a red run ends amend_plan aborted; no trigger opens, nothing runs after", async () => {
  for (const at of ["evidence", "red"] as const) {
    const x = approved();
    await start(x, "M1.T1");
    const ctl = new AbortController(), run = x.ports.run;
    x.ports.signal = ctl.signal;
    const target = at === "evidence" ? "false" : "grep -q parse src/b.ts && true";
    x.ports.run = (cmd, cwd, ms, signal) => { if (cmd === target) ctl.abort(); return run(cmd, cwd, ms, signal); };
    const input = at === "evidence"
      ? amend({ trigger: { id: "new", kind: "interface-break", evidenceCommand: "false" } })
      : amend({ trigger: { id: x.plans.open("parser", "over-budget", "M1.T2")! }, changes: [{ op: "replace", id: "M1.T2", task: { ...T2, check: target } }] });
    const before = state(x), opened = x.plans.get("parser")!.triggers.length;
    const r = await amendPlan(x.ports, input, x.r.dir);
    assert.deepEqual([r.status, r.reason], ["error", "aborted"], `${at}: ${r.detail}`);
    assert.equal(x.plans.get("parser")!.triggers.length, opened, `${at}: no trigger opens`);
    assert.equal(state(x), before, at);
    assert.equal(x.runs.length, 0, `${at}: no review`);
  }
});

test("review F8: an amendment rebinds a live branch without making it the active one", async () => {
  const x = approved([], { ...SK, milestones: [{ ...SK.milestones[0]!, tasks: [T1, { ...T2, dependsOn: [] }] }] });
  await start(x, "M1.T1");
  await start(x, "M1.T2");
  x.plans.open("parser", "over-budget", "M1.T1");
  x.script.push([APPROVE]);
  const r = await amendPlan(x.ports, amend({ changes: [{ op: "replace", id: "M1.T1", task: { ...T1, goal: "write the pure parser" } }] }), x.r.dir);
  assert.equal(r.status, "approved", r.detail);
  assert.equal(x.branches.get(x.r.dir, "lm/parser/M1.T1")!.goal, "write the pure parser");
  assert.equal(x.branches.active()!.branch, "lm/parser/M1.T2");
});
