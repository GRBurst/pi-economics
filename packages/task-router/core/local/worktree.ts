// Worktrees and branches (design §3.3; plan S22, S23): names, directories and containment (pure), and `startBranch`; the write
// guard and the cleanup follow in later tasks.
import { readFileSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { Result, RouterSettings } from "../types.ts";
import type { BranchRecord, BranchStore } from "./branches.ts";
import type { Git, Wt } from "./git.ts";
import { guardGit } from "./gitcmd.ts";
import { parsePlan, skeletonHash } from "./plan.ts";
import { mergedUnits, type PlanStore } from "./plans.ts";

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
/** `plans`: the plan store when plans are active (L7); without it a plan-bound branch is refused. */
export type StartDeps = { git: Git; store: BranchStore; settings: RouterSettings; plans?: PlanStore };
/** What `start_branch` returns: `base` is the main tip the branch was made at (a commit); `files`: a plan unit's whitelist. */
export type Started = { branch: string; worktree: string; base: string; check: string; files?: string[] };
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

/** What a branch is for: its name, the review's goal, the branch check, and for a plan unit the unit and its whitelist. */
type Unit = { branch: string; goal: string; check: string; plan?: { slug: string; id: string }; files?: string[] };

/** A plan unit (design §3.3.2, AC-W2): the plan is approved (a record in this repository), its file on the main tip and in the
 *  main checkout has the approved skeleton hash, the unit is the one its milestone's `branch` names, not merged, and all it
 *  depends on is merged (a task also needs its milestone's dependencies). Reads only. A milestone branch's check runs its
 *  tasks' checks in order. */
async function planUnit(d: StartDeps, plans: PlanStore, slug: string, id: string, repo: string, main: { name: string; sha: string },
  wts: readonly Wt[]): Promise<Result<Unit>> {
  const rec = plans.get(slug);
  if (!rec || rec.repo !== repo) return fail(`no approved plan ${slug} in ${repo}; plan_request makes one`);
  const shown = await d.git.show(repo, main.sha, rec.file);
  if (shown === undefined) return fail(`the plan file ${rec.file} is not on ${main.name}`);
  const checkout = wts.find((w) => w.branch === main.name);
  const texts = [shown, ...(checkout ? [readText(join(checkout.dir, rec.file))] : [])];
  const parsed = texts.map((x) => (x === undefined ? undefined : parsePlan(x)));
  if (parsed.some((p) => p === undefined || skeletonHash(p.sk) !== rec.skeletonHash)) {
    return fail(`the plan file ${rec.file} changed since its approval (its skeleton hash differs); change the plan with amend_plan`);
  }
  const sk = parsed[0]!.sk;
  const m = sk.milestones.find((x) => x.id === id || x.tasks.some((t) => t.id === id));
  if (!m) return fail(`the plan ${slug} has no task or milestone ${id}`);
  const task = m.tasks.find((t) => t.id === id);
  if (task && m.branch === "milestone") return fail(`${id} is part of ${m.id}, which is one branch; start ${m.id}`);
  if (!task && m.branch === "task") return fail(`${m.id} has a branch per task; start one of its tasks`);
  const merged = mergedUnits(sk, slug, d.store.all());
  if (merged.has(id)) return fail(`${id} is merged already`);
  const missing = [...m.dependsOn, ...(task?.dependsOn ?? [])].filter((x) => !merged.has(x));
  if (missing.length) return fail(`${id} depends on ${missing.join(", ")}, not merged yet`);
  const tasks = task ? [task] : m.tasks;
  const checks = tasks.map((t) => t.check);
  return { ok: true, value: {
    branch: branchName(d.settings.worktrees.branchPrefix, { plan: slug, id }), goal: (task ?? m).goal, plan: { slug, id },
    check: checks.length === 1 ? checks[0]! : checks.map((c) => `(${c})`).join(" && "),
    files: [...new Set(tasks.flatMap((t) => [...t.files, ...(t.create ?? [])]))],
  } };
}
const readText = (p: string): string | undefined => { try { return readFileSync(p, "utf8"); } catch { return undefined; } };

/** `start_branch` (design §3.3.2): validates everything first, so a failure changes nothing; an existing branch in a worktree is
 *  re-activated (idempotent; one in the state merged, fixer or blocked is refused); else `git worktree add -b`. A slug needs a
 *  goal and a check; a plan unit (L7) takes them from the plan, and needs the plan store. */
export async function startBranch(d: StartDeps, input: unknown, cwd: string): Promise<Result<Started>> {
  const i = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  if (i.slug !== undefined && i.plan !== undefined) return fail("give either a slug or a plan, not both");
  if (i.slug === undefined && i.plan === undefined) return fail("a slug or a plan is required");
  const plan = i.plan as { slug?: unknown; id?: unknown } | null;
  if (i.plan !== undefined) {
    if (!d.plans) return fail("plans are not active");
    if (typeof plan !== "object" || plan === null || typeof plan.slug !== "string" || typeof plan.id !== "string") {
      return fail("plan must be {slug, id}");
    }
  } else {
    if (typeof i.slug !== "string" || !SLUG.test(i.slug)) return fail("slug must match ^[a-z0-9-]{1,40}$");
    if (i.slug.includes("--")) return fail('slug must not contain "--" (the worktree directory joins plan units with it)');
    for (const k of ["goal", "check"] as const) {
      if (typeof i[k] !== "string" || i[k] === "") return fail(`${k} is required`);
      if ((i[k] as string).length > MAX_TEXT) return fail(`${k} is longer than ${MAX_TEXT} characters`);
    }
  }
  if (i.repo !== undefined && !(typeof i.repo === "string" && isAbsolute(i.repo))) return fail("repo must be an absolute path");
  const from = (i.repo as string | undefined) ?? cwd;
  const repo = await d.git.root(from);
  if (repo === undefined) return fail(`${from} is not in a git repository`);
  const main = await mainTip(d, repo);
  if (main === undefined) return fail(`none of the main branches (${d.settings.mergeGate.mainBranches.join(", ")}) exists in ${repo}`);
  const wts = await d.git.worktrees(repo);
  const u: Result<Unit> = d.plans && plan
    ? await planUnit(d, d.plans, plan.slug as string, plan.id as string, repo, main, wts)
    : { ok: true, value: { branch: branchName(d.settings.worktrees.branchPrefix, { slug: i.slug as string }), goal: i.goal as string, check: i.check as string } };
  if (!u.ok) return u;
  const { branch, goal, check, files } = u.value;
  const known = d.store.get(repo, branch);
  const there = wts.find((w) => w.branch === branch && !w.prunable); // a prunable one has lost its directory
  const existed = (await d.git.sha(repo, branch)) !== undefined;
  const why = await vetCheck(d, check, there?.dir ?? worktreeDir(d.settings.worktrees.root, repo, branch), branch);
  if (why !== undefined) return fail(`check: ${why}`);
  let rec: BranchRecord;
  if (there) {
    if (known && known.state !== "active" && known.state !== "abandoned") return fail(`branch ${branch} is ${known.state}; start another`);
    // review F8: a hand-made record is adopted (the router's from now on)
    const { handmade: _adopted, ...prior } = known ?? { repo, branch, base: main.sha, rejections: 0, fixerRuns: 0 };
    rec = { ...prior, ...(u.value.plan && { plan: u.value.plan }), worktree: there.dir, state: "active", goal, check, ...(files && { files }) };
    const current = d.store.active();
    const same = known !== undefined && current?.repo === repo && current.branch === branch && current.goal === goal && current.check === check
      && JSON.stringify(current.files) === JSON.stringify(files);
    if (!same) d.store.put(rec);
  } else {
    const dir = worktreeDir(d.settings.worktrees.root, repo, branch);
    const added = await d.git.worktreeAdd(repo, dir, branch, main.sha);
    if (!added.ok) {
      // `git worktree add -b` creates the branch before it finds the directory in the way: take back what it made.
      if (!existed) await d.git.branchDelete(repo, branch, true);
      return fail(added.err);
    }
    rec = { repo, branch, worktree: dir, base: main.sha, ...(u.value.plan && { plan: u.value.plan }), state: "active", rejections: 0, fixerRuns: 0,
      goal, check, ...(files && { files }) };
    d.store.put(rec);
  }
  await refreshFacts(d, repo);
  return { ok: true, value: { branch, worktree: rec.worktree, base: rec.base, check, ...(files && { files }) } };
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
