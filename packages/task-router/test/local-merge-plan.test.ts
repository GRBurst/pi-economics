// Local mode L7.T12 (design §3.4.2 steps 3–6, §3.5.5; AC-M2 scope): request_merge for a plan-bound branch in a temporary
// repository. The plan at the commit must have the approved skeleton (`plan-changed`); a tick-only plan change counts toward
// no size, and a branch over its plan budget (`splitLines`/`splitFiles`) is refused `size` and opens `over-budget`; every
// changed file is in the unit's whitelist or is the plan file ticked for the unit's own tasks (`scope`, `non-whitelisted`);
// the checks are the unit's from the plan, then extraChecks, then the merged tasks' per `plans.regression` (`regression`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPlanStore } from "../core/local/plans.ts";
import { renderPlan, type Skeleton, skeletonHash } from "../core/local/plan.ts";
import { reasonText } from "../core/local/merge.ts";
import { type AmendChange, amendPlan, type PlanPorts } from "../core/local/planflow.ts";
import { startBranch } from "../core/local/worktree.ts";
import { mergeRig, REVISE } from "./merge-rig.ts";

const SK: Skeleton = {
  invariants: ["parse stays pure"],
  milestones: [{ id: "M1", goal: "a parser", acceptance: ["the parser test passes"], branch: "task", dependsOn: [], tasks: [
    { id: "M1.T1", goal: "write the parser", files: ["src/a.ts"], create: ["src/parse.ts"], forbidden: ["no new dependency"], check: "test -f src/parse.ts && grep -q wire src/b.ts", dependsOn: [] },
    { id: "M1.T2", goal: "wire it", files: ["src/b.ts"], forbidden: [], check: "grep -q parse src/b.ts", dependsOn: ["M1.T1"] },
  ] }],
};
const FILE = "docs/plans/parser.md";

/** A merge rig with the plan approved on main and a plan store in the ports; `start(id)` starts the unit's branch. */
function rig(settings: Record<string, unknown> = {}, sk: Skeleton = SK) {
  const x = mergeRig({ settings });
  x.r.commit("src/a.ts", "export function parse(s: string) { return s; }\n");
  x.r.commit("src/b.ts", "export const wire = 1;\n");
  x.r.commit(FILE, renderPlan({ slug: "parser", request: "add a parser" }, sk, new Set()), "plan(parser): approved rv-0");
  const plans = createPlanStore(x.ports.append);
  plans.put({ slug: "parser", repo: x.r.dir, file: FILE, skeletonHash: skeletonHash(sk), approvedBy: "rv-0", triggers: [] });
  x.ports.plans = plans;
  const start = async (id: string): Promise<string> => {
    const r = await startBranch({ git: x.git, store: x.store, settings: x.settings, plans }, { plan: { slug: "parser", id } }, x.r.dir);
    if (!r.ok) throw new Error(r.errors.join("; "));
    return r.value.worktree;
  };
  /** Writes the files in the worktree and commits them. */
  const work = (wt: string, files: Record<string, string>, message = "work"): void => {
    for (const [f, c] of Object.entries(files)) writeFileSync(join(wt, f), c);
    x.r.git(["add", "-A"], wt);
    x.r.git(["-c", "commit.gpgsign=false", "commit", "-q", "-m", message], wt);
  };
  const plan = (wt: string): string => readFileSync(join(wt, FILE), "utf8");
  const tick = (wt: string, id: string): string => plan(wt).replace(`- [ ] ${id}:`, `- [x] ${id}:`);
  const triggers = () => plans.get("parser")!.triggers;
  return { ...x, plans, start, work, plan, tick, triggers };
}

