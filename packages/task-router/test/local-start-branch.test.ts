// Local mode L5.T5 (design §3.3.2, AC-W1; plan D36, D37, D40): `startBranch` over a real temporary repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRANCH_TYPE, createBranchStore } from "../core/local/branches.ts";
import { createGit, gitRunner } from "../core/local/git.ts";
import { startBranch } from "../core/local/worktree.ts";
import { parseSettings } from "../core/settings.ts";
import { tempBase, tempRepo } from "./git-repo.ts";

function rig(settings: Record<string, unknown> = { mode: "local" }) {
  const r = tempRepo();
  const entries: { type: string; data: unknown }[] = [];
  const store = createBranchStore((type, data) => entries.push({ type, data }));
  const git = createGit(gitRunner("git", r.env));
  const s = parseSettings(settings).settings;
  const start = (input: unknown, cwd = r.dir) => startBranch({ git, store, settings: s }, input, cwd);
  /** Everything a failed call must leave as it was: worktrees, refs, entries, records. */
  const snapshot = async () => JSON.stringify([await git.worktrees(r.dir), r.git(["for-each-ref"]), entries, store.all()]);
  return { r, git, store, entries, start, snapshot, settings: s };
}
const X = { slug: "x", goal: "g", check: "true" };

test("AC-W1: a slug, goal and check give branch lm/x at the main tip in <parent>/repo.worktrees/lm--x", async () => {
  const { r, git, store, entries, start } = rig();
  const tip = r.commit("a.ts", "a\n");
  const res = await start(X);
  const wt = join(r.base, "repo.worktrees", "lm--x");
  assert.deepEqual(res, { ok: true, value: { branch: "lm/x", worktree: wt, base: tip, check: "true" } });
  assert.deepEqual((await git.worktrees(r.dir)).map((w) => [w.dir, w.branch, w.head]), [[r.dir, "main", tip], [wt, "lm/x", tip]]);
  assert.equal(r.git(["rev-parse", "lm/x"]), tip);
  assert.deepEqual(store.all(), [{ repo: r.dir, branch: "lm/x", worktree: wt, base: tip, state: "active", rejections: 0, fixerRuns: 0, goal: "g", check: "true" }]);
  assert.deepEqual(entries, [{ type: BRANCH_TYPE, data: store.all()[0] }]);
  assert.deepEqual([store.facts.mainCheckout.get(r.dir), store.facts.worktrees.get(r.dir)], [r.dir, [r.dir, wt]]); // D39
});

test("AC-W1: the same call again gives the same result; worktrees, branches and entries are unchanged", async () => {
  const { r, start, snapshot } = rig();
  const first = await start(X);
  assert.ok(first.ok);
  const before = await snapshot();
  assert.deepEqual(await start(X), first);
  assert.equal(await snapshot(), before);
  assert.equal(r.git(["branch", "--list", "lm/*"]).split("\n").length, 1);
});

test("starting another branch and then the first again re-activates it (D38): the newest start is the active one", async () => {
  const { store, entries, start } = rig();
  await start(X);
  await start({ ...X, slug: "y" });
  assert.equal(store.active()!.branch, "lm/y");
  const again = await start(X);
  assert.ok(again.ok);
  assert.equal(store.active()!.branch, "lm/x");
  assert.equal(entries.length, 3);
});

test("a re-activation takes the new goal and check; base and counts stay", async () => {
  const { store, start } = rig();
  await start(X);
  store.put({ ...store.get(store.all()[0]!.repo, "lm/x")!, rejections: 2 });
  const res = await start({ ...X, goal: "g2", check: "npm test" });
  assert.ok(res.ok && res.value.check === "npm test");
  const rec = store.all()[0]!;
  assert.deepEqual([rec.goal, rec.check, rec.rejections], ["g2", "npm test", 2]);
});

