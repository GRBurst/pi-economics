// Local mode L6.T6 (design §3.4.2 steps 1–3, AC-M2; plan S26): the refusals that run before any check or review. Each leaves
// main where it was and never calls the overseer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRANCH_STATES } from "../core/local/branches.ts";
import { REASONS, reasonText, refusal } from "../core/local/merge.ts";
import type { Facts, MergeReason } from "../core/local/merge.ts";
import { tempBase } from "./git-repo.ts";
import { mergeRig } from "./merge-rig.ts";

test("refusal: the table over every Facts, in the fixed order of S26", () => {
  const order: Array<[MergeReason, (f: Facts) => boolean]> = [
    ["main-branch", (f) => f.isMain], ["abandoned", (f) => f.state === "abandoned"], ["blocked", (f) => f.state === "blocked"],
    ["fixer-running", (f) => f.state === "fixer"], ["dirty", (f) => f.dirty], ["behind", (f) => f.behind],
  ];
  let n = 0;
  for (const isMain of [false, true]) for (const state of [undefined, ...BRANCH_STATES]) for (const dirty of [false, true]) for (const behind of [false, true]) {
    const f: Facts = { isMain, state, dirty, behind };
    assert.equal(refusal(f), order.find(([, p]) => p(f))?.[0], JSON.stringify(f));
    n++;
  }
  assert.equal(n, 48);
});

test("reasonText: the texts (Q18), one per reason", () => {
  const x = { branch: "lm/x", main: "main", worktree: "/w/lm--x", fixer: "fixer-1", lines: "151", files: "7", maxLines: "150", maxFiles: "6",
    cmd: "npm test", exit: "1", tail: "boom", err: "fatal: x", checkout: "/r" };
  const texts: Record<MergeReason, string> = {
    "main-branch": "lm/x is a main branch; make a branch with start_branch and request its merge",
    dirty: "the worktree /w/lm--x has uncommitted changes; commit them, then request again",
    behind: "main is not an ancestor of the branch; rebase onto main in the worktree, then request again",
    "fixer-running": "fixes were delegated to fixer-1; wait for its report, then call request_merge",
    abandoned: "lm/x is abandoned; start a new branch",
    blocked: "lm/x is blocked: the fixer's changes were rejected again; abandon the branch and start a new one with a smaller goal",
    size: "the branch changes 151 lines in 7 files (at most 150 lines and 6 files); split the branch",
    scope: "the branch changes files outside its plan task",
    check: "`npm test` exit 1\nboom",
    "main-dirty": "the main checkout /r has uncommitted changes; the merge needs it clean",
    "plan-changed": "the plan changed since the branch started",
    "no-worktree": "lm/x has no worktree; start_branch makes one",
    "review-unavailable": "error: review unavailable",
    aborted: "aborted",
    git: "git failed: fatal: x",
  };
  assert.deepEqual([...REASONS].sort(), Object.keys(texts).sort());
  for (const r of REASONS) assert.equal(reasonText(r, x), texts[r], r);
});

/** A rig with one started branch that has one commit (x.ts), ready to merge but for what a case changes. */
async function ready(settings?: Record<string, unknown>) {
  const m = mergeRig({ settings });
  const rec = await m.start("x");
  m.r.commit("x.ts", "x\n", "x", rec.worktree);
  return { ...m, rec, before: m.mainSha() };
}
async function refused(m: Awaited<ReturnType<typeof ready>>, reason: MergeReason, input: { branch?: string } = {}) {
  const res = await m.merge(input);
  assert.equal(res.status, "refused", JSON.stringify(res));
  assert.equal(res.reason, reason);
  assert.equal(m.reviews.length, 0, "no review");
  assert.equal(m.mainSha(), m.before, "main unchanged");
  return res;
}

test("AC-M2 main-branch: a main branch is refused", async () => {
  const m = await ready();
  const res = await refused(m, "main-branch", { branch: "main" });
  assert.equal(res.detail, reasonText("main-branch", { branch: "main" }));
});

test("AC-M2 dirty: uncommitted changes in the worktree", async () => {
  const m = await ready();
  writeFileSync(join(m.rec.worktree, "scratch"), "s\n");
  const res = await refused(m, "dirty");
  assert.equal(res.detail, reasonText("dirty", { worktree: m.rec.worktree }));
  assert.equal(res.commit, m.r.git(["rev-parse", "HEAD"], m.rec.worktree));
});

test("AC-M2 behind: main moved past the branch point", async () => {
  const m = await ready();
  m.r.commit("README", "r\nmoved\n", "main moves");
  m.before = m.mainSha();
  const res = await refused(m, "behind");
  assert.equal(res.detail, reasonText("behind", { main: "main" }));
});

