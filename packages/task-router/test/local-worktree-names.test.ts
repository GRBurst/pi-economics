// Local mode L5.T2 (design §3.3.1; plan S21, S22, D35, D36): branch names, worktree directories, path containment and the
// porcelain parsers. Pure: no git runs here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNumstat, parseWorktrees, repoRootOf } from "../core/local/git.ts";
import { SLUG, branchName, inside, worktreeDir } from "../core/local/worktree.ts";
import { seeded } from "./rand.ts";

const ROOT = "../{repo}.worktrees";
const ALPHABET = [..."abcdefghijklmnopqrstuvwxyz0123456789-"];
/** A slug of the pattern: 1…40 characters of [a-z0-9-]; `dashes` false leaves out `-` runs of two (see the collision test). */
function slugs(n: number, dashes: boolean, seed = 3): string[] {
  const rnd = seeded(seed), out: string[] = [];
  while (out.length < n) {
    let s = "";
    for (let i = 1 + rnd(40); i > 0; i--) s += ALPHABET[rnd(ALPHABET.length)]!;
    if (dashes || !s.includes("--")) out.push(s);
  }
  return out;
}

test("SLUG: 1…40 characters of [a-z0-9-]", () => {
  for (const ok of ["x", "fix-parse", "0", "a".repeat(40), "-", "a--b"]) assert.ok(SLUG.test(ok), ok);
  for (const bad of ["", "X", "x_y", "a b", "a/b", "a".repeat(41), "é", "x\n"]) assert.ok(!SLUG.test(bad), JSON.stringify(bad));
  for (const s of slugs(200, true)) assert.ok(SLUG.test(s), s);
});

test("branchName: <prefix><slug> or <prefix><plan>/<id>", () => {
  assert.equal(branchName("lm/", { slug: "x" }), "lm/x");
  assert.equal(branchName("lm/", { plan: "p", id: "m1" }), "lm/p/m1");
  assert.equal(branchName("", { slug: "x" }), "x");
  assert.equal(branchName("w-", { plan: "p", id: "t2" }), "w-p/t2");
});

test("worktreeDir (D36): ∀ slug ∈ SLUG the default root gives <parent>/<repo>.worktrees/lm--<slug>, never inside the repository", () => {
  for (const slug of slugs(200, true)) {
    const dir = worktreeDir(ROOT, "/r/p/x", branchName("lm/", { slug }));
    assert.equal(dir, `/r/p/x.worktrees/lm--${slug}`);
    assert.ok(!inside(dir, "/r/p/x"), dir);
  }
  assert.equal(worktreeDir(ROOT, "/r/p/x", branchName("lm/", { plan: "p", id: "m1" })), "/r/p/x.worktrees/lm--p--m1");
});

test("worktreeDir: an absolute root as it is, {repo} replaced; a relative root without {repo} resolves against the repository root", () => {
  assert.equal(worktreeDir("/w/{repo}", "/r/p/x", "lm/s"), "/w/x/lm--s");
  assert.equal(worktreeDir("/w", "/r/p/x", "lm/s"), "/w/lm--s");
  assert.equal(worktreeDir("wt", "/r/p/x", "lm/s"), "/r/p/x/wt/lm--s");
  assert.equal(worktreeDir("../{repo}.worktrees/{repo}", "/r/p/x", "lm/s"), "/r/p/x.worktrees/x/lm--s");
});

test("worktreeDir is injective over slugs and plan units (without a `--` inside a part)", () => {
  const seen = new Map<string, string>();
  const rnd = seeded(5), parts = slugs(300, false);
  for (let i = 0; i < 600; i++) {
    const a = parts[rnd(parts.length)]!, b = parts[rnd(parts.length)]!;
    const branch = i % 2 ? branchName("lm/", { slug: a }) : branchName("lm/", { plan: a, id: b });
    const dir = worktreeDir(ROOT, "/r/p/x", branch);
    assert.equal(seen.get(dir) ?? branch, branch, `${dir}: ${seen.get(dir)} and ${branch}`);
    seen.set(dir, branch);
  }
  assert.ok(seen.size > 300);
});

test("known limit: with a `--` in a part two branches share a directory (git then refuses the second `worktree add`)", () => {
  assert.equal(worktreeDir(ROOT, "/r/x", branchName("lm/", { slug: "p--m1" })), worktreeDir(ROOT, "/r/x", branchName("lm/", { plan: "p", id: "m1" })));
});