const FAILURES: [string, unknown, RegExp][] = [
  ["slug and plan", { ...X, plan: { slug: "p", id: "m1" } }, /either a slug or a plan, not both/],
  ["neither", { goal: "g", check: "true" }, /a slug or a plan is required/],
  ["a slug outside the pattern", { ...X, slug: "X_y" }, /slug must match \^\[a-z0-9-\]\{1,40\}\$/],
  ["a slug that is no string", { ...X, slug: 7 }, /slug must match/],
  ["a 41 character slug", { ...X, slug: "a".repeat(41) }, /slug must match/],
  // L5 follow-up: `lm/p--m1` and the plan unit `lm/p/m1` would share the directory `lm--p--m1`.
  ["a slug with `--` (its directory could be a plan unit's)", { ...X, slug: "p--m1" }, /slug must not contain "--"/],
  ["no goal", { slug: "x", check: "true" }, /goal is required/],
  ["an empty goal", { ...X, goal: "" }, /goal is required/],
  ["a goal over 300 characters", { ...X, goal: "g".repeat(301) }, /goal is longer than 300 characters/],
  ["no check", { slug: "x", goal: "g" }, /check is required/],
  ["a check over 300 characters", { ...X, check: "c".repeat(301) }, /check is longer than 300 characters/],
  ["a relative repo", { ...X, repo: "rel/dir" }, /repo must be an absolute path/],
  ["plan (plans are not active)", { plan: { slug: "p", id: "m1" } }, /plans are not active/],
  ["no input", undefined, /slug or a plan is required/],
];
for (const [name, input, why] of FAILURES) {
  test(`failure: ${name}; nothing changes`, async () => {
    const { start, snapshot } = rig();
    const before = await snapshot();
    const res = await start(input);
    assert.ok(!res.ok && why.test(res.errors.join("; ")), JSON.stringify(res));
    assert.equal(await snapshot(), before);
  });
}

test("failure: the directory is no repository", async () => {
  const { start, snapshot } = rig();
  const before = await snapshot();
  const { base } = tempBase();
  const res = await start(X, base);
  assert.ok(!res.ok && res.errors[0]!.includes(`${base} is not in a git repository`), JSON.stringify(res));
  assert.equal(await snapshot(), before);
});

test("failure: no main branch exists", async () => {
  const { r, start, snapshot } = rig();
  r.git(["branch", "-m", "main", "trunk"]);
  const before = await snapshot();
  const res = await start(X);
  assert.ok(!res.ok && res.errors[0]!.includes("none of the main branches (main, master) exists"), JSON.stringify(res));
  assert.equal(await snapshot(), before);
});

test("failure: a file where the worktree goes → git's message, nothing changes", async () => {
  const { r, start, snapshot } = rig();
  mkdirSync(join(r.base, "repo.worktrees"));
  writeFileSync(join(r.base, "repo.worktrees", "lm--x"), "in the way\n");
  const before = await snapshot();
  const res = await start(X);
  assert.ok(!res.ok && res.errors[0]!.includes("already exists"), JSON.stringify(res));
  assert.equal(await snapshot(), before);
});

test("failure: the branch exists without a worktree → git's message, nothing changes", async () => {
  const { r, start, snapshot } = rig();
  r.git(["branch", "lm/x"]);
  const before = await snapshot();
  const res = await start(X);
  assert.ok(!res.ok && res.errors[0]!.includes("already exists"), JSON.stringify(res));
  assert.equal(await snapshot(), before);
});

test("a branch in the state merged, fixer or blocked is not re-activated; an abandoned one is", async () => {
  const { store, start } = rig();
  await start(X);
  const rec = store.all()[0]!;
  for (const state of ["merged", "fixer", "blocked"] as const) {
    store.put({ ...rec, state });
    const res = await start(X);
    assert.ok(!res.ok && res.errors[0]!.includes(`lm/x is ${state}`), `${state}: ${JSON.stringify(res)}`);
    assert.equal(store.all()[0]!.state, state);
  }
  store.put({ ...rec, state: "abandoned" });
  assert.ok((await start(X)).ok);
  assert.equal(store.all()[0]!.state, "active");
});

test("settings: branchPrefix, an absolute root with {repo}, and the first main branch that exists", async () => {
  const { r, git, start } = rig({ mode: "local", worktrees: { branchPrefix: "w-", root: "{repo}-wt" }, mergeGate: { mainBranches: ["master", "main"] } });
  const res = await start({ ...X, slug: "q" });
  assert.deepEqual(res.ok && [res.value.branch, res.value.worktree], ["w-q", join(r.dir, "repo-wt", "w-q")]);
  r.git(["branch", "master"]);
  r.commit("m.ts", "m\n", "m", r.dir); // main moves on; master stays at the first commit
  const second = await start({ ...X, slug: "z" });
  assert.ok(second.ok && second.value.base === (await git.sha(r.dir, "master")) && second.value.base !== (await git.sha(r.dir, "main")));
});

test("the repo parameter names the repository; the session cwd may be anywhere", async () => {
  const { r, start } = rig();
  const { base } = tempBase();
  const res = await start({ ...X, repo: r.dir }, base);
  assert.ok(res.ok && res.value.worktree === join(r.base, "repo.worktrees", "lm--x"));
});

