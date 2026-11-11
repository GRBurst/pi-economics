// Local mode L7.T4, L7.T13 (design §3.0.2, §3.5.5, §3.4.4; plan S29, D53, D54): the plan store, its triggers, the merged units a
// plan's dependencies are read against, and the triggers opened by main turns (`over-budget`) and the fixer (`remediation-failed`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRANCH_TYPE, type BranchRecord } from "../core/local/branches.ts";
import { renderPlan, skeletonHash, type PlanRecord, type Skeleton } from "../core/local/plan.ts";
import { createPlanStore, mergedUnits, PLAN_TYPE } from "../core/local/plans.ts";
import { startBranch } from "../core/local/worktree.ts";
import { fakeGit } from "./fake-git.ts";
import { harness } from "./harness.ts";
import { mergeRig, REVISE } from "./merge-rig.ts";

const rec = (o: Partial<PlanRecord> = {}): PlanRecord =>
  ({ slug: "parser", repo: "/r/x", file: "docs/plans/parser.md", skeletonHash: "a".repeat(64), approvedBy: "rv-1", triggers: [], ...o });
function store() {
  const entries: { type: "custom"; customType: string; data: unknown }[] = [];
  return { s: createPlanStore((customType, data) => entries.push({ type: "custom", customType, data })), entries };
}

test("put/open/close append task-router/plan entries that rebuild the same records", () => {
  const { s, entries } = store();
  s.put(rec());
  s.put(rec({ slug: "docs", file: "docs/plans/docs.md" }));
  s.open("parser", "over-budget", "M1.T1");
  s.close("parser", "t1");
  s.open("parser", "interface-break");
  assert.ok(entries.every((e) => e.customType === PLAN_TYPE));
  assert.equal(entries.length, 5);
  const again = store().s;
  again.rebuild([{ type: "custom", customType: "other", data: {} }, { type: "custom", customType: PLAN_TYPE, data: { slug: 1 } }, ...entries]);
  assert.deepEqual(again.all(), s.all());
  assert.deepEqual(again.get("parser")!.triggers, [
    { id: "t1", kind: "over-budget", task: "M1.T1", open: false }, { id: "t2", kind: "interface-break", open: true }]);
  assert.equal(again.get("none"), undefined);
});

test("D53: trigger ids are t<n>, sequential per plan", () => {
  const { s } = store();
  s.put(rec());
  s.put(rec({ slug: "docs" }));
  assert.equal(s.open("parser", "non-whitelisted", "M1.T1"), "t1");
  assert.equal(s.open("parser", "regression", "M1.T2"), "t2");
  assert.equal(s.open("docs", "regression", "M1.T2"), "t1");
  s.close("parser", "t2");
  assert.equal(s.open("parser", "regression", "M1.T2"), "t3");
  assert.equal(s.open("none", "regression"), undefined);
});

test("open of an already-open (kind, task) returns the same id, appending nothing", () => {
  const { s, entries } = store();
  s.put(rec());
  assert.equal(s.open("parser", "over-budget", "M1.T1"), "t1");
  const n = entries.length;
  assert.equal(s.open("parser", "over-budget", "M1.T1"), "t1");
  assert.equal(entries.length, n);
  assert.equal(s.open("parser", "over-budget", "M1.T2"), "t2");
  assert.equal(s.open("parser", "non-whitelisted", "M1.T1"), "t3");
  assert.deepEqual(s.openTriggers("parser").map((t) => t.id), ["t1", "t2", "t3"]);
});

test("records are copies", () => {
  const { s } = store();
  const r = rec();
  s.put(r);
  r.triggers.push({ id: "t9", kind: "regression", open: true });
  s.get("parser")!.triggers.push({ id: "t9", kind: "regression", open: true });
  assert.deepEqual(s.get("parser"), rec());
});

const SK: Skeleton = { invariants: [], milestones: [
  { id: "M1", goal: "g", acceptance: [], branch: "task", dependsOn: [], tasks: ["M1.T1", "M1.T2"].map((id) => ({ id, goal: "g", files: ["a"], forbidden: [], check: "c", dependsOn: [] })) },
  { id: "M2", goal: "g", acceptance: [], branch: "milestone", dependsOn: [], tasks: ["M2.T1", "M2.T2"].map((id) => ({ id, goal: "g", files: ["a"], forbidden: [], check: "c", dependsOn: [] })) },
] };
const branch = (slug: string, id: string, state: BranchRecord["state"]): BranchRecord =>
  ({ repo: "/r/x", branch: `lm/${slug}/${id}`, worktree: "w", base: "main", plan: { slug, id }, state, rejections: 0, fixerRuns: 0 });

