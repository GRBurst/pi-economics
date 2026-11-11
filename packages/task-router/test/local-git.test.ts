// Local mode L5.T1, L6.T5, L7.T5 (design §3.3, §3.5.2; plan S21, D35, D50, D55): the git runner and the port over a real
// temporary repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

// --- L5.T12: diffStat (plan D42) ----------------------------------------------------------------------------------------

test("diffStat: committed, staged, unstaged and untracked changes against base; binary and empty files count as files", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  r.commit("keep.ts", "1\n2\n3\n4\n5\n", "keep");
  r.commit("gone.ts", "x\ny\n", "gone");
  const base = r.git(["rev-parse", "HEAD"]);
  const wt = join(r.base, "wt");
  await git.worktreeAdd(r.dir, wt, "lm/x", base);
  assert.deepEqual(await git.diffStat(wt, base), [], "nothing yet");
  r.commit("c.ts", "a\nb\nc\n", "committed", wt); // committed: 3 added
  writeFileSync(join(wt, "keep.ts"), "1\n2\nTHREE\n4\n5\n6\n"); // unstaged: 2 added, 1 deleted
  writeFileSync(join(wt, "s.ts"), "s1\ns2\n");
  r.git(["add", "s.ts"], wt); // staged: 2 added
  rmSync(join(wt, "gone.ts")); // deleted: 2 deleted
  writeFileSync(join(wt, "u.ts"), Array.from({ length: 101 }, (_, i) => `l${i}`).join("\n") + "\n"); // untracked: 101
  writeFileSync(join(wt, "no-newline.txt"), "a\nb"); // untracked, last line without a newline: 2
  writeFileSync(join(wt, "empty.txt"), ""); // untracked, empty: 0
  writeFileSync(join(wt, "bin.dat"), Buffer.from([0, 1, 2, 0, 255])); // untracked, binary: 0
  mkdirSync(join(wt, "dir", "deep"), { recursive: true });
  writeFileSync(join(wt, "dir", "deep", "n.txt"), "n\n"); // untracked in a new directory: 1
  writeFileSync(join(wt, "with space.txt"), "w\n"); // 1
  writeFileSync(join(wt, ".gitignore"), "ignored.log\n"); // untracked: 1
  writeFileSync(join(wt, "ignored.log"), "i\n".repeat(50)); // ignored: not counted
  const stat = await git.diffStat(wt, base);
  const by = Object.fromEntries(stat.map((s) => [s.path, [s.added, s.deleted]]));
  assert.deepEqual(by, {
    "c.ts": [3, 0], "keep.ts": [2, 1], "s.ts": [2, 0], "gone.ts": [0, 2], "u.ts": [101, 0], "no-newline.txt": [2, 0], "empty.txt": [0, 0],
    "bin.dat": [0, 0], "dir/deep/n.txt": [1, 0], "with space.txt": [1, 0], ".gitignore": [1, 0],
  });
  assert.equal(stat.length, 11);
});

test("diffStat: a failing or timed-out git, a directory that is no repository → [] and no exception", async () => {
  const r = tempRepo();
  assert.deepEqual(await createGit(async () => ({ exit: 124, out: "", err: "", timedOut: true })).diffStat(r.dir, "main"), []);
  assert.deepEqual(await createGit(async () => { throw new Error("boom"); }).diffStat(r.dir, "main"), []);
  assert.deepEqual(await createGit(gitRunner("git", r.env)).diffStat(join(r.base, "missing"), "main"), []);
  assert.deepEqual(await createGit(gitRunner("git", r.env)).diffStat(r.dir, "nosuchbase"), []);
});

test("diff: the changes against base as text, cut to maxLines with a last line that counts the rest; untracked files follow as one line each", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  r.commit("a.ts", "one\ntwo\nthree\n", "a");
  const base = r.git(["rev-parse", "HEAD"]);
  assert.equal(await git.diff(r.dir, base, undefined, 80), "", "nothing changed");
  writeFileSync(join(r.dir, "a.ts"), "one\nTWO\nthree\n");
  writeFileSync(join(r.dir, "new one.ts"), "x\ny\n");
  writeFileSync(join(r.dir, "bin.dat"), Buffer.from([0, 1]));
  const text = await git.diff(r.dir, base, undefined, 80);
  const lines = text.split("\n");
  assert.ok(lines[0]!.startsWith("diff --git a/a.ts b/a.ts"), lines[0]);
  assert.ok(lines.includes("-two") && lines.includes("+TWO"));
  assert.deepEqual(lines.slice(-2), ["untracked file bin.dat (0 lines)", "untracked file new one.ts (2 lines)"]);
  assert.ok(!text.includes("\u001b"), "no colour codes");
  // the cut: at most maxLines lines, the last one counting what was left out
  const cut = (await git.diff(r.dir, base, undefined, 4)).split("\n");
  assert.equal(cut.length, 4);
  assert.deepEqual(cut.slice(0, 3), lines.slice(0, 3));
  assert.equal(cut[3], `… ${lines.length - 3} more lines`);
  // two commits: a against b
  r.commit("b.ts", "b\n", "b");
  const second = await git.diff(r.dir, base, "HEAD", 80);
  assert.ok(second.includes("+++ b/b.ts") && !second.includes("untracked file"), second);
});