test("AC-M2 abandoned, blocked, fixer-running: the state in the store (without a branch: the one a fixer owns, or a blocked one)", async () => {
  for (const [state, reason, input] of [["abandoned", "abandoned", { branch: "lm/x" }], ["blocked", "blocked", {}], ["fixer", "fixer-running", {}]] as const) {
    const m = await ready();
    m.store.put({ ...m.rec, state, ...(state === "fixer" && { fixer: "fx-1" }) });
    const res = await refused(m, reason, input);
    assert.equal(res.detail, reasonText(reason, { branch: "lm/x", fixer: "fx-1" }));
  }
});

test("AC-M2 size: 151 lines, then 7 files", async () => {
  const m = await ready();
  m.r.commit("big.ts", Array.from({ length: 150 }, (_, i) => `${i}\n`).join(""), "big", m.rec.worktree); // + x.ts = 151
  const res = await refused(m, "size");
  assert.equal(res.detail, reasonText("size", { lines: "151", files: "2", maxLines: "150", maxFiles: "6" }));
  const n = await ready();
  for (let i = 0; i < 6; i++) n.r.commit(`f${i}.ts`, "1\n", `f${i}`, n.rec.worktree); // + x.ts = 7 files, 7 lines
  const res2 = await refused(n, "size");
  assert.equal(res2.detail, reasonText("size", { lines: "7", files: "7", maxLines: "150", maxFiles: "6" }));
});

test("AC-M2 no-worktree: a branch without a worktree, and no branch at all", async () => {
  const m = await ready();
  m.r.git(["branch", "lm/none"]);
  const res = await refused(m, "no-worktree", { branch: "lm/none" });
  assert.equal(res.detail, reasonText("no-worktree", { branch: "lm/none" }));
  const n = mergeRig();
  const res2 = await n.merge();
  assert.equal(res2.status, "refused");
  assert.equal(res2.reason, "no-worktree");
});

test("a branch made by hand in a worktree (D40) passes steps 1–3; a directory outside a repository is a git error", async () => {
  const m = mergeRig();
  const wt = join(m.r.base, "hand");
  m.r.git(["worktree", "add", "-q", "-b", "hand", wt]);
  m.r.commit("h.ts", "h\n", "h", wt);
  const res = await m.merge({ branch: "hand" });
  assert.notEqual(res.status, "refused", JSON.stringify(res));
  const res2 = await m.merge({ branch: "hand" }, tempBase().base);
  assert.equal(res2.status, "error");
  assert.equal(res2.reason, "git");
});

// ── step 5: checks (L6.T7, AC-M2 `check`) ──
/** A rig whose branch check is `check`, with one commit (x.ts). */
async function checked(check: string, settings?: Record<string, unknown>) {
  const m = mergeRig({ settings });
  const rec = await m.start("x", check);
  m.r.commit("x.ts", "x\n", "x", rec.worktree);
  return { ...m, rec, before: m.mainSha() };
}

test("AC-M2 check: a failing branch check refuses with its exit and the output tail", async () => {
  const m = await checked("echo boom; false");
  const res = await refused(m, "check");
  assert.equal(res.detail, reasonText("check", { cmd: "echo boom; false", exit: "1", tail: "boom" }));
  assert.equal(res.detail, "`echo boom; false` exit 1\nboom");
});

test("AC-M2 check: extraChecks run after the branch check; the first failure refuses", async () => {
  const m = await checked("true", { mergeGate: { extraChecks: ["true", "(exit 3)", "echo never"] } });
  const res = await refused(m, "check");
  assert.equal(res.detail, "`(exit 3)` exit 3"); // a subshell: `exit` in the login shell would run bash_logout
  assert.deepEqual(m.runs.map((x) => x.cmd), ["true", "true", "(exit 3)"]);
});

test("checks that pass reach the red run (step 6); they run in the worktree", async () => {
  const m = await checked("test -f only-in-branch", { mergeGate: { extraChecks: ["true"], redRun: false } });
  m.r.commit("only-in-branch", "1\n", "b", m.rec.worktree);
  const res = await m.merge();
  assert.notEqual(res.reason, "check", JSON.stringify(res));
  assert.deepEqual(m.runs, [{ cmd: "test -f only-in-branch", cwd: m.rec.worktree }, { cmd: "true", cwd: m.rec.worktree }]);
});

test("review F7: a branch check the git classifier blocks is not run; refused check (a record from before start_branch checked it)", async () => {
  const m = await checked("true");
  const cmd = `true && git -C ${m.r.dir} merge --ff-only lm/x`;
  m.store.put({ ...m.rec, check: cmd });
  const res = await refused(m, "check");
  assert.deepEqual(m.runs, [], "nothing ran");
  assert.equal(res.detail, `the check \`${cmd}\` was not run: merging into main goes through request_merge`);
});