test("merged units: a merged task branch, a merged milestone branch with its tasks, a milestone whose tasks all merged", () => {
  assert.deepEqual([...mergedUnits(SK, "parser", [branch("parser", "M1.T1", "merged"), branch("parser", "M1.T2", "active")])], ["M1.T1"]);
  assert.deepEqual([...mergedUnits(SK, "parser", [branch("parser", "M1.T1", "merged"), branch("parser", "M1.T2", "merged")])].sort(), ["M1", "M1.T1", "M1.T2"]);
  assert.deepEqual([...mergedUnits(SK, "parser", [branch("parser", "M2", "merged")])].sort(), ["M2", "M2.T1", "M2.T2"]);
  assert.deepEqual([...mergedUnits(SK, "parser", [branch("other", "M2", "merged"), branch("parser", "M2", "blocked")])], []);
  const plain = { ...branch("parser", "M1.T1", "merged"), plan: undefined };
  assert.deepEqual([...mergedUnits(SK, "parser", [plain])], []);
});

// ── L7.T13 (design §3.5.5, §3.4.4; D54): over-budget by main turns, remediation-failed ──
const WT = "/r/x.worktrees/lm--parser--M1.T1";
/** A main session with the plan `parser` and its active branch lm/parser/M1.T1; `turn(...calls)` fires the calls and a turn_end. */
function session(settings: Record<string, unknown>) {
  const g = fakeGit({ repos: [{ root: "/r/x" }] });
  void g.git.worktreeAdd("/r/x", WT, "lm/parser/M1.T1", "main");
  const h = harness({ settings: { mode: "local", ...settings } as never, extra: { git: g.git } as never });
  const bound: BranchRecord = { ...branch("parser", "M1.T1", "active"), worktree: WT, files: ["a"] };
  let plan: PlanRecord = rec();
  const ctx = { cwd: "/r/x", sessionManager: { getSessionId: () => "s-main", getBranch: () => [
    { type: "custom", customType: PLAN_TYPE, data: plan }, { type: "custom", customType: BRANCH_TYPE, data: bound }] } };
  h.f.fire("session_start", {}, ctx);
  /** The session starts again with the plan record `p` (the store rebuilds it; the process keeps its counts). */
  const restart = (p: PlanRecord): void => { plan = p; h.f.fire("session_start", {}, ctx); };
  let n = 0;
  const turn = (...calls: Array<[string, unknown]>): void => {
    for (const [toolName, input] of calls) h.f.fire("tool_call", { toolName, toolCallId: `c${++n}`, input }, ctx);
    h.f.fire("turn_end", {}, ctx);
  };
  const triggers = () => h.f.entries.filter((e: { type: string }) => e.type === PLAN_TYPE).map((e) => (e.data as PlanRecord).triggers).at(-1) ?? [];
  return { h, turn, triggers, restart };
}

for (const hints of ["on", "off"]) {
  test(`over-budget: taskTurns + 1 main turns with a call in the active worktree open it; other turns do not count (hints ${hints})`, async () => {
    const x = session({ hints: { enabled: hints }, plans: { taskTurns: 2 } });
    await x.h.router.settled();
    x.turn(["edit", { path: `${WT}/a`, edits: [] }]);
    x.turn(["read", { path: "a" }], ["bash", { command: "ls /r/x" }]);
    x.turn();
    x.turn(["bash", { command: `cd ${WT} && npm test` }]);
    assert.deepEqual(x.triggers(), [], "two counted turns");
    x.turn(["read", { path: `${WT}/a` }], ["bash", { command: `git -C ${WT} status` }]);
    assert.deepEqual(x.triggers(), [{ id: "t1", kind: "over-budget", task: "M1.T1", open: true }]);
    x.turn(["read", { path: `${WT}/a` }]);
    assert.equal(x.h.f.entries.filter((e: { type: string }) => e.type === PLAN_TYPE).length, 1, "opened once");
  });
}

