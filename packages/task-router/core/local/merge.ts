// The merge gate's pipeline (design §3.4.2; plan S26): `request_merge` resolves the branch, refuses what must not merge
// (cheap and deterministic first), runs the checks and the red run, reviews through the overseer (Opus last), then
// fast-forwards main. Every git call goes through the port (core/local/git.ts), so a failure is a value, never an exception.
import { basename } from "node:path";
import type { Runner } from "../gate.ts";
import type { Card, RouterSettings } from "../types.ts";
import type { MergeInput } from "../outcome.ts";
import type { Finding } from "./verdict.ts";
import type { BranchRecord, BranchStore } from "./branches.ts";
import type { Git, Stat } from "./git.ts";
import type { createOverseer } from "./overseer.ts";
import { cleanupBranch, refreshFacts, vetCheck } from "./worktree.ts";
import { verdictSubmit } from "./overseer.ts";
import { approve, findingLine, TASK_ID, targetPath } from "./verdict.ts";
import { riskGlobsOf } from "./tripwires.ts";
import { globMatch } from "../glob.ts";
import { check } from "./schema.ts";
import type { Schema } from "./schema.ts";
import { errorReply } from "./branchtool.ts";
import { type Milestone, parsePlan, planBudget, type PlanRecord, type Skeleton, skeletonHash, type Task, tickOnly } from "./plan.ts";
import { mergedUnits, type PlanStore } from "./plans.ts";
import type { RouterTool } from "./branchtool.ts";

export const REASONS = ["main-branch", "dirty", "behind", "fixer-running", "abandoned", "blocked", "size", "scope",
  "check", "main-dirty", "plan-changed", "no-worktree", "review-unavailable", "aborted", "git"] as const;
export type MergeReason = (typeof REASONS)[number];
export type MergeStatus = "merged" | "refused" | "revise" | "fixer" | "error";
export type MergeResult = { status: MergeStatus; reason?: MergeReason; detail: string;
  commit?: string; reviewId?: string; findings?: string[]; pushed?: boolean };
export type Facts = { isMain: boolean; state: BranchRecord["state"] | undefined; dirty: boolean; behind: boolean };

/** Step 2, in the fixed order of S26. */
export const refusal = (f: Facts): MergeReason | undefined =>
  f.isMain ? "main-branch" : f.state === "abandoned" ? "abandoned" : f.state === "blocked" ? "blocked"
  : f.state === "fixer" ? "fixer-running" : f.dirty ? "dirty" : f.behind ? "behind" : undefined;

/** Step 3: the lines (added + deleted) and files of a numstat; a plan file whose change is tick-only does not count (L7). */
export const sizeOf = (st: Stat, planFile?: string, tickOnly = false): { lines: number; files: number } => {
  const xs = st.filter((x) => !(tickOnly && x.path === planFile));
  return { lines: xs.reduce((n, x) => n + x.added + x.deleted, 0), files: xs.length };
};
export const oversize = (st: Stat, s: RouterSettings, planFile?: string, tickOnly = false): boolean => {
  const z = sizeOf(st, planFile, tickOnly);
  return z.lines > s.mergeGate.maxDiffLines || z.files > s.mergeGate.maxDiffFiles;
};

/** The model-facing text of a reason (Q18; pinned by test/local-merge-refuse.test.ts). `x` carries the values it names; `x.plan`
 *  set: a plan-bound branch (L7.T13; a blocked one is restructured through amend_plan, design §3.4.4). */
export function reasonText(r: MergeReason, x: Record<string, string>): string {
  switch (r) {
    case "main-branch": return `${x.branch} is a main branch; make a branch with start_branch and request its merge`;
    case "dirty": return `the worktree ${x.worktree} has uncommitted changes; commit them, then request again`;
    case "behind": return `${x.main} is not an ancestor of the branch; rebase onto ${x.main} in the worktree, then request again`;
    case "fixer-running": return `fixes were delegated to ${x.fixer}; wait for its report, then call request_merge`;
    case "abandoned": return `${x.branch} is abandoned; start a new branch`;
    case "blocked": return `${x.branch} is blocked: the fixer's changes were rejected again; ${x.plan === undefined ? "abandon the branch and start a new one with a smaller goal" : "restructure the task with amend_plan"}`;
    case "size": return `the branch changes ${x.lines} lines in ${x.files} files (at most ${x.maxLines} lines and ${x.maxFiles} files); split the branch`;
    case "scope": return "the branch changes files outside its plan task";
    case "check": return `\`${x.cmd}\` exit ${x.exit}${x.tail ? `\n${x.tail}` : ""}`;
    case "main-dirty": return `the main checkout ${x.checkout} has uncommitted changes; the merge needs it clean`;
    case "plan-changed": return "the plan changed since the branch started";
    case "no-worktree": return `${x.branch} has no worktree; start_branch makes one`;
    case "review-unavailable": return "error: review unavailable";
    case "aborted": return "aborted";
    case "git": return `git failed: ${x.err}`;
    default: { const none: never = r; return none; }
  }
}

