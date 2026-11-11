// Local mode L7.T4 (design §3.0.2, §3.5.5; plan S29, D53): the plan store, its triggers, and the merged units a plan's
// dependencies are read against.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BranchRecord } from "../core/local/branches.ts";
import type { PlanRecord, Skeleton } from "../core/local/plan.ts";
import { createPlanStore, mergedUnits, PLAN_TYPE } from "../core/local/plans.ts";

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