test("diff: failing, timing out or throwing → \"\"", async () => {
  const r = tempRepo();
  assert.equal(await createGit(async () => ({ exit: 124, out: "x", err: "", timedOut: true })).diff(r.dir, "main", undefined, 80), "");
  assert.equal(await createGit(async () => { throw new Error("boom"); }).diff(r.dir, "main", undefined, 80), "");
  assert.equal(await createGit(gitRunner("git", r.env)).diff(r.dir, "nosuchbase", undefined, 80), "");
  assert.equal(await createGit(gitRunner("git", r.env)).diff(join(r.base, "missing"), "main", undefined, 80), "");
});

// ── L6.T5: the port for merging (design §3.4.2; plan S21) ──
test("isAncestor: a commit and its ancestors are, a diverged one is not; an unknown ref is not (no exception)", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  const c1 = r.commit("a.ts", "a\n");
  r.git(["branch", "side"]);
  const c2 = r.commit("b.ts", "b\n");
  assert.equal(await git.isAncestor(r.dir, c1, c2), true);
  assert.equal(await git.isAncestor(r.dir, c2, c2), true);
  assert.equal(await git.isAncestor(r.dir, c2, c1), false);
  assert.equal(await git.isAncestor(r.dir, "main", "side"), false);
  assert.equal(await git.isAncestor(r.dir, "side", "main"), true);
  assert.equal(await git.isAncestor(r.dir, "nosuch", "main"), false);
  assert.equal(await git.isAncestor(join(r.base, "missing"), "main", "main"), false);
});

test("numstat(main...x): the branch's own changes, also after main moved on; a failure is undefined", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  const wt = join(r.base, "wt");
  r.git(["worktree", "add", "-q", "-b", "lm/x", wt]);
  r.commit("x.ts", "1\n2\n3\n", "x", wt);
  r.commit("README", "r\nchanged\n", "main moves"); // on main, after the branch point
  const x = r.git(["rev-parse", "lm/x"]);
  assert.deepEqual(await git.numstat(r.dir, "main", x), [{ path: "x.ts", added: 3, deleted: 0 }]);
  assert.deepEqual(await git.numstat(wt, "main", "HEAD"), [{ path: "x.ts", added: 3, deleted: 0 }]);
  assert.deepEqual(await git.numstat(r.dir, "main", "main"), []);
  assert.equal(await git.numstat(r.dir, "main", "nosuch"), undefined);
});

test("tree: a commit's tree; equal content, equal tree; unknown → undefined", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  const c1 = r.commit("a.ts", "a\n");
  assert.equal(await git.tree(r.dir, c1), r.git(["rev-parse", `${c1}^{tree}`]));
  r.git(["-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "empty"]);
  assert.equal(await git.tree(r.dir, "HEAD"), await git.tree(r.dir, c1));
  assert.equal(await git.tree(r.dir, "nosuch"), undefined);
});

test("worktreeAddDetached: a detached worktree at the commit; worktreeRemove(force) removes it with untracked files in it", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  const c1 = r.commit("a.ts", "a\n");
  r.commit("b.ts", "b\n");
  const tmp = join(r.base, "red");
  assert.deepEqual(await git.worktreeAddDetached(r.dir, tmp, c1), { ok: true, out: "" });
  assert.equal(await git.branchOf(tmp), undefined);
  assert.equal(r.git(["rev-parse", "HEAD"], tmp), c1);
  assert.equal(existsSync(join(tmp, "b.ts")), false);
  writeFileSync(join(tmp, "build.out"), "x\n");
  assert.equal((await git.worktreeRemove(r.dir, tmp)).ok, false, "without force a tree with untracked files stays");
  assert.deepEqual(await git.worktreeRemove(r.dir, tmp, true), { ok: true, out: "" });
  assert.equal(existsSync(tmp), false);
  assert.deepEqual((await git.worktrees(r.dir)).map((w) => w.dir), [r.dir]);
});

test("ffMerge: fast-forwards the branch checked out in the directory; refuses a diverged commit and changes nothing", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  const wt = join(r.base, "wt");
  r.git(["worktree", "add", "-q", "-b", "lm/x", wt]);
  const x = r.commit("x.ts", "x\n", "x", wt);
  assert.equal((await git.ffMerge(r.dir, x)).ok, true);
  assert.equal(r.git(["rev-parse", "main"]), x);
  assert.equal(r.git(["rev-list", "--count", "main"]), "2", "no merge commit");
  assert.equal(existsSync(join(r.dir, "x.ts")), true, "the main checkout's files follow");
  r.git(["-C", wt, "reset", "-q", "--hard", "HEAD~1"]);
  const y = r.commit("y.ts", "y\n", "y", wt); // diverged from main
  const before = r.git(["rev-parse", "main"]);
  assert.equal((await git.ffMerge(r.dir, y)).ok, false);
  assert.equal(r.git(["rev-parse", "main"]), before);
});

