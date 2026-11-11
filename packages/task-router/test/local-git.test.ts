// Local mode L5.T1 (design §3.3; plan S21, D35, D55): the git runner and the port over a real temporary repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

// --- L5.T3: the port for worktrees ------------------------------------------------------------------------------------

test("worktreeAdd creates the branch at base and the worktree; worktrees() lists it with its branch and head", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  const base = r.commit("a.ts", "a\n");
  const wt = join(r.base, "r.worktrees", "lm--x"); // the parent directory does not exist yet
  assert.deepEqual(await git.worktreeAdd(r.dir, wt, "lm/x", "main"), { ok: true, out: "" });
  const list = await git.worktrees(r.dir);
  assert.deepEqual(list.map((w) => [w.dir, w.branch, w.head]), [[r.dir, "main", base], [wt, "lm/x", base]]);
  assert.deepEqual((await git.worktrees(wt)).map((w) => w.dir), [r.dir, wt]); // the same list from a linked worktree
  assert.equal(r.git(["rev-parse", "lm/x"]), base);
});

test("sha: a ref's commit; undefined for a ref that does not exist", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  const c = r.commit("a.ts", "a\n");
  assert.equal(await git.sha(r.dir, "main"), c);
  assert.equal(await git.sha(r.dir, "refs/heads/main"), c);
  assert.equal(await git.sha(r.dir, "nosuch"), undefined);
  assert.equal(await git.sha(join(r.base, "missing"), "main"), undefined);
});

test("branchOf: the branch a directory has checked out; detached → undefined; a directory git cannot read → \"unknown\"", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  assert.equal(await git.branchOf(r.dir), "main");
  r.git(["checkout", "-q", "--detach"]);
  assert.equal(await git.branchOf(r.dir), undefined);
  assert.equal(await git.branchOf(join(r.base, "missing")), "unknown");
  const timedOut = createGit(async () => ({ exit: 124, out: "", err: "", timedOut: true }));
  assert.equal(await timedOut.branchOf(r.dir), "unknown");
});

test("dirty: any change, untracked file or staged change; a clean tree is not dirty", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  assert.equal(await git.dirty(r.dir), false);
  writeFileSync(join(r.dir, "new.txt"), "n\n");
  assert.equal(await git.dirty(r.dir), true);
  r.git(["add", "new.txt"]);
  assert.equal(await git.dirty(r.dir), true);
  r.git(["-c", "commit.gpgsign=false", "commit", "-q", "-m", "n"]);
  assert.equal(await git.dirty(r.dir), false);
  writeFileSync(join(r.dir, "README"), "changed\n");
  assert.equal(await git.dirty(r.dir), true);
});

test("worktreeRemove and branchDelete: a clean merged worktree goes, its branch too; a dirty one stays", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  const wt = join(r.base, "wt");
  await git.worktreeAdd(r.dir, wt, "lm/x", "main");
  writeFileSync(join(wt, "scratch"), "s\n");
  const refused = await git.worktreeRemove(r.dir, wt);
  assert.ok(!refused.ok && refused.err.length > 0, JSON.stringify(refused));
  assert.ok(existsSync(wt));
  rmSync(join(wt, "scratch"));
  assert.deepEqual(await git.worktreeRemove(r.dir, wt), { ok: true, out: "" });
  assert.ok(!existsSync(wt));
  assert.deepEqual((await git.worktrees(r.dir)).map((w) => w.dir), [r.dir]);
  const del = await git.branchDelete(r.dir, "lm/x");
  assert.ok(del.ok && /^Deleted branch lm\/x/.test(del.out), JSON.stringify(del));
  assert.equal(await git.sha(r.dir, "lm/x"), undefined);
});

test("a failing call is {ok: false, err} with err the stderr tail, at most 2048 characters", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  const bad = await git.worktreeAdd(r.dir, join(r.base, "w"), "lm/x", "nosuchbase");
  assert.ok(!bad.ok && /nosuchbase|invalid reference|not a valid/i.test(bad.err), JSON.stringify(bad));
  const none = await git.branchDelete(r.dir, "nosuch");
  assert.ok(!none.ok && none.err.length > 0);
  const long = createGit(async () => ({ exit: 1, out: "", err: "e".repeat(5000), timedOut: false }));
  const res = await long.branchDelete(r.dir, "x");
  assert.ok(!res.ok && res.err.length === 2048 && res.err === "e".repeat(2048));
  const slow = createGit(async () => ({ exit: 124, out: "", err: "", timedOut: true }));
  assert.deepEqual(await slow.worktreeRemove(r.dir, "d"), { ok: false, err: "git timed out" });
  const mute = createGit(async () => ({ exit: 3, out: "", err: "", timedOut: false }));
  assert.deepEqual(await mute.worktreeRemove(r.dir, "d"), { ok: false, err: "git exited 3" });
});

test("branchDelete without force refuses a branch with unmerged commits; with force it deletes it", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  r.git(["checkout", "-q", "-b", "side"]);
  r.commit("s.ts", "s\n");
  r.git(["checkout", "-q", "main"]);
  const refused = await git.branchDelete(r.dir, "side");
  assert.ok(!refused.ok && /not fully merged/.test(refused.err), JSON.stringify(refused));
  assert.ok((await git.branchDelete(r.dir, "side", true)).ok);
  assert.equal(await git.sha(r.dir, "side"), undefined);
});
