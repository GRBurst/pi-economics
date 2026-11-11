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