test("updateRef: moves a ref from the expected old value; a wrong old value fails and changes nothing", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  const c0 = r.git(["rev-parse", "main"]);
  r.git(["branch", "side"]);
  const c1 = r.commit("a.ts", "a\n");
  assert.equal((await git.updateRef(r.dir, "refs/heads/side", c1, c1)).ok, false, "side is not at c1");
  assert.equal(r.git(["rev-parse", "side"]), c0);
  assert.deepEqual(await git.updateRef(r.dir, "refs/heads/side", c1, c0), { ok: true, out: "" });
  assert.equal(r.git(["rev-parse", "side"]), c1);
});

test("push: the branch to a remote (a local bare repository); an unknown remote fails", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  const bare = join(r.base, "remote.git");
  r.git(["init", "-q", "--bare", bare], r.base);
  r.git(["remote", "add", "origin", bare]);
  const c1 = r.commit("a.ts", "a\n");
  assert.equal((await git.push(r.dir, "origin", "main")).ok, true);
  assert.equal(r.git(["rev-parse", "main"], bare), c1);
  assert.equal((await git.push(r.dir, "nosuch", "main")).ok, false);
});

// ── L7.T5: the port for plans (design §3.5.2; plan S21, D50) ──

test("grepWord: the files among the given ones that hold the word as a whole word", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  r.commit("src/a.ts", "export const foobar = 1;\n");
  r.commit("src/b.ts", "const x = foo(1);\n");
  r.commit("src/c.ts", "foo\n");
  assert.deepEqual(await git.grepWord(r.dir, "foo", ["src/a.ts", "src/b.ts"]), ["src/b.ts"]);
  assert.deepEqual(await git.grepWord(r.dir, "foo", ["src/a.ts"]), []);
  assert.deepEqual(await git.grepWord(r.dir, "foobar", ["src/a.ts", "src/b.ts", "src/c.ts"]), ["src/a.ts"]);
  assert.deepEqual(await git.grepWord(r.dir, "-e", ["src/a.ts"]), [], "a word is never an option");
  assert.deepEqual(await git.grepWord(r.dir, "foo", []), []);
});

test("lsFiles: the first n tracked paths", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  for (const f of ["a", "b", "c"]) r.commit(`src/${f}.ts`, `${f}\n`);
  assert.deepEqual(await git.lsFiles(r.dir, 10), ["README", "src/a.ts", "src/b.ts", "src/c.ts"]);
  assert.deepEqual(await git.lsFiles(r.dir, 2), ["README", "src/a.ts"]);
  assert.deepEqual(await git.lsFiles(join(r.base, "nowhere"), 2), []);
});

test("D50 commitFile: a commit on the tip whose tree differs only in that path; the main checkout is untouched", async () => {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  const tip = r.commit("src/a.ts", "a\n");
  writeFileSync(join(r.dir, "src/a.ts"), "edited\n");
  r.git(["add", "src/a.ts"]);
  writeFileSync(join(r.dir, "README"), "unstaged\n");
  const status = r.git(["status", "--porcelain"]), index = r.git(["ls-files", "-s"]);
  const c = await git.commitFile(r.dir, tip, "docs/plans/p.md", "# Plan: p\n", "plan(p): approved rv-1");
  assert.equal(c.ok, true);
  const sha = c.ok ? c.out : "";
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(r.git(["rev-parse", `${sha}^`]), tip);
  assert.equal(r.git(["log", "-1", "--format=%s", sha]), "plan(p): approved rv-1");
  assert.equal(r.git(["diff", "--name-status", tip, sha]), "A\tdocs/plans/p.md");
  assert.equal(r.git(["show", `${sha}:docs/plans/p.md`]), "# Plan: p");
  assert.equal(r.git(["rev-parse", "main"]), tip, "no ref moves");
  assert.equal(r.git(["status", "--porcelain"]), status);
  assert.equal(r.git(["ls-files", "-s"]), index);
  assert.equal(readFileSync(join(r.dir, "README"), "utf8"), "unstaged\n");
  assert.equal(existsSync(join(r.dir, "docs")), false);
  const again = await git.commitFile(r.dir, sha, "docs/plans/p.md", "# Plan: p\n- [x] M1.T1: a\n", "plan(p): amended rv-2");
  assert.equal(again.ok && r.git(["diff", "--name-status", sha, again.out]), "M\tdocs/plans/p.md");
  assert.equal((await git.commitFile(r.dir, "0".repeat(40), "x", "x", "m")).ok, false);
});
