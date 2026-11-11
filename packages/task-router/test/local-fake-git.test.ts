// Local mode L5.T4 (plan D56): test/fake-git.ts and real git answer the same worktree scenario the same way, so the logic tests
// that run on the fake do not drift from git.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createGit, gitRunner, type Git } from "../core/local/git.ts";
import { fakeGit } from "./fake-git.ts";
import { tempRepo } from "./git-repo.ts";

/** The scenario, in terms of results that do not depend on the implementation (no shas, no messages). */
async function scenario(git: Git, repo: string, wt: string, makeDirty: () => void, makeClean: () => void): Promise<unknown[]> {
  const seen: unknown[] = [];
  const ok = (r: { ok: boolean }) => seen.push(r.ok);
  seen.push((await git.worktrees(repo)).map((w) => [w.dir, w.branch]));
  ok(await git.worktreeAdd(repo, wt, "lm/x", "main"));
  ok(await git.worktreeAdd(repo, wt + "2", "lm/x", "main")); // the branch exists
  ok(await git.worktreeAdd(repo, wt + "3", "lm/y", "nosuch")); // no such base
  seen.push((await git.worktrees(repo)).map((w) => [w.dir, w.branch]));
  seen.push(await git.branchOf(wt), await git.branchOf(repo), await git.root(wt) === repo, await git.top(wt) === wt, await git.top(repo) === repo);
  seen.push((await git.sha(repo, "lm/x")) === (await git.sha(repo, "main")), await git.sha(repo, "refs/heads/lm/x") !== undefined, await git.sha(repo, "nosuch"));
  makeDirty();
  seen.push(await git.dirty(wt));
  ok(await git.worktreeRemove(repo, wt));
  makeClean();
  seen.push(await git.dirty(wt));
  ok(await git.branchDelete(repo, "lm/x")); // checked out: refused
  ok(await git.worktreeRemove(repo, wt));
  ok(await git.worktreeRemove(repo, wt)); // already gone
  ok(await git.branchDelete(repo, "lm/x"));
  ok(await git.branchDelete(repo, "lm/x")); // already gone
  seen.push((await git.worktrees(repo)).map((w) => [w.dir, w.branch]));
  return seen;
}

test("fake-git and real git agree on the worktree scenario", async () => {
  const r = tempRepo();
  const wt = join(r.base, "r.worktrees", "lm--x");
  const real = await scenario(createGit(gitRunner("git", r.env)), r.dir, wt,
    () => writeFileSync(join(wt, "scratch"), "s\n"), () => rmSync(join(wt, "scratch")));
  const f = fakeGit({ repos: [{ root: r.dir }] });
  const fake = await scenario(f.git, r.dir, wt, () => f.dirty.add(wt), () => f.dirty.delete(wt));
  assert.deepEqual(fake, real);
  assert.ok(real.length > 15);
});

test("fake-git: a path in the way, a scripted failure and the call log", async () => {
  const f = fakeGit({ repos: [{ root: "/r/x" }] });
  f.existing.add("/w/in-the-way");
  const bad = await f.git.worktreeAdd("/r/x", "/w/in-the-way", "lm/a", "main");
  assert.ok(!bad.ok && bad.err.includes("already exists"));
  f.fail.set("branchDelete", "boom");
  assert.deepEqual(await f.git.branchDelete("/r/x", "main"), { ok: false, err: "boom" });
  assert.deepEqual(f.calls, ["worktreeAdd /r/x /w/in-the-way lm/a main", "branchDelete /r/x main"]);
  assert.equal(await f.git.root("/elsewhere"), undefined);
});

/** L6.T5: the merge port's scenario (no shas in the results: comparisons and booleans). `commit(dir, file)` makes one commit
 *  in the checkout `dir` that adds `file` (one line) and returns its sha. */