test("AC-M2 scope: a changed file outside the whitelist is refused and opens non-whitelisted; no review runs", async () => {
  const x = rig();
  const wt = await x.start("M1.T1");
  const before = x.mainSha();
  x.work(wt, { "src/parse.ts": "export {};\n", "src/b.ts": "export const wire = 2;\n" });
  const r = await x.merge();
  assert.equal(r.status, "refused");
  assert.equal(r.reason, "scope");
  assert.equal(r.detail, `${reasonText("scope", {})}: src/b.ts (trigger t1 is open)`);
  assert.deepEqual(x.triggers(), [{ id: "t1", kind: "non-whitelisted", task: "M1.T1", open: true }]);
  assert.equal(x.reviews.length, 0);
  assert.equal(x.mainSha(), before);
});

test("AC-M2 scope: a plan change that is no tick, or a tick of another task, is refused", async () => {
  const x = rig();
  const wt = await x.start("M1.T1");
  x.work(wt, { "src/parse.ts": "export {};\n", [FILE]: x.plan(wt).replace("Request: add a parser", "Request: add two parsers") });
  const r = await x.merge();
  assert.equal(r.reason, "scope");
  assert.equal(r.detail, `${reasonText("scope", {})}: ${FILE} (trigger t1 is open)`);
  const y = rig();
  const wy = await y.start("M1.T1");
  y.work(wy, { "src/parse.ts": "export {};\n", [FILE]: y.tick(wy, "M1.T2") });
  assert.equal((await y.merge()).reason, "scope", "M1.T2 is not this branch's task");
  assert.equal(y.reviews.length + x.reviews.length, 0);
});

test("review L7 F1: a file named like a rename (` => `, braces) or holding a newline is outside the whitelist; nothing merges", async () => {
  const x = rig({ plans: { splitFiles: 6 } });
  const wt = await x.start("M1.T1");
  const odd = ["src/{x => a.ts}", "lib/evil => src/a.ts", "src/a.ts\nsrc/parse.ts"];
  for (const f of odd) mkdirSync(join(wt, f, ".."), { recursive: true });
  const before = x.mainSha();
  x.work(wt, { "src/parse.ts": "export {};\n", ...Object.fromEntries(odd.map((f) => [f, "x\n"])) });
  const r = await x.merge();
  assert.equal(r.reason, "scope", r.detail);
  assert.equal(r.detail, `${reasonText("scope", {})}: ${odd.sort().join(", ")} (trigger t1 is open)`, "every odd name, as written; src/parse.ts is whitelisted");
  assert.equal(x.reviews.length, 0);
  assert.equal(x.mainSha(), before);
});

test("review L7 F11: a branch without a plan that changes an approved plan's file is refused plan-changed; no review, nothing merges", async () => {
  const x = rig();
  const s = await startBranch({ git: x.git, store: x.store, settings: x.settings, plans: x.plans }, { slug: "tidy", goal: "tidy up", check: "true" }, x.r.dir);
  assert.ok(s.ok);
  const before = x.mainSha();
  x.work(s.value.worktree, { [FILE]: x.plan(s.value.worktree).replace("wire it", "wire it twice"), "src/b.ts": "export const wire = 2;\n" });
  const r = await x.merge();
  assert.deepEqual([r.status, r.reason, r.detail], ["refused", "plan-changed",
    `the branch changes the approved plan file ${FILE}; a plan changes only through amend_plan (or a plan-bound branch's tick)`]);
  assert.equal(x.reviews.length, 0);
  assert.equal(x.mainSha(), before);
  const y = rig();
  const t = await startBranch({ git: y.git, store: y.store, settings: y.settings, plans: y.plans }, { slug: "tidy", goal: "tidy up", check: "true" }, y.r.dir);
  assert.ok(t.ok);
  y.work(t.value.worktree, { "src/b.ts": "export const wire = 2;\n" });
  assert.equal((await y.merge()).status, "merged", "a branch that leaves the plan file alone merges");
});

test("AC-M2 plan-changed: the skeleton at the commit differs from the approved one", async () => {
  const x = rig();
  const wt = await x.start("M1.T1");
  x.work(wt, { "src/parse.ts": "export {};\n", [FILE]: x.plan(wt).replace('"goal": "wire it"', '"goal": "wire it twice"') });
  const r = await x.merge();
  assert.equal(r.status, "refused");
  assert.equal(r.reason, "plan-changed");
  assert.equal(r.detail, reasonText("plan-changed", {}));
  assert.deepEqual(x.triggers(), []);
  assert.equal(x.reviews.length, 0);
});

