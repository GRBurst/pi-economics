// An in-memory `Git` (core/local/git.ts) for the logic tests (plan D56): scripted repositories, refs, worktrees and dirty
// directories; every call is recorded. Typed `Git`, so a port method without a fake fails the type check. The tests that are
// about git's behaviour run real git (test/git-repo.ts); test/local-fake-git.test.ts keeps the two in step.
import type { Git, Res, Stat, Wt } from "../core/local/git.ts";
import { inside } from "../core/local/worktree.ts";

export type FakeRepo = {
  /** The repository's root (D35). */
  root: string;
  /** branch → commit (full names are `refs/heads/<branch>`; both spellings are accepted by `sha`). */
  refs: Map<string, string>;
  /** The main checkout first. */
  worktrees: Wt[];
};

export function fakeGit(o: { repos?: { root: string; main?: string; sha?: string }[] } = {}) {
  const repos = new Map<string, FakeRepo>();
  const calls: string[] = [];
  /** Directories that exist without being a worktree (a file or a directory in the way): `worktreeAdd` onto one fails. */
  const existing = new Set<string>();
  const dirty = new Set<string>();
  /** worktree → what `diffStat` answers (an Error is thrown, as a misbehaving port might). */
  const stats = new Map<string, Stat | Error>();
  /** worktree → what `diff` answers (cut to `maxLines`, as the real port does; an Error is thrown). */
  const diffs = new Map<string, string | Error>();
  /** method → the error its next calls fail with (`{ok: false, err}`); `undefined` entries are ignored. */
  const fail = new Map<string, string>();
  const addRepo = (root: string, main = "main", sha = "a".repeat(40)): FakeRepo => {
    const r: FakeRepo = { root, refs: new Map([[main, sha]]), worktrees: [{ dir: root, branch: main, head: sha }] };
    repos.set(root, r);
    return r;
  };
  for (const r of o.repos ?? []) addRepo(r.root, r.main, r.sha);
  const repoOf = (dir: string): FakeRepo | undefined => {
    for (const r of repos.values()) if (r.worktrees.some((w) => inside(dir, w.dir)) || inside(dir, r.root)) return r;
    return undefined;
  };
  const wtOf = (dir: string): Wt | undefined =>
    repoOf(dir)?.worktrees.filter((w) => inside(dir, w.dir)).sort((a, b) => b.dir.length - a.dir.length)[0];
  const ref = (r: FakeRepo, name: string): string | undefined => r.refs.get(name.replace(/^refs\/heads\//, ""));
  const scripted = (m: string): Res | undefined => { const err = fail.get(m); return err === undefined ? undefined : { ok: false, err }; };
  const git: Git = {
    async root(dir) { return repoOf(dir)?.root; },
    async top(dir) { return wtOf(dir)?.dir; },
    async branchOf(dir) {
      calls.push(`branchOf ${dir}`);
      const w = wtOf(dir);
      return w === undefined ? "unknown" : w.branch;
    },
    async worktrees(repo) { return structuredClone(repoOf(repo)?.worktrees ?? []); },
    async sha(repo, name) { const r = repoOf(repo); return r && ref(r, name); },
    async worktreeAdd(repo, dir, branch, base) {
      calls.push(`worktreeAdd ${repo} ${dir} ${branch} ${base}`);
      const bad = scripted("worktreeAdd");
      if (bad) return bad;
      const r = repoOf(repo), b = r && ref(r, base);
      if (!r || b === undefined) return { ok: false, err: `fatal: invalid reference: ${base}` };
      if (r.refs.has(branch)) return { ok: false, err: `fatal: a branch named '${branch}' already exists` };
      if (existing.has(dir) || r.worktrees.some((w) => w.dir === dir)) return { ok: false, err: `fatal: '${dir}' already exists` };
      r.refs.set(branch, b);
      r.worktrees.push({ dir, branch, head: b });
      return { ok: true, out: "" };
    },
    async worktreeRemove(repo, dir) {
      calls.push(`worktreeRemove ${repo} ${dir}`);
      const bad = scripted("worktreeRemove");
      if (bad) return bad;
      const r = repoOf(repo), i = r ? r.worktrees.findIndex((w) => w.dir === dir) : -1;
      if (!r || i < 1) return { ok: false, err: `fatal: '${dir}' is not a working tree` };
      if (dirty.has(dir)) return { ok: false, err: `fatal: '${dir}' contains modified or untracked files, use --force to delete it` };
      r.worktrees.splice(i, 1);
      return { ok: true, out: "" };
    },
    async branchDelete(repo, branch, force = false) {
      calls.push(`branchDelete ${repo} ${branch}${force ? " force" : ""}`);
      const bad = scripted("branchDelete");
      if (bad) return bad;
      const r = repoOf(repo);
      if (!r || !r.refs.has(branch)) return { ok: false, err: `error: branch '${branch}' not found.` };
      if (r.worktrees.some((w) => w.branch === branch)) return { ok: false, err: `error: cannot delete branch '${branch}' used by worktree` };
      r.refs.delete(branch);
      return { ok: true, out: `Deleted branch ${branch}.` };
    },
    async dirty(dir) { return dirty.has(dir); },
    async diff(dir, a, b, maxLines) {
      calls.push(`diff ${dir} ${a} ${b ?? ""} ${maxLines}`);
      const d = diffs.get(dir);
      if (d instanceof Error) throw d;
      return d === undefined ? "" : d.split("\n").slice(0, maxLines).join("\n");
    },
    async diffStat(dir, base) {
      calls.push(`diffStat ${dir} ${base}`);
      const s = stats.get(dir);
      if (s instanceof Error) throw s;
      return s ?? [];
    },
  };
  return { git, repos, addRepo, calls, existing, dirty, fail, stats, diffs };
}
export type FakeGit = ReturnType<typeof fakeGit>;
