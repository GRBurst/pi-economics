// Local mode L5.T1 (design §3.3; plan S21, D35, D55): the git runner and the port over a real temporary repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { createGit, gitRunner } from "../core/local/git.ts";
import { tempBase, tempRepo } from "./git-repo.ts";

test("root: the repository's top, a subdirectory and a worktree all give the realpath of the repository", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  assert.equal(await git.root(r.dir), realpathSync(r.dir));
  mkdirSync(join(r.dir, "sub"));
  assert.equal(await git.root(join(r.dir, "sub")), r.dir);
  const wt = join(r.base, "wt");
  r.git(["worktree", "add", "-q", "-b", "side", wt]);
  assert.equal(await git.root(wt), r.dir);
});

test("top: the top directory of the checkout that holds the directory (a worktree has its own)", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  mkdirSync(join(r.dir, "sub"));
  assert.equal(await git.top(join(r.dir, "sub")), r.dir);
  const wt = join(r.base, "wt");
  r.git(["worktree", "add", "-q", "-b", "side", wt]);
  assert.equal(await git.top(wt), wt);
});

test("root and top of a directory outside any repository are undefined; of a missing directory too", async () => {
  const { base, env } = tempBase();
  const git = createGit(gitRunner("git", env));
  assert.equal(await git.root(base), undefined);
  assert.equal(await git.top(base), undefined);
  assert.equal(await git.root(join(base, "missing")), undefined);
});

test("root of a bare repository is its git directory", async () => {
  const r = tempRepo();
  const bare = join(r.base, "bare.git");
  r.git(["clone", "-q", "--bare", r.dir, bare]);
  assert.equal(await createGit(gitRunner("git", r.env)).root(bare), bare);
});

test("timeout: a command that outlives it is killed with its process group → {timedOut: true, exit: 124}", async () => {
  const r = tempRepo();
  const t0 = Date.now();
  // The alias runs `sleep` in a shell: only a group kill ends both before the 30 s are over.
  const out = await gitRunner("git", r.env)(["-c", "alias.nap=!sleep 30", "nap"], r.dir, 100);
  assert.deepEqual([out.timedOut, out.exit], [true, 124]);
  assert.ok(Date.now() - t0 < 10_000, `${Date.now() - t0} ms`);
});

test("missing binary: exit 127 with the error text", async () => {
  const out = await gitRunner("git-nosuch")(["status"], tempBase().base, 1000);
  assert.equal(out.exit, 127);
  assert.equal(out.timedOut, false);
  assert.match(out.err, /ENOENT/);
});

test("stdin: a given text reaches the command; a command that reads stdin without one sees an end of input", async () => {
  const r = tempRepo();
  const run = gitRunner("git", r.env);
  const h = await run(["hash-object", "--stdin"], r.dir, 5000, { stdin: "x\n" });
  assert.deepEqual([h.exit, h.out.trim()], [0, "587be6b4c3f93f93c489c0111bba5596147a26cb"]);
  const e = await run(["hash-object", "--stdin"], r.dir, 5000);
  assert.deepEqual([e.exit, e.out.trim()], [0, "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"]); // the empty blob
});

test("a failing command reports its exit code and stderr, not an exception", async () => {
  const r = tempRepo();
  const out = await gitRunner("git", r.env)(["rev-parse", "--verify", "nosuch"], r.dir, 5000);
  assert.notEqual(out.exit, 0);
  assert.equal(out.timedOut, false);
  assert.ok(out.err.length > 0);
});