// ── step 7: approvals (design §3.4.3) ──
export const APPROVAL_TYPE = "task-router/approval";
export type ApprovalKey = { repo: string; branch: string; commit: string; tree: string };
export type Approvals = { find(k: ApprovalKey): string | undefined; add(k: ApprovalKey, reviewId: string): void; rebuild(entries: readonly unknown[]): void };
const keyOf = (k: ApprovalKey): string => JSON.stringify([k.repo, k.branch, k.commit, k.tree]);
/** The approvals of this session: memory, one `task-router/approval` entry per approval; `rebuild` reads them back (a restart). */
export function createApprovals(append: (customType: string, data: unknown) => void): Approvals {
  const ids = new Map<string, string>();
  return {
    find: (k) => ids.get(keyOf(k)),
    add(k, reviewId) {
      ids.set(keyOf(k), reviewId);
      append(APPROVAL_TYPE, { repo: k.repo, branch: k.branch, commit: k.commit, tree: k.tree, reviewId });
    },
    rebuild(entries) {
      ids.clear();
      for (const e of entries) {
        const x = e as { customType?: unknown; data?: Record<string, unknown> } | null;
        if (x?.customType !== APPROVAL_TYPE || typeof x.data !== "object" || x.data === null) continue;
        const d = x.data;
        if ([d.repo, d.branch, d.commit, d.tree, d.reviewId].every((v) => typeof v === "string" && v !== ""))
          ids.set(keyOf(d as ApprovalKey), d.reviewId as string);
      }
    },
  };
}

// ── step 8: the review input (S27) ──
export type ReviewFacts = { goal?: string; summary?: string; checks: CheckRun[]; red: Red; risky: string[]; invariants?: string;
  stat: Stat; base: string; commit: string; diff: string; maxLines: number };
const none = (x: string | undefined): string => (x === undefined || x.trim() === "" ? "none" : x);
/** What the merge overseer reads (S27): the router renders it; no file bodies beyond the diff. */
export const reviewInput = (x: ReviewFacts): string => [
  `Goal: ${none(x.goal)}`,
  `Summary from the author: ${none(x.summary)}`,
  ...(x.checks.length ? x.checks.flatMap((c) => [`Check: \`${c.cmd}\` exit ${c.exit}`, ...(c.output ? [c.output] : [])]) : ["Check: none"]),
  `Red run at base: ${RED_TEXT[x.red]}`,
  `Risky paths: ${x.risky.length ? x.risky.join(", ") : "none"}`,
  `Invariants: ${none(x.invariants)}`,
  "Numstat:",
  ...x.stat.map((f) => `${f.added}\t${f.deleted}\t${f.path}`),
  `Diff ${x.base}..${x.commit} (≤ ${x.maxLines} lines):`,
  ...(x.diff ? [x.diff] : []),
].join("\n");
/** The review's diff budget in lines (review F9): never below what the size gate lets through. With git's default 3 context
 *  lines a changed line adds at most a hunk header and 6 context lines, and a file at most 8 header lines (diff --git, two
 *  mode lines, index, ---, +++, two "\ No newline"). A diff past it is not cut: the review fails closed. */
export const diffBudget = (g: { maxDiffLines: number; maxDiffFiles: number }): number => 8 * g.maxDiffLines + 8 * g.maxDiffFiles;
/** `Git.diff` marks a cut text by a last line `… N more lines`; no diff line starts with `…`. */
const cutDiff = (d: string): boolean => /^… \d+ more lines$/.test(d.slice(d.lastIndexOf("\n") + 1));
/** What `revise` tells the author (Q18). */
export const REVISE_TEXT = "the review asks for changes: fix the blocking findings, commit, then call request_merge again";

// ── the fixer (design §3.4.4; plan S28) ──
export type FixerCard = Pick<Card, "kind" | "files" | "check" | "acceptance" | "t0" | "t2">;
/** The fixer's card: the changed files ∪ the findings' target paths (a plan task id is no path), the branch check, the
 *  blocking findings' fix criteria; nothing claimed (t0 all false), no trigger. */