async function mergeScenario(git: Git, repo: string, wt: string, commit: (dir: string, file: string) => string): Promise<unknown[]> {
  const seen: unknown[] = [];
  const paths = async (a: string, b: string) => (await git.numstat(repo, a, b))?.map((s) => [s.path, s.added, s.deleted]);
  seen.push((await git.worktreeAdd(repo, wt, "lm/x", "main")).ok);
  const c1 = commit(wt, "x.ts");
  seen.push(await paths("main", c1), await git.isAncestor(repo, "main", c1), await git.isAncestor(repo, c1, "main"));
  commit(repo, "m.ts"); // main moves on
  seen.push(await paths("main", c1), await git.isAncestor(repo, "main", c1), await paths("main", "nosuch"));
  seen.push((await git.ffMerge(repo, c1)).ok); // diverged
  seen.push((await git.tree(repo, c1)) !== undefined, (await git.tree(repo, c1)) === (await git.tree(repo, "lm/x")), await git.tree(repo, "nosuch"));
  const tmp = `${wt}-red`;
  seen.push((await git.worktreeAddDetached(repo, tmp, "main")).ok, await git.branchOf(tmp), (await git.sha(tmp, "HEAD")) === (await git.sha(repo, "main")));
  seen.push((await git.worktreeRemove(repo, tmp, true)).ok, (await git.worktrees(repo)).length);
  seen.push((await git.updateRef(repo, "refs/heads/main", c1, c1)).ok); // main is not at c1
  const wt2 = `${wt}-2`;
  seen.push((await git.worktreeAdd(repo, wt2, "lm/y", "main")).ok);
  const c2 = commit(wt2, "y.ts");
  seen.push((await git.ffMerge(repo, c2)).ok, (await git.sha(repo, "main")) === c2, (await git.sha(wt2, "HEAD")) === c2, (await git.sha(repo, "HEAD")) === c2);
  seen.push((await git.updateRef(repo, "refs/heads/lm/x", c2, c1)).ok, (await git.sha(repo, "lm/x")) === c2, (await git.sha(wt, "HEAD")) === c2);
  seen.push((await git.worktrees(repo)).map((w) => [w.branch, w.head === c2]));
  return seen;
}

test("fake-git and real git agree on the merge scenario (L6.T5)", async () => {
  const r = tempRepo();
  const wt = join(r.base, "r.worktrees", "lm--x");
  const real = await mergeScenario(createGit(gitRunner("git", r.env)), r.dir, wt, (dir, file) => r.commit(file, "1\n", file, dir));
  const f = fakeGit({ repos: [{ root: r.dir }] });
  const fake = await mergeScenario(f.git, r.dir, wt, (dir, file) => f.commit(dir, [{ path: file, added: 1, deleted: 0 }]));
  assert.deepEqual(fake, real);
  assert.ok(real.length > 20);
});

test("fake-git: push records the remote, the branch and its commit; an unknown remote and a scripted failure fail", async () => {
  const f = fakeGit({ repos: [{ root: "/r/x" }] });
  assert.equal((await f.git.push("/r/x", "origin", "main")).ok, true);
  assert.deepEqual(f.pushes, [`origin main ${"a".repeat(40)}`]);
  assert.equal((await f.git.push("/r/x", "nosuch", "main")).ok, false);
  f.fail.set("push", "rejected");
  assert.deepEqual(await f.git.push("/r/x", "origin", "main"), { ok: false, err: "rejected" });
});

/** L7.T5: a plan commit (D50) on the tip, read back through the merge port; a whole-word grep. */
async function planScenario(git: Git, repo: string): Promise<unknown[]> {
  const tip = (await git.sha(repo, "main"))!;
  const c = await git.commitFile(repo, tip, "docs/plans/p.md", "# Plan: p\nline\n", "plan(p): approved rv-1");
  const sha = c.ok ? c.out : "";
  return [c.ok, await git.isAncestor(repo, tip, sha), await git.numstat(repo, tip, sha), await git.sha(repo, "main") === tip,
    (await git.updateRef(repo, "refs/heads/main", sha, tip)).ok, await git.sha(repo, "main") === sha,
    await git.grepWord(repo, "foo", ["a.ts", "b.ts", "missing.ts"]), (await git.commitFile(repo, "0".repeat(40), "x", "x", "m")).ok];
}

test("fake-git and real git agree on the plan scenario (L7.T5)", async () => {
  const r = tempRepo();
  r.commit("a.ts", "foobar\n");
  r.commit("b.ts", "x = foo(1)\n");
  const real = await planScenario(createGit(gitRunner("git", r.env)), r.dir);
  const f = fakeGit({ repos: [{ root: r.dir, sha: r.git(["rev-parse", "main"]) }] });
  assert.deepEqual(await planScenario(f.git, r.dir), real);
  assert.deepEqual(real, [true, true, [{ path: "docs/plans/p.md", added: 2, deleted: 0 }], true, true, true, ["b.ts"], false]);
});