// --- L5.T6: the start_branch tool, the active set, the section line (plan S25, D40, D48) ---------------------------------

import { activeSet } from "../core/local/mode.ts";
import { harness } from "./harness.ts";

const SCHEMA = JSON.parse(`{ "type": "object", "additionalProperties": false,
  "properties": {
    "slug": { "type": "string", "pattern": "^[a-z0-9-]{1,40}$" },
    "plan": { "type": "object", "required": ["slug", "id"], "properties": { "slug": {"type": "string"}, "id": {"type": "string"} } },
    "goal": { "type": "string", "maxLength": 300 },
    "check": { "type": "string", "maxLength": 300 },
    "repo": { "type": "string", "description": "absolute path; default: the session cwd's repository" }
  } }`);
function toolRig(settings: Record<string, unknown> = { mode: "local" }, entries: unknown[] = []) {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  const h = harness({ settings: settings as never, extra: { git } as never });
  const ctx = { sessionManager: { getSessionId: () => "s-main", getBranch: () => entries }, cwd: r.dir };
  h.f.fire("session_start", {}, ctx);
  return { r, git, h, ctx };
}

test("start_branch: registered in local mode with the §3.3.2 schema; not in default mode; on or off by worktrees.enabled", () => {
  const tool = toolRig().h.f.tools.get("start_branch");
  assert.ok(tool);
  assert.deepEqual(tool.parameters, SCHEMA);
  assert.equal(toolRig({}).h.f.tools.has("start_branch"), false);
  assert.equal(toolRig({ worktrees: { enabled: "on" } }).h.f.tools.has("start_branch"), true);
  assert.equal(toolRig({ mode: "local", worktrees: { enabled: "off" } }).h.f.tools.has("start_branch"), false);
});

test("start_branch result (D48): the value as text and as details; no isError", async () => {
  const { r, h, ctx } = toolRig();
  const tip = r.git(["rev-parse", "main"]);
  const res = await h.f.callTool("start_branch", X, ctx);
  const value = { branch: "lm/x", worktree: join(r.base, "repo.worktrees", "lm--x"), base: tip, check: "true" };
  assert.deepEqual(res, { content: [{ type: "text", text: JSON.stringify(value) }], details: value });
  // Besides the merge gate's main-ref baseline (review F2): one branch entry.
  assert.deepEqual(h.f.entries.map((e) => e.type).filter((t) => t !== "task-router/main-ref"), ["task-router/branch"]);
});

test("start_branch error (D48): git's or the validator's message as text, details {status: error, reason}, isError", async () => {
  const { h, ctx } = toolRig();
  const res = await h.f.callTool("start_branch", { slug: "X_y", goal: "g", check: "c" }, ctx);
  const reason = "slug must match ^[a-z0-9-]{1,40}$";
  assert.deepEqual(res, { content: [{ type: "text", text: reason }], details: { status: "error", reason }, isError: true });
  assert.deepEqual(h.f.entries, []);
});

test("the branch store is rebuilt at session_start from the session's entries", async () => {
  const a = toolRig();
  await a.h.f.callTool("start_branch", X, a.ctx);
  const saved = a.h.f.entries.map((e) => ({ type: "custom", customType: e.type, data: e.data }));
  const b = toolRig({ mode: "local" }, saved);
  assert.deepEqual(b.h.router.branches.all().map((r) => [r.branch, r.state]), [["lm/x", "active"]]);
  assert.equal(b.h.router.branches.active()!.goal, "g");
});

test("D40: activeSet — worktrees and mergeGate by their switches; plans only with both", () => {
  const set = (o: Record<string, unknown>) => activeSet(parseSettings(o).settings);
  assert.deepEqual(set({ mode: "local" }), { worktrees: true, mergeGate: true, plans: true });
  assert.deepEqual(set({}), { worktrees: false, mergeGate: false, plans: false });
  assert.deepEqual(set({ mode: "local", worktrees: { enabled: "off" } }), { worktrees: false, mergeGate: true, plans: false });
  assert.deepEqual(set({ mode: "local", mergeGate: { enabled: "off" } }), { worktrees: true, mergeGate: false, plans: false });
  assert.deepEqual(set({ mode: "local", plans: { enabled: "off" } }), { worktrees: true, mergeGate: true, plans: false });
  assert.deepEqual(set({ mergeGate: { enabled: "on" } }), { worktrees: false, mergeGate: true, plans: false });
  assert.deepEqual(set({ worktrees: { enabled: "on" }, mergeGate: { enabled: "on" }, plans: { enabled: "on" } }), { worktrees: true, mergeGate: true, plans: true });
});