export const fixerCard = (changed: readonly string[], findings: readonly Finding[], check?: string): FixerCard => ({
  kind: "implement",
  files: [...new Set([...changed, ...findings.map((f) => targetPath(f.target)).filter((t) => !TASK_ID.test(t))])],
  ...(check !== undefined && { check }),
  acceptance: findings.filter((f) => f.blocking).map((f) => f.fix),
  t0: { bounded: false, specified: false, verifiable: false, lowRisk: false, small: false, linear: false }, t2: [],
});
/** The card as the fixer's brief (`briefAppend`; Q18). */
export const fixerBrief = (c: FixerCard): string => [
  "Task card (from the merge review; the router spawned you):",
  `kind: ${c.kind}`,
  `files: ${c.files.join(", ")}`,
  ...(c.check !== undefined ? [`check: \`${c.check}\``] : []),
  "acceptance (the review's blocking findings):",
  ...c.acceptance.map((a) => `- ${a}`),
].join("\n");
/** The fixer's task (Q18): the branch, its worktree, the review's findings (V3 lines). */
export const fixerMessage = (x: { branch: string; worktree: string; reviewId: string; findings: readonly string[] }): string =>
  `The merge review ${x.reviewId} rejected the branch ${x.branch}. Fix it in its worktree ${x.worktree} (use absolute paths under it): ` +
  "make the blocking findings' fix criteria hold, commit there, run the check, then report to main with send_message. " +
  `Do not merge or push; main requests the merge again.\n\nFindings:\n${x.findings.join("\n")}`;
/** Spawns the fixer in `worktree` (the shell's: a ticket through the actor's spawn API, D45–D47); its name, or why not. */
export type FixerPort = (x: { worktree: string; reviewId: string; brief: string; message: string }) =>
  Promise<{ ok: true; name: string } | { ok: false; reason: string }>;

export type OverseerPort = Pick<ReturnType<typeof createOverseer>, "run" | "ready">;
export type MergePorts = {
  git: Git; run: Runner; overseer: OverseerPort; branches: BranchStore; approvals: Approvals; settings: RouterSettings;
  /** `pi.appendEntry` (design §3.0.2). */
  append(customType: string, data: unknown): void;
  /** A fresh path for the red run's temporary worktree (it must not exist). */
  tmp(): string;
  /** Absent: no fixer, a rejection is always `revise`. */
  fixer?: FixerPort;
  signal?: AbortSignal;
  /** The `merge` line (design §3.0.3), one per call; absent: none. */
  log?(i: MergeInput): void;
  /** Runs step 9's ref move, push and `main-ref` record while no bypass check runs (review F3: the gate's own move is never
   *  a bypass); absent: at once. */
  exclusive?<T>(f: () => Promise<T>): Promise<T>;
  /** The fixer `name` no longer works on its branch (review F5: not listed, not this process's, or it ended before its record);
   *  such a branch is active again. Absent: a fixer is gone only by its event. */
  fixerGone?(name: string | undefined): boolean;
  /** The approved plans while plans are active (L7); absent: a branch is merged as one without a plan. */
  plans?: PlanStore;
};
/** What the pipeline learned before it returned, for the `merge` line. */
type Seen = { branch?: string; nLines?: number; nFiles?: number };
type Input = { branch?: string; summary?: string };
/** A check the pipeline ran (step 5), for the review input (S27). */
export type CheckRun = { cmd: string; exit: number; output: string };
/** The tail of a check's output: the last 40 lines, at most 4 kB (design §3.2.1). */
const TAIL_LINES = 40, TAIL_BYTES = 4096;
export const tailOf = (out: string): string => out.trimEnd().split("\n").slice(-TAIL_LINES).join("\n").slice(-TAIL_BYTES);

const done = (status: MergeStatus, reason: MergeReason | undefined, detail: string, commit?: string): MergeResult =>
  ({ status, ...(reason && { reason }), detail, ...(commit !== undefined && { commit }) });
const refuse = (reason: MergeReason, x: Record<string, string>, commit?: string): MergeResult => done("refused", reason, reasonText(reason, x), commit);
const gitError = (err: string, commit?: string): MergeResult => done("error", "git", reasonText("git", { err }), commit);
const aborted = (commit: string): MergeResult => done("error", "aborted", reasonText("aborted", {}), commit);

// ── step 6: the red run ──
export type Red = "passed" | "failed" | "skipped";
/** The review input's line (S27, pinned). */
export const RED_TEXT: Record<Red, string> = { passed: "passed — the check may be vacuous", failed: "failed as expected", skipped: "skipped" };
/** Runs `check` at `base` in a detached temporary worktree (`p.tmp()`), removed afterwards whatever happened (a timeout too).
 *  A worktree git cannot make skips the red run: it informs the reviewer and never refuses on its own. */
export async function redRun(p: MergePorts, repo: string, base: string, check: string): Promise<Red> {
  const dir = p.tmp();
  const add = await p.git.worktreeAddDetached(repo, dir, base);
  if (!add.ok) return "skipped";
  try {
    const r = await p.run(check, dir, p.settings.checkTimeoutSec * 1000, p.signal);
    return r.exit === 0 ? "passed" : "failed";
  } finally {
    await p.git.worktreeRemove(repo, dir, true);
  }
}

/** `name` passes `git check-ref-format --branch` (its rules, without git): the merge line logs only a branch name, never the
 *  model's free text (review F10, AC-L2). */
