// Worktrees and branches (design §3.3; plan S22, S23): names, directories and containment (pure), and `startBranch`; the write
// guard and the cleanup follow in later tasks.
import { realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { Result, RouterSettings } from "../types.ts";
import type { BranchRecord, BranchStore } from "./branches.ts";
import type { Git } from "./git.ts";
import { guardGit } from "./gitcmd.ts";

export const SLUG = /^[a-z0-9-]{1,40}$/;
/** `<prefix><slug>`, or `<prefix><plan>/<id>` for a unit of a plan (design §3.3.1). */
export const branchName = (prefix: string, u: { slug: string } | { plan: string; id: string }): string =>
  "slug" in u ? prefix + u.slug : `${prefix}${u.plan}/${u.id}`;
/** The worktree of `branch` (design §3.3.1, plan D36): `root` with `{repo}` replaced by the repository's directory name, a
 *  relative root resolved against the repository root, then the branch name with `/` → `--`. Two branches share a directory
 *  only when a name part holds `--` (`lm/p--m` and `lm/p/m`), so `startBranch` refuses such a slug (L5 follow-up); a plan
 *  unit's parts (L7) also need no `-` at either end (`a-`/`b` and `a`/`-b`). */
export const worktreeDir = (root: string, repo: string, branch: string): string =>
  join(resolve(repo, root.replaceAll("{repo}", basename(repo))), branch.replaceAll("/", "--"));
/** `p` is `dir` or below it (compared as paths, not as strings: `/r/xy` is not inside `/r/x`). */
export const inside = (p: string, dir: string): boolean => {
  const r = relative(dir, p);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};

// ── start_branch (design §3.3.2) ──
export type StartDeps = { git: Git; store: BranchStore; settings: RouterSettings };
/** What `start_branch` returns: `base` is the main tip the branch was made at (a commit). */
export type Started = { branch: string; worktree: string; base: string; check: string };
const MAX_TEXT = 300;
const fail = (e: string): Result<never> => ({ ok: false, errors: [e] });

/** The first main branch that exists in `repo` and its tip. */
async function mainTip(d: StartDeps, repo: string): Promise<{ name: string; sha: string } | undefined> {
  for (const name of d.settings.mergeGate.mainBranches) {
    const sha = await d.git.sha(repo, name);
    if (sha !== undefined) return { name, sha };
  }
  return undefined;
}
/** Refreshes the facts the synchronous guards read (plan D39): the repository's main checkout and registered worktrees. */
export async function refreshFacts(d: StartDeps, repo: string): Promise<void> {
  const wts = await d.git.worktrees(repo);
  d.store.facts.worktrees.set(repo, wts.map((w) => w.dir));
  const main = wts.find((w) => w.branch !== undefined && d.settings.mergeGate.mainBranches.includes(w.branch));
  if (main) d.store.facts.mainCheckout.set(repo, main.dir);
  else d.store.facts.mainCheckout.delete(repo);
}

/** Review F7: the router runs a branch check itself (request_merge step 5, the red run), outside every hook, so the git classifier
 *  reads it first, in the worktree `dir` on `branch` (it may not exist yet). The classifier's reason when it blocks, else undefined. */
export async function vetCheck(d: StartDeps, check: string, dir: string, branch?: string): Promise<string | undefined> {
  return await guardGit(check, dir, d.settings.mergeGate.mainBranches, (x) => (branch !== undefined && x === dir ? Promise.resolve(branch) : d.git.branchOf(x)));
}

/** `start_branch` for a slug (design §3.3.2): validates everything first, so a failure changes nothing; an existing branch in a
 *  worktree is re-activated (idempotent; one in the state merged, fixer or blocked is refused); else `git worktree add -b`. A
 *  plan unit is L7's: until then `plan` is refused. */
export async function startBranch(d: StartDeps, input: unknown, cwd: string): Promise<Result<Started>> {
  const i = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  if (i.slug !== undefined && i.plan !== undefined) return fail("give either a slug or a plan, not both");
  if (i.slug === undefined && i.plan === undefined) return fail("a slug or a plan is required");
  if (i.plan !== undefined) return fail("plans are not active");
  if (typeof i.slug !== "string" || !SLUG.test(i.slug)) return fail("slug must match ^[a-z0-9-]{1,40}$");
  if (i.slug.includes("--")) return fail('slug must not contain "--" (the worktree directory joins plan units with it)');
  for (const k of ["goal", "check"] as const) {
    if (typeof i[k] !== "string" || i[k] === "") return fail(`${k} is required`);
    if ((i[k] as string).length > MAX_TEXT) return fail(`${k} is longer than ${MAX_TEXT} characters`);
  }
  const goal = i.goal as string, check = i.check as string;
  if (i.repo !== undefined && !(typeof i.repo === "string" && isAbsolute(i.repo))) return fail("repo must be an absolute path");
  const from = (i.repo as string | undefined) ?? cwd;
  const repo = await d.git.root(from);
  if (repo === undefined) return fail(`${from} is not in a git repository`);
  const main = await mainTip(d, repo);
  if (main === undefined) return fail(`none of the main branches (${d.settings.mergeGate.mainBranches.join(", ")}) exists in ${repo}`);
  const branch = branchName(d.settings.worktrees.branchPrefix, { slug: i.slug });
  const known = d.store.get(repo, branch);
  const there = (await d.git.worktrees(repo)).find((w) => w.branch === branch && !w.prunable); // a prunable one has lost its directory
  const existed = (await d.git.sha(repo, branch)) !== undefined;
  const why = await vetCheck(d, check, there?.dir ?? worktreeDir(d.settings.worktrees.root, repo, branch), branch);
  if (why !== undefined) return fail(`check: ${why}`);
  let rec: BranchRecord;
  if (there) {
    if (known && known.state !== "active" && known.state !== "abandoned") return fail(`branch ${branch} is ${known.state}; start another`);
    rec = { ...(known ?? { repo, branch, base: main.sha, rejections: 0, fixerRuns: 0 }), worktree: there.dir, state: "active", goal, check };
    const current = d.store.active();
    const same = known !== undefined && current?.repo === repo && current.branch === branch && current.goal === goal && current.check === check;
    if (!same) d.store.put(rec);
  } else {
    const dir = worktreeDir(d.settings.worktrees.root, repo, branch);
    const added = await d.git.worktreeAdd(repo, dir, branch, main.sha);
    if (!added.ok) {
      // `git worktree add -b` creates the branch before it finds the directory in the way: take back what it made.
      if (!existed) await d.git.branchDelete(repo, branch, true);
      return fail(added.err);
    }
    rec = { repo, branch, worktree: dir, base: main.sha, state: "active", rejections: 0, fixerRuns: 0, goal, check };
    d.store.put(rec);
  }
  await refreshFacts(d, repo);
  return { ok: true, value: { branch, worktree: rec.worktree, base: rec.base, check } };
}

// ── the main-checkout write guard (design §3.3.3, plan S23) ──
/** While a worktree is active (`active`), an `edit` or `write` whose resolved path is inside the main checkout and in no
 *  linked worktree is blocked, with the worktree to use instead. `worktrees` is git's list (it holds the main checkout, which
 *  is no exception: a worktree nested in the main checkout is). Total: a path that is no string or a tool that is no writer passes.
 *  The reason is a fixed sentence plus a path, never model text. */
export function writeGuard(x: { tool: string; input: unknown; cwd: string; active?: BranchRecord; mainCheckout?: string; worktrees: readonly string[];
  /** The worktrees a fixer owns (design §3.4.4): no main-session write lands in them. */ fixerDirs?: readonly string[] }): string | undefined {
  if (x.tool !== "edit" && x.tool !== "write") return undefined;
  const raw = (x.input as { path?: unknown } | null | undefined)?.path;
  if (typeof raw !== "string") return undefined;
  const p = resolve(x.cwd, raw);
  if (x.fixerDirs?.some((d) => inside(p, d))) return "a fixer owns this branch";
  if (!x.active || !x.mainCheckout) return undefined;
  if (!inside(p, x.mainCheckout) || x.worktrees.some((w) => w !== x.mainCheckout && inside(p, w))) return undefined;
  return `write in the worktree ${x.active.worktree}; use absolute paths under it`;
}

// ── cleanup and abandoned branches (design §3.3.4) ──
/** After a merge (the caller checks `removeAfterMerge`): `git worktree remove`, then `git branch -d`. A failure is a hint, never
 *  an exception, and changes no record: the merge stands. undefined = both gone. `main`: the main branch it was merged into; a
 *  branch contained in it is deleted even when the repository's HEAD is elsewhere (`update-ref` merged it, L6.T10). */
export async function cleanupBranch(d: StartDeps, rec: BranchRecord, main?: string): Promise<string | undefined> {
  try {
    const removed = await d.git.worktreeRemove(rec.repo, rec.worktree);
    if (!removed.ok) return `cleanup failed: ${removed.err}`;
    const contained = main !== undefined && (await d.git.isAncestor(rec.repo, `refs/heads/${rec.branch}`, `refs/heads/${main}`));
    const deleted = await d.git.branchDelete(rec.repo, rec.branch, contained);
    await refreshFacts(d, rec.repo);
    return deleted.ok ? undefined : `cleanup failed: ${deleted.err}`;
  } catch (err) {
    return `cleanup failed: ${(err as Error).message}`;
  }
}

/** The states a branch can be abandoned from; `merged` and `abandoned` are final. */
const LIVE: readonly string[] = ["active", "fixer", "blocked"];
const real = (p: string): string => { try { return realpathSync(p); } catch { return p; } };
/** Marks a branch `abandoned` (one entry) when its worktree is no longer a worktree of the repository: unregistered, or git lists
 *  it as prunable (the directory is gone). A repository whose list is empty is skipped: git failed, and the main checkout is
 *  always listed. Abandoning a branch is plain git on a non-main ref, which the guard allows. */
export async function refreshAbandoned(d: StartDeps): Promise<void> {
  const repos = new Set(d.store.all().filter((r) => LIVE.includes(r.state)).map((r) => r.repo));
  for (const repo of repos) {
    const wts = await d.git.worktrees(repo);
    if (wts.length === 0) continue;
    for (const r of d.store.all()) {
      if (r.repo !== repo || !LIVE.includes(r.state)) continue;
      const w = wts.find((x) => x.dir === r.worktree || real(x.dir) === real(r.worktree));
      if (!w || w.prunable) d.store.put({ ...r, state: "abandoned" });
    }
  }
}
