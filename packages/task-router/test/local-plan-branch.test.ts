// Local mode L7.T9 (design §3.3.2; AC-W2): `start_branch {plan: {slug, id}}` in a temporary repository. A plan-bound branch
// needs an approved plan whose skeleton hash is unchanged (on the main tip and in the main checkout), all its dependencies
// merged and the unit the milestone's `branch` names; a refusal changes nothing. A valid unit gets `lm/<slug>/<id>`, and the
// result names the task's whitelist and its check(s).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderPlan, type Skeleton, skeletonHash } from "../core/local/plan.ts";
import { type StartDeps, startBranch, worktreeDir } from "../core/local/worktree.ts";
import { planRig, type PlanRig } from "./plan-rig.ts";

const SK: Skeleton = {
  invariants: ["parse stays pure"],
  milestones: [
    { id: "M1", goal: "a parser", acceptance: ["the parser test passes"], branch: "task", dependsOn: [], tasks: [
      { id: "M1.T1", goal: "write the parser", files: ["src/a.ts"], create: ["src/parse.ts"], forbidden: [], check: "test -f src/parse.ts", dependsOn: [] },
      { id: "M1.T2", goal: "wire it", files: ["src/b.ts"], forbidden: [], check: "grep -q parse src/b.ts", dependsOn: ["M1.T1"] },
    ] },
    { id: "M2", goal: "tests", acceptance: [], branch: "milestone", dependsOn: ["M1"], tasks: [
      { id: "M2.T1", goal: "test it", files: ["test/a.test.ts"], forbidden: [], check: "grep -q parse test/a.test.ts", dependsOn: [] },
      { id: "M2.T2", goal: "wire the test", files: ["src/b.ts", "test/a.test.ts"], forbidden: [], check: "test -s src/b.ts", dependsOn: ["M2.T1"] },
    ] },
  ],
};
const FILE = "docs/plans/parser.md";

/** The rig with the plan approved: its file committed on main and its record in the plan store. */
function approved(sk: Skeleton = SK): PlanRig & { d: StartDeps } {
  const x = planRig();
  x.r.commit(FILE, renderPlan({ slug: "parser", request: "add a parser" }, sk, new Set()), "plan(parser): approved rv-1");
  x.plans.put({ slug: "parser", repo: x.r.dir, file: FILE, skeletonHash: skeletonHash(sk), approvedBy: "rv-1", triggers: [] });
  return { ...x, d: { git: x.git, store: x.branches, settings: x.settings, plans: x.plans } };
}
/** Everything a refusal must leave as it was: refs, worktrees, the entries. */
const state = (x: PlanRig): string =>
  [x.r.git(["for-each-ref"]), x.r.git(["worktree", "list", "--porcelain"]), JSON.stringify(x.entries)].join("\n");
const merged = (x: PlanRig, id: string): void =>
  x.branches.put({ repo: x.r.dir, branch: `lm/parser/${id}`, worktree: join(x.r.base, id), base: x.mainSha(), plan: { slug: "parser", id },
    state: "merged", rejections: 0, fixerRuns: 0 });
async function refused(x: PlanRig & { d: StartDeps }, id: string, slug = "parser"): Promise<string> {
  const before = state(x);
  const r = await startBranch(x.d, { plan: { slug, id } }, x.r.dir);
  assert.equal(r.ok, false, `${id} must be refused`);
  assert.equal(state(x), before, "a refusal changes nothing");
  return r.ok ? "" : r.errors.join("; ");
}

test("AC-W2 a missing plan is refused, and the repository is unchanged", async () => {
  const x = approved();
  const e = await refused(x, "M1.T1", "lexer");
  assert.equal(e, `no approved plan lexer in ${x.r.dir}; plan_request makes one`);
});

test("AC-W2 an unmet dependency is refused, and the repository is unchanged", async () => {
  const x = approved();
  assert.equal(await refused(x, "M1.T2"), "M1.T2 depends on M1.T1, not merged yet");
  merged(x, "M1.T1");
  assert.equal(await refused(x, "M2"), "M2 depends on M1, not merged yet", "M1 merges with its last task");
});