test("review L7 F8: once the turns' over-budget trigger is closed, the count starts again; not a new trigger per turn", async () => {
  const x = session({ plans: { taskTurns: 2 } });
  await x.h.router.settled();
  for (let i = 0; i < 3; i++) x.turn(["edit", { path: `${WT}/a`, edits: [] }]);
  assert.deepEqual(x.triggers(), [{ id: "t1", kind: "over-budget", task: "M1.T1", open: true }]);
  x.restart({ ...rec(), triggers: [{ id: "t1", kind: "over-budget", task: "M1.T1", open: false }] }); // an amendment closed it
  await x.h.router.settled();
  const n = () => x.h.f.entries.filter((e: { type: string }) => e.type === PLAN_TYPE).length, before = n();
  x.turn(["edit", { path: `${WT}/a`, edits: [] }]);
  x.turn(["edit", { path: `${WT}/a`, edits: [] }]);
  assert.equal(n(), before, "taskTurns turns since the trigger closed open nothing");
  x.turn(["edit", { path: `${WT}/a`, edits: [] }]);
  assert.deepEqual(x.triggers(), [{ id: "t1", kind: "over-budget", task: "M1.T1", open: false }, { id: "t2", kind: "over-budget", task: "M1.T1", open: true }]);
});

test("over-budget by turns: a slug branch (no plan) and plans off count nothing", async () => {
  const x = session({ plans: { enabled: "off", taskTurns: 1 } });
  await x.h.router.settled();
  for (let i = 0; i < 3; i++) x.turn(["edit", { path: `${WT}/a`, edits: [] }]);
  assert.deepEqual(x.triggers(), []);
});

const PSK: Skeleton = { invariants: [], milestones: [{ id: "M1", goal: "a parser", acceptance: [], branch: "task", dependsOn: [], tasks: [
  { id: "M1.T1", goal: "write the parser", files: ["src/a.ts"], forbidden: [], check: "test -f src/a.ts", dependsOn: [] }] }] };

test("remediation-failed: a plan-bound branch blocked by the fixer's last rejection opens it; the text names amend_plan", async () => {
  const x = mergeRig();
  const file = "docs/plans/parser.md";
  x.r.commit("src/a.ts", "export {};\n");
  x.r.commit(file, renderPlan({ slug: "parser", request: "add a parser" }, PSK, new Set()), "plan(parser): approved rv-0");
  const plans = createPlanStore(x.ports.append);
  plans.put(rec({ repo: x.r.dir, file, skeletonHash: skeletonHash(PSK) }));
  x.ports.plans = plans;
  const r = await startBranch({ git: x.git, store: x.store, settings: x.settings, plans }, { plan: { slug: "parser", id: "M1.T1" } }, x.r.dir);
  assert.ok(r.ok);
  writeFileSync(join(r.value.worktree, "src/a.ts"), "export const a = 1;\n");
  x.r.git(["add", "-A"], r.value.worktree);
  x.r.git(["-c", "commit.gpgsign=false", "commit", "-q", "-m", "work"], r.value.worktree);
  x.store.put({ ...x.store.get(x.r.dir, "lm/parser/M1.T1")!, fixerRuns: 1, rejections: 2 }); // a fixer round ran
  x.verdicts.push(REVISE);
  const text = "lm/parser/M1.T1 is blocked: the fixer's changes were rejected again; restructure the task with amend_plan";
  const blocked = await x.merge();
  assert.deepEqual([blocked.status, blocked.reason, blocked.detail], ["refused", "blocked", `${text} (trigger t1 is open)`]);
  assert.deepEqual(plans.get("parser")!.triggers, [{ id: "t1", kind: "remediation-failed", task: "M1.T1", open: true }]);
  const again = await x.merge();
  assert.deepEqual([again.reason, again.detail], ["blocked", `${text} (trigger t1 is open)`], "step 2 names the open trigger");
  plans.close("parser", "t1");
  assert.equal((await x.merge()).detail, text);
  assert.equal(plans.get("parser")!.triggers.length, 1, "step 2 opens none");
  assert.equal(x.reviews.length, 1);
});

test("reject counts an amendment's rejections on its trigger (L7.T15); the count survives a rebuild", () => {
  const { s, entries } = store();
  s.put(rec());
  s.open("parser", "over-budget", "M1.T1");
  assert.equal(s.reject("parser", "t1"), 1);
  assert.equal(s.reject("parser", "t1"), 2);
  assert.equal(s.reject("parser", "t9"), 0, "no such trigger");
  assert.equal(s.reject("none", "t1"), 0);
  const again = store().s;
  again.rebuild(entries.map((e) => ({ ...e })));
  assert.deepEqual(again.get("parser")!.triggers, [{ id: "t1", kind: "over-budget", task: "M1.T1", open: true, rejected: 2 }]);
  again.rebuild([{ type: "custom", customType: PLAN_TYPE, data: { ...rec(), triggers: [{ id: "t1", kind: "regression", open: true, rejected: "2" }] } }]);
  assert.equal(again.get("parser"), undefined, "a malformed count");
});
