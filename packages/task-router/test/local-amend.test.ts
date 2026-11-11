// Local mode L7.T14–T15 (design §3.5.4, §3.5.5; AC-P6): `amend_plan` in a temporary repository. Step 1: the trigger must be
// open; the one the model may open itself is `interface-break`, accepted iff its evidence command fails in the active
// worktree. Step 2: the amended skeleton passes the rules of §3.2.4 (only the amendment's own findings count) and leaves
// checked tasks (ticked or merged) as they are.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { renderPlan, type Skeleton, skeletonHash, type Task } from "../core/local/plan.ts";
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