test("AC-W2 a changed skeleton hash is refused: the plan file edited by bash in the main checkout, or changed on main", async () => {
  const x = approved();
  const path = join(x.r.dir, FILE), text = readFileSync(path, "utf8");
  const edited = text.replace('"check": "test -f src/parse.ts"', '"check": "true"');
  assert.notEqual(edited, text);
  writeFileSync(path, edited);
  const why = `the plan file ${FILE} changed since its approval (its skeleton hash differs); change the plan with amend_plan`;
  assert.equal(await refused(x, "M1.T1"), why);
  x.r.commit(FILE, edited, "edit the plan");
  assert.equal(await refused(x, "M1.T1"), why, "committed on main");
  const y = approved();
  y.r.git(["rm", "-q", FILE]);
  y.r.git(["-c", "commit.gpgsign=false", "commit", "-q", "-m", "drop the plan"]);
  assert.equal(await refused(y, "M1.T1"), `the plan file ${FILE} is not on main`);
});

test("AC-W2 a unit that does not match its milestone's branch is refused, as is an unknown or merged one", async () => {
  const x = approved();
  merged(x, "M1.T1");
  merged(x, "M1.T2");
  assert.equal(await refused(x, "M2.T1"), "M2.T1 is part of M2, which is one branch; start M2");
  assert.equal(await refused(x, "M1"), "M1 has a branch per task; start one of its tasks");
  assert.equal(await refused(x, "M3.T1"), "the plan parser has no task or milestone M3.T1");
  assert.equal(await refused(x, "M1.T1"), "M1.T1 is merged already");
});

test("AC-W2 a valid task: branch lm/<slug>/<id>, its whitelist and check; again it is the same worktree", async () => {
  const x = approved();
  writeFileSync(join(x.r.dir, FILE), readFileSync(join(x.r.dir, FILE), "utf8").replace("- [ ] M1.T1:", "- [x] M1.T1:"));
  const r = await startBranch(x.d, { plan: { slug: "parser", id: "M1.T1" } }, x.r.dir);
  assert.ok(r.ok, JSON.stringify(r));
  const dir = worktreeDir(x.settings.worktrees.root, x.r.dir, "lm/parser/M1.T1");
  assert.deepEqual(r.value, { branch: "lm/parser/M1.T1", worktree: dir, base: x.mainSha(), check: "test -f src/parse.ts", files: ["src/a.ts", "src/parse.ts"] });
  assert.ok(existsSync(join(dir, FILE)), "the worktree holds the plan");
  assert.deepEqual(x.branches.active(), { repo: x.r.dir, branch: "lm/parser/M1.T1", worktree: dir, base: x.mainSha(), plan: { slug: "parser", id: "M1.T1" },
    state: "active", rejections: 0, fixerRuns: 0, goal: "write the parser", check: "test -f src/parse.ts" });
  const n = x.entries.length;
  const again = await startBranch(x.d, { plan: { slug: "parser", id: "M1.T1" } }, x.r.dir);
  assert.deepEqual(again, r);
  assert.equal(x.entries.length, n, "idempotent");
});

test("AC-W2 a milestone branch: the union of its tasks' files, all their checks", async () => {
  const x = approved();
  merged(x, "M1.T1");
  merged(x, "M1.T2");
  const r = await startBranch(x.d, { plan: { slug: "parser", id: "M2" } }, x.r.dir);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.value.branch, "lm/parser/M2");
  assert.deepEqual(r.value.files, ["test/a.test.ts", "src/b.ts"]);
  assert.equal(r.value.check, "(grep -q parse test/a.test.ts) && (test -s src/b.ts)");
  assert.equal(x.branches.active()?.goal, "tests");
});

test("without the plan store (plans off) a plan stays refused", async () => {
  const x = approved();
  const r = await startBranch({ ...x.d, plans: undefined }, { plan: { slug: "parser", id: "M1.T1" } }, x.r.dir);
  assert.deepEqual(r, { ok: false, errors: ["plans are not active"] });
});