test("AC-M2 a tick-only plan change counts toward no size; the unit's goal, check and invariants reach the review", async () => {
  const x = rig({ plans: { splitLines: 1 } });
  const wt = await x.start("M1.T1");
  x.work(wt, { "src/parse.ts": "export {};\n", [FILE]: x.tick(wt, "M1.T1") });
  const r = await x.merge({ summary: "the parser" });
  assert.equal(r.status, "merged", r.detail);
  const input = String(x.reviews[0]!.input);
  assert.ok(input.startsWith("Goal: write the parser\n"), input);
  assert.ok(input.includes("Check: `test -f src/parse.ts && grep -q wire src/b.ts` exit 0"), input);
  assert.ok(input.includes("Invariants: parse stays pure; M1.T1 forbidden: no new dependency"), input);
  assert.deepEqual(x.runs.map((c) => c.cmd), ["test -f src/parse.ts && grep -q wire src/b.ts"], "no red run: the plan's red run stands");
});

test("AC-M2 size over splitLines is refused and opens over-budget", async () => {
  const x = rig({ plans: { splitLines: 2 } });
  const wt = await x.start("M1.T1");
  x.work(wt, { "src/parse.ts": "a\nb\nc\n" });
  const r = await x.merge();
  assert.equal(r.reason, "size");
  assert.equal(r.detail, `${reasonText("size", { lines: "3", files: "1", maxLines: "2", maxFiles: "3" })} (trigger t1 is open)`);
  assert.deepEqual(x.triggers(), [{ id: "t1", kind: "over-budget", task: "M1.T1", open: true }]);
  assert.equal(x.reviews.length, 0);
});

// ── review L7 F2: a blocked plan-bound branch and the amendment that answers its remediation-failed trigger ──
/** M1.T1 started, worked on, and blocked by the fixer's last rejection (remediation-failed t1 open); the plan ports. */
async function blockedUnit() {
  const x = rig();
  const wt = await x.start("M1.T1");
  x.work(wt, { "src/parse.ts": "export {};\n" });
  x.store.update({ ...x.store.get(x.r.dir, "lm/parser/M1.T1")!, fixerRuns: 1, rejections: 2 }); // a fixer round ran
  x.verdicts.push(REVISE);
  assert.equal((await x.merge()).reason, "blocked");
  const ports: PlanPorts = { git: x.git, run: x.ports.run, overseer: x.overseer, branches: x.store, plans: x.plans, settings: x.settings,
    append: x.ports.append, tmp: x.ports.tmp };
  const amend = (changes: AmendChange[]) => amendPlan(ports, { slug: "parser", trigger: { id: "t1" }, changes, reason: "restructure" }, x.r.dir);
  return { x, wt, amend };
}
const T1 = SK.milestones[0]!.tasks[0]!, T2 = SK.milestones[0]!.tasks[1]!;

test("review L7 F2: start_branch of a blocked plan-bound branch names amend_plan and the open trigger", async () => {
  const { x } = await blockedUnit();
  const r = await startBranch({ git: x.git, store: x.store, settings: x.settings, plans: x.plans }, { plan: { slug: "parser", id: "M1.T1" } }, x.r.dir);
  assert.deepEqual(r, { ok: false, errors: ["lm/parser/M1.T1 is blocked: the fixer's changes were rejected again; restructure the task with amend_plan (trigger t1 is open)"] });
});

