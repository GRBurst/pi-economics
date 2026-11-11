// Local mode L5.T10 (design §3.3.4): removing a merged branch's worktree and branch (a failure is a hint, never a throw) and
// marking a branch `abandoned` when its worktree disappears. Real git in a temporary repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRANCH_TYPE, createBranchStore } from "../core/local/branches.ts";
import { createGit, gitRunner } from "../core/local/git.ts";
import { cleanupBranch, refreshAbandoned, startBranch, type StartDeps } from "../core/local/worktree.ts";
import { parseSettings } from "../core/settings.ts";
import { harness } from "./harness.ts";
import { tempRepo } from "./git-repo.ts";

function rig() {
  const r = tempRepo();
  const entries: { type: string; data: unknown }[] = [];
  const store = createBranchStore((type, data) => entries.push({ type, data }));
  const git = createGit(gitRunner("git", r.env));
  const d: StartDeps = { git, store, settings: parseSettings({ mode: "local" }).settings };
  const start = async (slug: string) => {
    const res = await startBranch(d, { slug, goal: "g", check: "true" }, r.dir);
    assert.ok(res.ok, JSON.stringify(res));
    return res.value;
  };
  return { r, git, store, entries, d, start };
}
const rec = (x: ReturnType<typeof rig>, branch: string) => x.store.get(x.r.dir, branch)!;

test("cleanupBranch: a clean merged worktree and its branch are removed; the facts follow", async () => {
  const x = rig();
  const { worktree } = await x.start("a");
  assert.equal(await cleanupBranch(x.d, rec(x, "lm/a")), undefined);
  assert.ok(!existsSync(worktree));
  assert.equal(await x.git.sha(x.r.dir, "lm/a"), undefined);
  assert.deepEqual((await x.git.worktrees(x.r.dir)).map((w) => w.dir), [x.r.dir]);
  assert.deepEqual(x.store.facts.worktrees.get(x.r.dir), [x.r.dir]);
});

test("cleanupBranch: a dirty worktree is kept → 'cleanup failed: <git's tail>', nothing thrown, the record untouched", async () => {
  const x = rig();
  const { worktree } = await x.start("a");
  writeFileSync(join(worktree, "scratch"), "s\n");
  const before = JSON.stringify([x.store.all(), x.entries]);
  const out = await cleanupBranch(x.d, rec(x, "lm/a"));
  assert.ok(out?.startsWith("cleanup failed: ") && out.includes("contains modified or untracked files"), out);
  assert.ok(existsSync(worktree));
  assert.notEqual(await x.git.sha(x.r.dir, "lm/a"), undefined);
  assert.equal(JSON.stringify([x.store.all(), x.entries]), before);
});

test("cleanupBranch: a branch with commits not in main is kept (the worktree goes); the message says why", async () => {
  const x = rig();
  const { worktree } = await x.start("a");
  x.r.commit("w.ts", "w\n", "w", worktree);
  const out = await cleanupBranch(x.d, rec(x, "lm/a"));
  assert.ok(out?.startsWith("cleanup failed: ") && /not fully merged/.test(out), out);
  assert.ok(!existsSync(worktree));
  assert.notEqual(await x.git.sha(x.r.dir, "lm/a"), undefined);
});

test("cleanupBranch: git failing altogether is a message, not an exception", async () => {
  const x = rig();
  await x.start("a");
  const broken = createGit(async () => ({ exit: 127, out: "", err: "spawn git ENOENT", timedOut: false }));
  const out = await cleanupBranch({ ...x.d, git: broken }, rec(x, "lm/a"));
  assert.equal(out, "cleanup failed: spawn git ENOENT");
});

test("refreshAbandoned: a worktree deleted by hand → the branch is abandoned (one entry); start_branch of the slug is then an error", async () => {
  const x = rig();
  const { worktree } = await x.start("a");
  await x.start("b");
  const entriesBefore = x.entries.length;
  rmSync(worktree, { recursive: true });
  await refreshAbandoned(x.d);
  assert.deepEqual(x.store.all().map((r) => [r.branch, r.state]), [["lm/a", "abandoned"], ["lm/b", "active"]]);
  assert.equal(x.entries.length, entriesBefore + 1);
  assert.deepEqual(x.entries.at(-1), { type: BRANCH_TYPE, data: rec(x, "lm/a") });
  const again = await startBranch(x.d, { slug: "a", goal: "g", check: "true" }, x.r.dir);
  assert.ok(!again.ok && again.errors[0]!.includes("already exists"), JSON.stringify(again));
  assert.equal(rec(x, "lm/a").state, "abandoned");
  await refreshAbandoned(x.d); // nothing new to mark
  assert.equal(x.entries.length, entriesBefore + 1);
});

test("refreshAbandoned: a worktree removed with git, a pruned one → abandoned too; merged, abandoned and intact ones stay", async () => {
  const x = rig();
  await x.start("a");
  const b = await x.start("b");
  await x.start("c");
  const m = await x.start("m");
  x.store.put({ ...rec(x, "lm/m"), state: "merged" });
  await x.git.worktreeRemove(x.r.dir, m.worktree);
  await x.git.worktreeRemove(x.r.dir, b.worktree);
  rmSync(join(x.r.base, "repo.worktrees", "lm--a"), { recursive: true });
  x.r.git(["worktree", "prune"]);
  await refreshAbandoned(x.d);
  assert.deepEqual(x.store.all().map((r) => [r.branch, r.state]), [["lm/a", "abandoned"], ["lm/b", "abandoned"], ["lm/c", "active"], ["lm/m", "merged"]]);
});

test("refreshAbandoned: when git cannot list the worktrees nothing is marked", async () => {
  const x = rig();
  await x.start("a");
  const broken = createGit(async () => ({ exit: 128, out: "", err: "fatal", timedOut: false }));
  await refreshAbandoned({ ...x.d, git: broken });
  assert.equal(rec(x, "lm/a").state, "active");
});

test("session_start marks an abandoned branch from the session's entries (before start_branch can run)", async () => {
  const x = rig();
  const { worktree } = await x.start("a");
  const saved = x.entries.map((e) => ({ type: "custom", customType: e.type, data: e.data }));
  rmSync(worktree, { recursive: true });
  const h = harness({ settings: { mode: "local" } as never, extra: { git: x.git } as never });
  const ctx = { sessionManager: { getSessionId: () => "s-main", getBranch: () => saved }, cwd: x.r.dir };
  h.f.fire("session_start", {}, ctx);
  const res = await h.f.callTool("start_branch", { slug: "a", goal: "g", check: "true" }, ctx);
  assert.equal(res.isError, true);
  assert.deepEqual(h.router.branches.all().map((r) => [r.branch, r.state]), [["lm/a", "abandoned"]]);
  // The merge gate's main-ref baseline (review F2) may land after it; the branch entry is the last of the others.
  assert.equal(h.f.entries.filter((e) => e.type !== "task-router/main-ref").at(-1)!.type, BRANCH_TYPE);
  assert.equal(h.router.branches.active(), undefined);
});