test("inside: the directory itself and everything below it; not a sibling that shares the prefix, not an escape", () => {
  assert.ok(inside("/r/x", "/r/x"));
  assert.ok(inside("/r/x/a/b.ts", "/r/x"));
  assert.ok(inside("/r/x/a/../b.ts", "/r/x"));
  assert.ok(!inside("/r/xy", "/r/x"));
  assert.ok(!inside("/r/xy/a", "/r/x"));
  assert.ok(!inside("/r", "/r/x"));
  assert.ok(!inside("/r/x/../y", "/r/x"));
  assert.ok(!inside("/other", "/r/x"));
  const rnd = seeded(11), seg = () => slugs(1, true, rnd(1e6))[0]!;
  for (let i = 0; i < 200; i++) {
    const dir = `/${seg()}/${seg()}`, rest = seg();
    assert.ok(inside(`${dir}/${rest}`, dir), `${dir}/${rest}`);
    assert.ok(!inside(`${dir}${rest}`, dir), `${dir}${rest}`);
  }
});

test("repoRootOf (D35): the directory that holds `.git`, else the common directory itself", () => {
  assert.equal(repoRootOf("/r/p/x/.git"), "/r/p/x");
  assert.equal(repoRootOf("/r/p/x.git"), "/r/p/x.git");
  assert.equal(repoRootOf("/r/p/bare"), "/r/p/bare");
  assert.equal(repoRootOf("/r/.gitx/.git"), "/r/.gitx");
});

const H1 = "a".repeat(40), H2 = "b".repeat(40), H3 = "c".repeat(40), H4 = "d".repeat(40);
test("parseWorktrees: main checkout, linked, detached, locked, prunable, bare", () => {
  const text = [
    "worktree /r/main", `HEAD ${H1}`, "branch refs/heads/main", "",
    "worktree /w/lm--x", `HEAD ${H2}`, "branch refs/heads/lm/x", "",
    "worktree /w/detached dir", `HEAD ${H3}`, "detached", "",
    "worktree /w/locked", `HEAD ${H4}`, "branch refs/heads/lm/locked", "locked", "",
    "worktree /w/locked-why", `HEAD ${H4}`, "branch refs/heads/lm/why", "locked in use by someone", "",
    "worktree /w/gone", `HEAD ${H1}`, "branch refs/heads/lm/gone", "prunable gitdir file points to non-existent location", "",
  ].join("\n");
  assert.deepEqual(parseWorktrees(text), [
    { dir: "/r/main", head: H1, branch: "main" },
    { dir: "/w/lm--x", head: H2, branch: "lm/x" },
    { dir: "/w/detached dir", head: H3 },
    { dir: "/w/locked", head: H4, branch: "lm/locked", locked: true },
    { dir: "/w/locked-why", head: H4, branch: "lm/why", locked: true },
    { dir: "/w/gone", head: H1, branch: "lm/gone", prunable: true },
  ]);
  assert.deepEqual(parseWorktrees("worktree /r/bare.git\nbare\n\nworktree /w/a\nHEAD " + H1 + "\nbranch refs/heads/b\n"), [
    { dir: "/r/bare.git", head: "", bare: true },
    { dir: "/w/a", head: H1, branch: "b" },
  ]);
  assert.deepEqual(parseWorktrees(""), []);
  assert.deepEqual(parseWorktrees("garbage\n\n"), []);
});

test("parseNumstat: counts per path; binary files count as a file with 0/0; renames name the new path", () => {
  const text = [
    "3\t1\tsrc/a.ts",
    "-\t-\tlogo.png",
    "0\t0\tsrc/{old => new}/c.ts",
    "2\t2\told.ts => new.ts",
    "5\t0\t{ => lib}/d.ts",
    "1\t4\twith space.txt",
    "",
  ].join("\n");
  assert.deepEqual(parseNumstat(text), [
    { path: "src/a.ts", added: 3, deleted: 1 },
    { path: "logo.png", added: 0, deleted: 0 },
    { path: "src/new/c.ts", added: 0, deleted: 0 },
    { path: "new.ts", added: 2, deleted: 2 },
    { path: "lib/d.ts", added: 5, deleted: 0 },
    { path: "with space.txt", added: 1, deleted: 4 },
  ]);
  assert.deepEqual(parseNumstat(""), []);
  assert.deepEqual(parseNumstat("not a line\n"), []);
});