test("review L7 F2: blocked → amend_plan replaces the task → start_branch resumes the branch with its counts reset → merged", async () => {
  const { x, wt, amend } = await blockedUnit();
  const a = await amend([{ op: "replace", id: "M1.T1", task: { ...T1, check: "test -f src/parse.ts" } }]);
  assert.equal(a.status, "approved", a.detail);
  assert.ok(a.detail.endsWith('; lm/parser/M1.T1 is unblocked (its counts reset): resume it with start_branch {"plan": {"slug": "parser", "id": "M1.T1"}}'), a.detail);
  const s = await startBranch({ git: x.git, store: x.store, settings: x.settings, plans: x.plans }, { plan: { slug: "parser", id: "M1.T1" } }, x.r.dir);
  assert.ok(s.ok, JSON.stringify(s));
  const rec = x.store.get(x.r.dir, "lm/parser/M1.T1")!;
  assert.deepEqual([rec.state, rec.rejections, rec.fixerRuns, rec.check, rec.worktree], ["active", 0, 0, "test -f src/parse.ts", wt]);
  const behind = await x.merge();
  assert.equal(behind.reason, "behind", "the amendment moved main: the refusal says to rebase");
  x.r.git(["rebase", "-q", "main"], wt);
  const m = await x.merge();
  assert.equal(m.status, "merged", m.detail);
});

test("review L7 F2: an amendment that removes a blocked branch's task abandons the branch; one that answers its trigger unblocks it", async () => {
  const gone = await blockedUnit();
  const a = await gone.amend([{ op: "remove", id: "M1.T1" }, { op: "replace", id: "M1.T2", task: { ...T2, dependsOn: [] } }]);
  assert.equal(a.status, "approved", a.detail);
  assert.ok(a.detail.endsWith("; lm/parser/M1.T1 is abandoned: the plan has no M1.T1 now"), a.detail);
  assert.equal(gone.x.store.get(gone.x.r.dir, "lm/parser/M1.T1")!.state, "abandoned");
  const kept = await blockedUnit();
  const b = await kept.amend([{ op: "replace", id: "M1.T2", task: { ...T2, goal: "wire the parser in" } }]);
  assert.equal(b.status, "approved", b.detail);
  const rec = kept.x.store.get(kept.x.r.dir, "lm/parser/M1.T1")!;
  assert.deepEqual([rec.state, rec.rejections, rec.fixerRuns], ["active", 0, 0], "the remediation-failed trigger is answered");
});

const UNBLOCKS = "Approving unblocks lm/parser/M1.T1 (unit M1.T1): its counts reset, so it gets a full set of merge reviews and fixer runs again.";
const lastReview = (x: { reviews: Array<{ input: unknown }> }): string[] => String(x.reviews.at(-1)!.input).split("\n");

test("spot-check F3: the reviewer of an amendment that answers a blocked branch's trigger is told approving resets its counts", async () => {
  const kept = await blockedUnit(); // M1.T1 is untouched; its remediation-failed trigger is what the amendment answers
  const reviews = kept.x.reviews.length;
  await kept.amend([{ op: "replace", id: "M1.T2", task: { ...T2, goal: "wire the parser in" } }]);
  assert.equal(kept.x.reviews.length, reviews + 1);
  assert.ok(lastReview(kept.x).includes(UNBLOCKS), lastReview(kept.x).join(" | "));
  const changed = await blockedUnit(); // the unit itself changes
  await changed.amend([{ op: "replace", id: "M1.T1", task: { ...T1, check: "test -f src/parse.ts" } }]);
  assert.ok(lastReview(changed.x).includes(UNBLOCKS), lastReview(changed.x).join(" | "));
});

test("spot-check F3: no such line when approving would unblock nothing (another trigger, the blocked unit untouched)", async () => {
  const { x } = await blockedUnit();
  const t2 = x.plans.open("parser", "over-budget", "M1.T2")!;
  const reviews = x.reviews.length;
  const ports: PlanPorts = { git: x.git, run: x.ports.run, overseer: x.overseer, branches: x.store, plans: x.plans, settings: x.settings,
    append: x.ports.append, tmp: x.ports.tmp };
  const r = await amendPlan(ports, { slug: "parser", trigger: { id: t2 }, changes: [{ op: "replace", id: "M1.T2", task: { ...T2, goal: "wire the parser in" } }], reason: "split" }, x.r.dir);
  assert.equal(r.status, "approved", r.detail);
  assert.equal(x.reviews.length, reviews + 1);
  assert.ok(!lastReview(x).some((l) => l.startsWith("Approving unblocks")), lastReview(x).join(" | "));
  assert.equal(x.store.get(x.r.dir, "lm/parser/M1.T1")!.state, "blocked", "and nothing was unblocked");
});

