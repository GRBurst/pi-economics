// An in-memory `Git` (core/local/git.ts) for the logic tests (plan D56): scripted repositories, refs, worktrees and dirty
// directories; every call is recorded. Typed `Git`, so a port method without a fake fails the type check. The tests that are
// about git's behaviour run real git (test/git-repo.ts); test/local-fake-git.test.ts keeps the two in step.
import type { Git, Res, Stat, Wt } from "../core/local/git.ts";
import { inside } from "../core/local/worktree.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  /** The commit graph (L6): commit → its parent and the files it changed; a ref's first commit has no entry (no parent). */
  const commits = new Map<string, { parent?: string; stat: Stat }>();
  /** `<remote> <branch> <commit>` per push; `remotes`: the remotes a push reaches. */
  const pushes: string[] = [];
  const remotes = new Set(["origin"]);
  /** L7: repository → what `lsFiles` lists; commit → the file `commitFile` set in it. */
  const tracked = new Map<string, string[]>();
  const blobs = new Map<string, { path: string; content: string }>();
  let shas = 0;
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
  /** A worktree's commit: its branch's tip, else its own (detached). */
  const headOf = (r: FakeRepo, w: Wt): string => (w.branch !== undefined ? r.refs.get(w.branch) ?? w.head : w.head);
  const known = (r: FakeRepo, sha: string): boolean =>
    commits.has(sha) || [...r.refs.values()].includes(sha) || r.worktrees.some((w) => headOf(r, w) === sha);
  /** `HEAD` (of the checkout that holds `dir`), a branch, or a known commit. */
  const resolveIn = (dir: string, name: string): string | undefined => {
    const r = repoOf(dir);
    if (!r) return undefined;
    if (name === "HEAD") { const w = wtOf(dir); return w && headOf(r, w); }
    return ref(r, name) ?? (/^[0-9a-f]{40}$/.test(name) && known(r, name) ? name : undefined);
  };
  /** `c` and its ancestors, newest first. */
  const line = (c: string): string[] => { const out: string[] = []; for (let x: string | undefined = c; x !== undefined; x = commits.get(x)?.parent) out.push(x); return out; };
  const isAnc = (a: string, b: string): boolean => line(b).includes(a);
  const scripted = (m: string): Res | undefined => { const err = fail.get(m); return err === undefined ? undefined : { ok: false, err }; };
  const git: Git = {
    async root(dir) { return repoOf(dir)?.root; },
    async top(dir) { return wtOf(dir)?.dir; },
    async branchOf(dir) {
      calls.push(`branchOf ${dir}`);
      const w = wtOf(dir);
      return w === undefined ? "unknown" : w.branch;
    },
    async worktrees(repo) { const r = repoOf(repo); return r ? r.worktrees.map((w) => ({ ...structuredClone(w), head: headOf(r, w) })) : []; },
    async sha(repo, name) { return resolveIn(repo, name); },
    async worktreeAdd(repo, dir, branch, base) {
      calls.push(`worktreeAdd ${repo} ${dir} ${branch} ${base}`);
      const bad = scripted("worktreeAdd");
      if (bad) return bad;
      const r = repoOf(repo), b = r && resolveIn(repo, base);
      if (!r || b === undefined) return { ok: false, err: `fatal: invalid reference: ${base}` };
      if (r.refs.has(branch)) return { ok: false, err: `fatal: a branch named '${branch}' already exists` };
      if (existing.has(dir) || r.worktrees.some((w) => w.dir === dir)) return { ok: false, err: `fatal: '${dir}' already exists` };
      r.refs.set(branch, b);
      r.worktrees.push({ dir, branch, head: b });
      return { ok: true, out: "" };
    },
    async worktreeRemove(repo, dir, force = false) {
      calls.push(`worktreeRemove ${repo} ${dir}${force ? " force" : ""}`);
      const bad = scripted("worktreeRemove");
      if (bad) return bad;
      const r = repoOf(repo), i = r ? r.worktrees.findIndex((w) => w.dir === dir) : -1;
      if (!r || i < 1) return { ok: false, err: `fatal: '${dir}' is not a working tree` };
      if (dirty.has(dir) && !force) return { ok: false, err: `fatal: '${dir}' contains modified or untracked files, use --force to delete it` };
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
    async isAncestor(repo, a, b) { const x = resolveIn(repo, a), y = resolveIn(repo, b); return x !== undefined && y !== undefined && isAnc(x, y); },
    async numstat(repo, a, b) {
      calls.push(`numstat ${repo} ${a} ${b}`);
      const x = resolveIn(repo, a), y = resolveIn(repo, b);
      if (x === undefined || y === undefined) return undefined;
      const base = new Set(line(x)), sum = new Map<string, { added: number; deleted: number }>();
      for (const c of line(y).filter((c) => !base.has(c)).reverse()) {
        for (const s of commits.get(c)?.stat ?? []) {
          const t = sum.get(s.path) ?? { added: 0, deleted: 0 };
          sum.set(s.path, { added: t.added + s.added, deleted: t.deleted + s.deleted });
        }
      }
      return [...sum].map(([path, t]) => ({ path, ...t }));
    },
    async tree(repo, commit) { const c = resolveIn(repo, commit); return c && `7${c.slice(1)}`; },
    async worktreeAddDetached(repo, dir, commit) {
      calls.push(`worktreeAddDetached ${repo} ${dir} ${commit}`);
      const bad = scripted("worktreeAddDetached");
      if (bad) return bad;
      const r = repoOf(repo), c = resolveIn(repo, commit);
      if (!r || c === undefined) return { ok: false, err: `fatal: invalid reference: ${commit}` };
      if (existing.has(dir) || r.worktrees.some((w) => w.dir === dir)) return { ok: false, err: `fatal: '${dir}' already exists` };
      r.worktrees.push({ dir, head: c });
      return { ok: true, out: "" };
    },
    async ffMerge(dir, commit) {
      calls.push(`ffMerge ${dir} ${commit}`);
      const bad = scripted("ffMerge");
      if (bad) return bad;
      const r = repoOf(dir), w = wtOf(dir), c = resolveIn(dir, commit);
      if (!r || !w || c === undefined) return { ok: false, err: `merge: ${commit} - not something we can merge` };
      if (!isAnc(headOf(r, w), c)) return { ok: false, err: "fatal: Not possible to fast-forward, aborting." };
      if (w.branch !== undefined) r.refs.set(w.branch, c); else w.head = c;
      return { ok: true, out: "" };
    },
    async updateRef(repo, name, next, prev) {
      calls.push(`updateRef ${repo} ${name} ${next} ${prev}`);
      const bad = scripted("updateRef");
      if (bad) return bad;
      const r = repoOf(repo), branch = name.replace(/^refs\/heads\//, ""), to = resolveIn(repo, next);
      if (!r || to === undefined) return { ok: false, err: `fatal: ${next}: not a valid SHA1` };
      const cur = r.refs.get(branch);
      if (cur !== prev) return { ok: false, err: `fatal: update_ref failed for ref '${name}': cannot lock ref '${name}': is at ${cur} but expected ${prev}` };
      r.refs.set(branch, to);
      return { ok: true, out: "" };
    },
    async push(repo, remote, branch) {
      calls.push(`push ${repo} ${remote} ${branch}`);
      const bad = scripted("push");
      if (bad) return bad;
      const r = repoOf(repo), c = r && ref(r, branch);
      if (!r || !remotes.has(remote)) return { ok: false, err: `fatal: '${remote}' does not appear to be a git repository` };
      if (c === undefined) return { ok: false, err: `error: src refspec ${branch} does not match any` };
      pushes.push(`${remote} ${branch} ${c}`);
      return { ok: true, out: "" };
    },
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
    /** The real files under `repo` (a test writes them): a whole-word, literal match. */
    async grepWord(repo, word, files) {
      calls.push(`grepWord ${repo} ${word} ${files.join(",")}`);
      const isWord = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_]/.test(c);
      const holds = (text: string): boolean => {
        for (let i = text.indexOf(word); i >= 0 && word !== ""; i = text.indexOf(word, i + 1))
          if (!isWord(text[i - 1]) && !isWord(text[i + word.length])) return true;
        return false;
      };
      return files.filter((f) => { try { return holds(readFileSync(join(repo, f), "utf8")); } catch { return false; } });
    },
    async lsFiles(repo, n) { calls.push(`lsFiles ${repo} ${n}`); return (tracked.get(repo) ?? []).slice(0, n); },
    async commitFile(repo, parent, path, content, message) {
      calls.push(`commitFile ${repo} ${parent} ${path} ${message}`);
      const bad = scripted("commitFile");
      if (bad) return bad;
      const r = repoOf(repo);
      if (!r || !known(r, parent)) return { ok: false, err: `fatal: not a valid object name ${parent}` };
      const sha = (++shas).toString(16).padStart(40, "d");
      const added = (content.match(/\n/g)?.length ?? 0) + (content !== "" && !content.endsWith("\n") ? 1 : 0);
      commits.set(sha, { parent, stat: [{ path, added, deleted: 0 }] });
      blobs.set(sha, { path, content });
      return { ok: true, out: sha };
    },
  };
  /** A commit in the checkout that holds `dir` with the files it changed: its branch (or its detached HEAD) moves to it. */
  const commit = (dir: string, stat: Stat = [{ path: "f", added: 1, deleted: 0 }]): string => {
    const r = repoOf(dir), w = wtOf(dir);
    if (!r || !w) throw new Error(`fake-git: no checkout at ${dir}`);
    const sha = (++shas).toString(16).padStart(40, "c");
    commits.set(sha, { parent: headOf(r, w), stat });
    if (w.branch !== undefined) r.refs.set(w.branch, sha); else w.head = sha;
    return sha;
  };
  return { git, repos, addRepo, calls, existing, dirty, fail, stats, diffs, commit, commits, pushes, remotes, tracked, blobs };
}
export type FakeGit = ReturnType<typeof fakeGit>;