export const branchName = (name: string): boolean =>
  name !== "" && name !== "@" && name.length <= 256 && !name.startsWith("-") && !name.startsWith("/") && !name.endsWith("/") &&
  !name.endsWith(".") && !/[\x00-\x20\x7f~^:?*[\\]|\.\.|@\{|\/\//.test(name) &&
  name.split("/").every((c) => !c.startsWith(".") && !c.endsWith(".lock"));

/** `request_merge` (design §3.4.2). Total: an unexpected exception is a `git` error, and nothing after it runs. */
export async function requestMerge(p: MergePorts, input: Input, cwd: string): Promise<MergeResult> {
  const seen: Seen = {};
  const r = await attempt(p, input, cwd, seen);
  try {
    const named = seen.branch ?? (typeof input.branch === "string" ? input.branch : "");
    p.log?.({ branch: branchName(named) ? named : "", outcome: r.status === "error" ? "failed" : r.status,
      reason: r.reason, commit: r.commit, nLines: seen.nLines, nFiles: seen.nFiles, reviewId: r.reviewId, pushed: r.pushed });
  } catch { /* the line is best effort */ }
  return r;
}
async function attempt(p: MergePorts, input: Input, cwd: string, seen: Seen): Promise<MergeResult> {
  try {
    // §3.4.3: a worktree whose HEAD moved after the approval is reviewed again from the start, once; a second move is an error.
    for (let i = 0; i < 2; i++) { const r = await pipeline(p, input, cwd, seen); if (r !== "moved") return r; }
    return gitError("the worktree's HEAD moved during the merge; request again");
  } catch (err) { return gitError((err as Error)?.message ?? String(err)); }
}

export const MAIN_REF_TYPE = "task-router/main-ref";
export type Advanced = { ok: true; push: string; pushed?: boolean } | { ok: false; reason: "main-dirty"; checkout: string } | { ok: false; reason: "git"; err: string };
/** Step 9's move of main (LD7), shared with the plan commits (LD10, D50): the checkout that has main fast-forwards to `commit` (it
 *  must be clean), else the ref moves from `main.sha`; then the push (`push`: its text for the detail) and the main-ref entry, the
 *  three in `exclusive` (review F3). */
export async function advanceMain(p: Pick<MergePorts, "git" | "settings" | "append" | "exclusive">, repo: string,
  main: { name: string; sha: string }, commit: string): Promise<Advanced> {
  const git = p.git, g = p.settings.mergeGate;
  const there = (await git.worktrees(repo)).find((w) => w.branch === main.name && !w.prunable);
  if (there && await git.dirty(there.dir)) return { ok: false, reason: "main-dirty", checkout: there.dir };
  const exclusive = p.exclusive ?? (<T>(f: () => Promise<T>) => f());
  return exclusive(async (): Promise<Advanced> => {
    const moved = there ? await git.ffMerge(there.dir, commit) : await git.updateRef(repo, `refs/heads/${main.name}`, commit, main.sha);
    if (!moved.ok) return { ok: false, reason: "git", err: moved.err };
    let push = "", pushed: boolean | undefined;
    if (g.push) {
      const pu = await git.push(repo, g.remote, main.name);
      pushed = pu.ok;
      push = pu.ok ? `; pushed to ${g.remote}` : `; push to ${g.remote} failed: ${pu.err}`;
    }
    p.append(MAIN_REF_TYPE, { repo, branch: main.name, sha: commit });
    return { ok: true, push, ...(pushed !== undefined && { pushed }) };
  });
}

// ── plan-bound branches (L7; design §3.4.2 steps 3–6, §3.5.5) ──
/** A plan-bound branch's plan at its commit: the record, the skeleton, the unit (its milestone, its tasks), the plan file's
 *  change against the main tip (`tick`: tick-only and its flips; undefined: unchanged). */
type Bound = { rec: PlanRecord; sk: Skeleton; id: string; milestone: Milestone; tasks: Task[]; file: string; changed: boolean; tick?: string[] };
/** undefined: the plan at `commit` is missing or not the approved one (`plan-changed`). */
async function boundOf(p: MergePorts, plans: PlanStore, repo: string, unit: { slug: string; id: string }, base: string, commit: string): Promise<Bound | undefined> {
  const rec = plans.get(unit.slug);
  const after = rec && await p.git.show(repo, commit, rec.file);
  const parsed = after === undefined ? undefined : parsePlan(after);
  if (!rec || after === undefined || !parsed || skeletonHash(parsed.sk) !== rec.skeletonHash) return undefined;
  const milestone = parsed.sk.milestones.find((m) => m.id === unit.id || m.tasks.some((x) => x.id === unit.id));
  if (!milestone) return undefined;
  const task = milestone.tasks.find((x) => x.id === unit.id);
  const before = await p.git.show(repo, base, rec.file);
  const tick = before === undefined ? undefined : tickOnly(before, after);
  return { rec, sk: parsed.sk, id: unit.id, milestone, tasks: task ? [task] : milestone.tasks, file: rec.file, changed: before !== after,
    ...(tick?.ok && { tick: tick.flipped }) };
}
/** A plan-bound branch's size budget (§3.5.5 `over-budget`; `planBudget`, which the author and the validation read too). */
const budgetOf = (s: RouterSettings, b: Bound | undefined): { lines: number; files: number } =>
  b ? planBudget(s, b.milestone.branch) : { lines: s.mergeGate.maxDiffLines, files: s.mergeGate.maxDiffFiles };
/** The merged tasks whose checks guard against a regression (`plans.regression`): of the unit's milestone or of the whole plan,
 *  without the unit's own tasks, in plan order. */
function regressionTasks(s: RouterSettings, b: Bound, branches: readonly BranchRecord[]): Task[] {
  const merged = mergedUnits(b.sk, b.rec.slug, branches), own = new Set(b.tasks.map((x) => x.id));
  const pool = s.plans.regression === "milestone" ? b.milestone.tasks : b.sk.milestones.flatMap((m) => m.tasks);
  return pool.filter((x) => merged.has(x.id) && !own.has(x.id));
}
const opened = (id: string | undefined): string => (id === undefined ? "" : ` (trigger ${id} is open)`);

async function pipeline(p: MergePorts, input: Input, cwd: string, seen: Seen): Promise<MergeResult | "moved"> {
  const s = p.settings, g = s.mergeGate, git = p.git;
  // ── 1 resolve: the repository, the branch (given, else the active one), its worktree, the main branch, the commit ──
  const active = p.branches.active() ?? p.branches.latest(["fixer", "blocked"]);
  let repo: string | undefined, branch: string;
  if (typeof input.branch === "string" && input.branch !== "") { repo = await git.root(cwd); branch = input.branch.replace(/^refs\/heads\//, ""); }
  else if (active) { repo = active.repo; branch = active.branch; }
  else return done("refused", "no-worktree", "no branch is given and none is active; start_branch makes one");
  seen.branch = branch;
  if (repo === undefined) return gitError(`${cwd} is not in a git repository`);
  await refreshFacts({ git, store: p.branches, settings: s }, repo); // D39
  let main: { name: string; sha: string } | undefined;
  for (const name of g.mainBranches) { const sha = await git.sha(repo, name); if (sha !== undefined) { main = { name, sha }; break; } }
  if (!main) return gitError(`none of the main branches (${g.mainBranches.join(", ")}) exists in ${repo}`);
  let rec = p.branches.get(repo, branch);
  if (rec?.state === "fixer" && p.fixerGone?.(rec.fixer)) { // review F5: a vanished fixer gives the branch back
    const { fixer: _gone, ...rest } = rec;
    rec = { ...rest, state: "active" };
    p.branches.update(rec);
  }
  const x = { branch, main: main.name };
  /** A blocked plan-bound branch (design §3.4.4): its text names amend_plan and the open remediation-failed trigger. */
  const blockedOf = (r: MergeResult): MergeResult => {
    const plan = rec?.plan;
    if (r.reason !== "blocked" || !plan) return r;
    const t = p.plans?.openTriggers(plan.slug).find((y) => y.kind === "remediation-failed" && y.task === plan.id);
    return { ...r, detail: reasonText("blocked", { branch, plan: plan.slug }) + opened(t?.id) };
  };
  const isMain = g.mainBranches.includes(branch);
  const wt = isMain ? undefined : (await git.worktrees(repo)).find((w) => w.branch === branch && !w.prunable);
  if (!wt) { // a branch without a worktree: its state says more than its missing worktree
    const why = refusal({ isMain, state: rec?.state, dirty: false, behind: false });
    return blockedOf(refuse(why ?? "no-worktree", { ...x, fixer: rec?.fixer ?? "" }));
  }
  const commit = await git.sha(wt.dir, "HEAD");
  if (commit === undefined) return gitError(`cannot read HEAD of ${wt.dir}`);
  // ── 2 refuse ──
  const why = refusal({ isMain, state: rec?.state, dirty: await git.dirty(wt.dir), behind: !(await git.isAncestor(repo, main.sha, commit)) });
  if (why) return blockedOf(refuse(why, { ...x, worktree: wt.dir, fixer: rec?.fixer ?? "" }, commit));
  // ── plan-bound (L7): the plan at the commit has the approved skeleton ──
  let bound: Bound | undefined;
  if (rec?.plan && p.plans) {
    bound = await boundOf(p, p.plans, repo, rec.plan, main.sha, commit);
    if (!bound) return refuse("plan-changed", {}, commit);
  }
  /** Opens a trigger for this branch's unit; its id. */
  const trigger = (b: Bound, kind: "non-whitelisted" | "over-budget" | "regression"): string | undefined => p.plans?.open(b.rec.slug, kind, b.id);
  // ── 3 size (a tick-only plan change counts toward none; a plan-bound branch by its plan budget) ──
  const st = await git.numstat(repo, main.sha, commit);
  if (st === undefined) return gitError(`cannot diff ${main.name}...${commit}`, commit);
  const z = sizeOf(st, bound?.file, bound?.tick !== undefined), lim = budgetOf(s, bound);
  seen.nLines = z.lines;
  seen.nFiles = z.files;
  if (z.lines > lim.lines || z.files > lim.files) {
    const r = refuse("size", { lines: String(z.lines), files: String(z.files), maxLines: String(lim.lines), maxFiles: String(lim.files) }, commit);
    return bound ? { ...r, detail: r.detail + opened(trigger(bound, "over-budget")) } : r;
  }
  // ── 4 scope (plan-bound): the unit's files ∪ create, or the plan file ticked for the unit's own tasks ──
  if (bound) {
    const allowed = new Set(bound.tasks.flatMap((x) => [...x.files, ...(x.create ?? [])]));
    const own = new Set(bound.tasks.map((x) => x.id));
    const out = st.map((f) => f.path).filter((f) => (f === bound!.file ? bound!.changed && !bound!.tick?.every((id) => own.has(id)) : !allowed.has(f)));
    if (out.length) {
      const r = refuse("scope", {}, commit);
      return { ...r, detail: `${r.detail}: ${out.join(", ")}${opened(trigger(bound, "non-whitelisted"))}` };
    }
  }
  // ── 5 checks: the branch check (a plan unit's from the plan), then mergeGate.extraChecks, then the merged tasks' checks per
  //    plans.regression, in the worktree; the first failure refuses ──
  const checks: CheckRun[] = [];
  const own = bound ? bound.tasks.map((x) => x.check) : rec?.check ? [rec.check] : [];
  const earlier = bound && s.plans.regression !== "off" ? regressionTasks(s, bound, p.branches.all()) : [];
  // review F7: the branch check (a plan unit's checks and its regression checks too) is the model's text; the git classifier
  // reads each before the router runs any
  for (const cmd of [...own, ...earlier.map((x) => x.check)]) {
    const why = await vetCheck({ git, store: p.branches, settings: s }, cmd, wt.dir, branch);
    if (why !== undefined) return done("refused", "check", `the check \`${cmd}\` was not run: ${why}`, commit);
  }
  const runs = [...own.map((cmd) => ({ cmd })), ...g.extraChecks.map((cmd) => ({ cmd })), ...earlier.map((x) => ({ cmd: x.check, of: x.id }))];
  for (const c of runs) {
    if (p.signal?.aborted) return aborted(commit); // review F11: Esc stops the checks, not only the review
    const r = await p.run(c.cmd, wt.dir, s.checkTimeoutSec * 1000, p.signal);
    if (p.signal?.aborted) return aborted(commit);
    checks.push({ cmd: c.cmd, exit: r.exit, output: tailOf(r.output) });
    if (r.exit === 0) continue;
    const no = refuse("check", { cmd: c.cmd, exit: String(r.exit), tail: tailOf(r.output) }, commit);
    return "of" in c && bound ? { ...no, detail: `${no.detail}\n(a regression of ${c.of}; trigger ${trigger(bound, "regression")} is open)` } : no;
  }
  // ── 6 red run (a branch without a plan; its own check only). A plan unit's ran at plan time (§3.5.2): `vacuousCheck` ──
  const red: Red = bound ? (bound.tasks.some((x) => x.vacuousCheck) ? "passed" : "failed")
    : g.redRun && rec?.check ? await redRun(p, repo, main.sha, rec.check) : "skipped";
  if (p.signal?.aborted) return aborted(commit);
  // ── 7 approval reuse: (repo, branch, commit, tree) ──
  const tree = await git.tree(repo, commit);
  if (tree === undefined) return gitError(`cannot read the tree of ${commit}`, commit);
  const key: ApprovalKey = { repo, branch, commit, tree };
  let reviewId = p.approvals.find(key);
  if (reviewId === undefined) {
    // ── 8 review: the merge overseer in the main checkout, the worktree by its absolute path (LD14) ──
    const globs = riskGlobsOf(s), paths = st.map((f) => f.path), budget = diffBudget(g);
    const diff = await git.diff(repo, main.sha, commit, budget);
    if (cutDiff(diff)) { // review F9: the review never approves hunks it did not see
      return done("error", "review-unavailable", `${reasonText("review-unavailable", {})}: the diff ${main.name}..${commit.slice(0, 7)} is longer than the review's ${budget} lines`, commit);
    }
    if (diff === "" && st.length > 0) return gitError(`cannot read the diff ${main.name}..${commit}`, commit);
    const goal = bound ? (bound.tasks.length === 1 && bound.tasks[0]!.id === bound.id ? bound.tasks[0]!.goal : bound.milestone.goal) : rec?.goal;
    const invariants = bound ? [...bound.sk.invariants, ...bound.tasks.flatMap((x) => x.forbidden.map((f) => `${x.id} forbidden: ${f}`))].join("; ") : undefined;
    const text = reviewInput({ goal, summary: input.summary, invariants, checks, red, risky: paths.filter((f) => globs.some((x) => globMatch(x, f))),
      stat: st, base: main.sha, commit, diff, maxLines: budget });
    const out = await p.overseer.run({ role: "merge", input: text, cwd: p.branches.facts.mainCheckout.get(repo) ?? repo, worktree: wt.dir,
      submit: verdictSubmit(new Set(paths)), commit, branch, signal: p.signal });
    if (!out.ok) {
      const r: MergeReason = out.outcome === "aborted" ? "aborted" : "review-unavailable";
      return done("error", r, out.why ? `${reasonText(r, {})}: ${out.why}` : reasonText(r, {}), commit); // a cap or a full member (L4 note)
    }
    if (!approve(out.value.findings)) {
      // Review F8: a branch without a record (D40) gets a hand-made one, which holds its counts and is never active.
      const now = p.branches.get(repo, branch) ?? { repo, branch, worktree: wt.dir, base: main.sha, state: "active" as const, rejections: 0, fixerRuns: 0, handmade: true as const };
      const rej: BranchRecord = { ...now, rejections: now.rejections + 1 }, findings = out.value.findings.map(findingLine);
      const answer = { commit, reviewId: out.reviewId, findings };
      // S28: a fixer round rejected again with fixerRounds used up blocks the branch; else the fixer after enough rejections.
      if (rej.fixerRuns >= g.fixerRounds && rej.fixerRuns > 0) {
        p.branches.update({ ...rej, state: "blocked" });
        // a plan-bound branch opens remediation-failed (design §3.4.4, §3.5.5)
        const detail = bound ? reasonText("blocked", { branch, plan: bound.rec.slug }) + opened(p.plans?.open(bound.rec.slug, "remediation-failed", bound.id)) : reasonText("blocked", { branch });
        return { status: "refused", reason: "blocked", detail, ...answer };
      }
      if (p.fixer && g.fixerRounds > 0 && rej.rejections >= g.rejectionsBeforeFixer) { // review F11: fixerRounds 0 = no fixer
        const card = fixerCard(paths, out.value.findings, rec?.check);
        const fx = await p.fixer({ worktree: wt.dir, reviewId: out.reviewId, brief: fixerBrief(card),
          message: fixerMessage({ branch, worktree: wt.dir, reviewId: out.reviewId, findings }) });
        if (fx.ok) {
          p.branches.update({ ...rej, state: "fixer", fixer: fx.name, fixerRuns: rej.fixerRuns + 1 });
          return { status: "fixer", detail: reasonText("fixer-running", { fixer: fx.name }), ...answer };
        }
        p.branches.update(rej);
        return { status: "revise", detail: `${REVISE_TEXT}; the fixer could not start: ${fx.reason}`, ...answer };
      }
      p.branches.update(rej);
      return { status: "revise", detail: REVISE_TEXT, ...answer };
    }
    reviewId = out.reviewId;
    p.approvals.add(key, reviewId);
  }
  // ── 9 merge: fast-forward only (LD7), so main's tree is the reviewed and checked one ──
  if ((await git.sha(wt.dir, "HEAD")) !== commit) return "moved";
  const adv = await advanceMain(p, repo, main, commit);
  if (!adv.ok) return { ...(adv.reason === "main-dirty" ? refuse("main-dirty", { checkout: adv.checkout }, commit) : gitError(adv.err, commit)), reviewId };
  let detail = `merged ${branch} into ${main.name} at ${commit.slice(0, 7)}${adv.push}`;
  const pushed = adv.pushed;
  // A branch the router made becomes `merged` and is cleaned up; one made by hand (D40, with or without a hand-made record of its
  // rejections) is left as it is (review F8).
  const now = p.branches.get(repo, branch);
  if (now && !now.handmade) {
    const merged: BranchRecord = { ...now, state: "merged" };
    p.branches.put(merged);
    if (s.worktrees.removeAfterMerge) {
      const why = await cleanupBranch({ git, store: p.branches, settings: s }, merged, main.name);
      if (why) detail += `; ${why}`;
    }
  }
  return { status: "merged", detail, commit, reviewId, ...(pushed !== undefined && { pushed }) };
}

// ── the request_merge tool (design §3.4.1; plan D48, D49) ──
/** Design §3.4.1, verbatim. */
export const REQUEST_MERGE_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    branch: { type: "string", description: "default: the active worktree's branch" },
    summary: { type: "string", maxLength: 500, description: "what the branch does, for the reviewer" },
  },
} as const satisfies Schema;
/** The tool's text (D48): `status: <s> (<reason>)`, the detail, one line per finding. */
export const mergeText = (r: MergeResult): string =>
  [`status: ${r.status}${r.reason ? ` (${r.reason})` : ""}`, r.detail, ...(r.findings ?? [])].join("\n");

/** `request_merge` (main session only): `ports(signal)` gives the pipeline its ports for one call, `ready` the session_start work
 *  it waits for. Invalid input is refused before anything runs; `isError` only for that and `status: "error"` (D48). */
export function requestMergeTool(ports: (signal: AbortSignal | undefined) => MergePorts, ready: () => Promise<void> = async () => undefined): RouterTool {
  return {
    name: "request_merge",
    label: "Request merge",
    description: "Merge a branch into the main branch through the router's gate: refusals and the size limit first, then the checks, "
      + "then an independent review; an approved branch is fast-forwarded. Default: the active worktree's branch. Commit first.",
    parameters: REQUEST_MERGE_SCHEMA,
    async execute(_id, params, signal, _update, ctx) {
      const bad = check(REQUEST_MERGE_SCHEMA, params);
      if (bad.length) return errorReply(`invalid input: ${bad.join("; ")}`);
      await ready();
      const sig = signal instanceof AbortSignal ? signal : undefined;
      const r = await requestMerge(ports(sig), params as Input, typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd());
      return { content: [{ type: "text", text: mergeText(r) }], details: r, ...(r.status === "error" && { isError: true }) };
    },
  };
}

// ── bypass detection (design §3.4.6): main moved outside the gate ──
export type MainRef = { repo: string; branch: string; sha: string };
/** The last known main tip per repository (`task-router/main-ref`; the merge's step 9 writes it too), rebuilt from the session. */
export type MainRefs = { get(repo: string): MainRef | undefined; put(r: MainRef): void; observe(type: string, data: unknown): void; rebuild(entries: unknown[]): void };
const mainRefOf = (d: unknown): MainRef | undefined => {
  const x = d as Record<string, unknown> | null;
  return x !== null && typeof x === "object" && [x.repo, x.branch, x.sha].every((v) => typeof v === "string" && v !== "")
    ? { repo: x.repo as string, branch: x.branch as string, sha: x.sha as string } : undefined;
};
export function createMainRefs(append: (customType: string, data: unknown) => void): MainRefs {
  const refs = new Map<string, MainRef>();
  const observe = (type: string, data: unknown): void => {
    const r = type === MAIN_REF_TYPE ? mainRefOf(data) : undefined;
    if (r) refs.set(r.repo, r);
  };
  return {
    get: (repo) => refs.get(repo),
    put(r) { refs.set(r.repo, r); append(MAIN_REF_TYPE, { repo: r.repo, branch: r.branch, sha: r.sha }); },
    observe,
    rebuild(entries) {
      refs.clear();
      for (const e of entries) { const x = e as { customType?: unknown; data?: unknown } | null; if (typeof x?.customType === "string") observe(x.customType, x.data); }
    },
  };
}
export type Bypass = { repo: string; branch: string; from: string; to: string };
/** Reads each repository's main tip and compares it with the record: a moved tip is a bypass and updates the record; a
 *  repository seen the first time (or whose main branch changed name) is recorded silently. A repository without a main
 *  branch, or a failing read, is skipped. */
export async function checkBypass(d: { git: Git; settings: RouterSettings; refs: MainRefs }, repos: Iterable<string>): Promise<Bypass[]> {
  const out: Bypass[] = [];
  for (const repo of repos) {
    let main: { name: string; sha: string } | undefined;
    for (const name of d.settings.mergeGate.mainBranches) { const sha = await d.git.sha(repo, name); if (sha !== undefined) { main = { name, sha }; break; } }
    if (!main) continue;
    const rec = d.refs.get(repo);
    if (rec && rec.branch === main.name && rec.sha === main.sha) continue;
    d.refs.put({ repo, branch: main.name, sha: main.sha });
    if (rec && rec.branch === main.name) out.push({ repo, branch: main.name, from: rec.sha, to: main.sha });
  }
  return out;
}
/** Neutral wording: the router cannot tell who moved the ref (§3.4.6). */
export const bypassText = (b: Bypass): string =>
  `main moved outside the gate (${basename(b.repo)} ${b.branch} ${b.from.slice(0, 7)}→${b.to.slice(0, 7)})`;
export const bypassHint = (b: Bypass): string =>
  `<router-hint trip="gatebypass">${bypassText(b)}. The router does not revert it; merge into a main branch only with request_merge.</router-hint>`;