/** M1.T1 merged (its record), then M1.T2 breaks M1.T1's check. */
async function regression(settings: Record<string, unknown> = {}) {
  const x = rig(settings);
  x.store.put({ repo: x.r.dir, branch: "lm/parser/M1.T1", worktree: join(x.r.base, "gone"), base: x.mainSha(), plan: { slug: "parser", id: "M1.T1" },
    state: "merged", rejections: 0, fixerRuns: 0 });
  x.r.commit("src/parse.ts", "export {};\n");
  const wt = await x.start("M1.T2");
  x.work(wt, { "src/b.ts": "export const parse = 2;\n" });
  return { x, r: await x.merge() };
}

test("AC-M2 an earlier task's check failing is refused check and opens regression", async () => {
  const { x, r } = await regression();
  assert.equal(r.reason, "check");
  assert.ok(r.detail.startsWith("`test -f src/parse.ts && grep -q wire src/b.ts` exit 1"), r.detail);
  assert.ok(r.detail.endsWith("(a regression of M1.T1; trigger t1 is open)"), r.detail);
  assert.deepEqual(x.triggers(), [{ id: "t1", kind: "regression", task: "M1.T2", open: true }]);
  assert.deepEqual(x.runs.map((c) => c.cmd), ["grep -q parse src/b.ts", "test -f src/parse.ts && grep -q wire src/b.ts"]);
  assert.equal(x.reviews.length, 0);
});

test("AC-M2 regression off: the merged tasks' checks are not run", async () => {
  const { x, r } = await regression({ plans: { regression: "off" } });
  assert.equal(r.status, "merged", r.detail);
  assert.deepEqual(x.runs.map((c) => c.cmd), ["grep -q parse src/b.ts"]);
  assert.deepEqual(x.triggers(), []);
});

test("a milestone branch: all its tasks' files and checks, the milestone's goal", async () => {
  const x = rig({}, { ...SK, milestones: [{ ...SK.milestones[0]!, branch: "milestone" }] });
  const wt = await x.start("M1");
  x.work(wt, { "src/parse.ts": "export {};\n", "src/b.ts": "export const wire = 1, parse = 2;\n", [FILE]: x.tick(wt, "M1.T1").replace("- [ ] M1.T2:", "- [x] M1.T2:") });
  const r = await x.merge();
  assert.equal(r.status, "merged", r.detail);
  assert.deepEqual(x.runs.map((c) => c.cmd), ["test -f src/parse.ts && grep -q wire src/b.ts", "grep -q parse src/b.ts"]);
  assert.ok(String(x.reviews[0]!.input).startsWith("Goal: a parser\n"));
});

test("review F7: an earlier task's check the git guard blocks is never run; the merge is refused check", async () => {
  const bad = "git push origin HEAD:main";
  const sk: Skeleton = { ...SK, milestones: [{ ...SK.milestones[0]!, tasks: [{ ...SK.milestones[0]!.tasks[0]!, check: bad }, SK.milestones[0]!.tasks[1]!] }] };
  const x = rig({}, sk);
  x.store.put({ repo: x.r.dir, branch: "lm/parser/M1.T1", worktree: join(x.r.base, "gone"), base: x.mainSha(), plan: { slug: "parser", id: "M1.T1" },
    state: "merged", rejections: 0, fixerRuns: 0 });
  const wt = await x.start("M1.T2");
  x.work(wt, { "src/b.ts": "export const parse = 2;\n" });
  const r = await x.merge();
  assert.equal(r.reason, "check");
  assert.ok(r.detail.startsWith(`the check \`${bad}\` was not run: `), r.detail);
  assert.ok(!x.runs.some((c) => c.cmd === bad), "never run");
  assert.equal(x.reviews.length, 0);
});
