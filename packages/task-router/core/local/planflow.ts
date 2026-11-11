// Local mode L7 (design §3.5.2, §3.5.4; plan D49–D53, LD10): the plan flow behind `plan_request` and `amend_plan`.
// L7.T6: `plan_request` step 1, the grounding check, refuses before any overseer runs (a main checkout that is dirty too, D51).
// L7.T7: steps 2–3, the plan author and the red runs of its task checks on the main tip, counted toward `plans.rounds` (D52).
// L7.T8: steps 4–5, the plan file committed on main through the merge's fast-forward path (LD10, D50), recorded, and the
// first startable unit.
// L7.T14: `amend_plan` steps 1–2, the trigger (an open one, or an interface-break with failing evidence) and the validation of
// the amended skeleton (its own findings only; checked tasks immutable).
// L7.T15: steps 3–5, the review kind (delta or plan-review), the amendment committed on main, the rejections per trigger and the
// plan author's rewrite once plans.rounds are spent. The new and changed tasks run red on the main tip, as at plan time.
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, posix, relative } from "node:path";
import type { Runner } from "../gate.ts";
import type { PlanLogInput } from "../outcome.ts";
import type { RouterSettings } from "../types.ts";
import type { BranchStore } from "./branches.ts";
import type { Git } from "./git.ts";
import { globMatch } from "../glob.ts";
import { advanceMain, type OverseerPort, reasonText, tailOf } from "./merge.ts";
import { type SubmitSpec, verdictSubmit } from "./overseer.ts";
import { check as schemaCheck } from "./schema.ts";
import { canonical, parsePlan, planBudget, type PlanFs, type PlanRecord, renderPlan, type Skeleton, SKELETON_SCHEMA, skeletonHash, type Task,
  type Trigger, validateSkeleton } from "./plan.ts";
import { approve, findingLine, type Finding } from "./verdict.ts";
import { mergedUnits, otherSession, type PlanStore } from "./plans.ts";
import { branchName, refreshFacts, unitFacts, vetCheck, worktreeDir } from "./worktree.ts";

export type PlanPorts = {
  git: Git; run: Runner; overseer: OverseerPort; branches: BranchStore; plans: PlanStore; settings: RouterSettings;
  /** `pi.appendEntry` (design §3.0.2). */
  append(customType: string, data: unknown): void;
  /** A fresh path for a red run's temporary worktree (it must not exist). */
  tmp(): string;
  signal?: AbortSignal;
  /** The `plan` lines (design §3.0.3); absent: none. */
  log?(i: PlanLogInput): void;
  /** The clock of a round's red-run time (review L7 F9); absent: `Date.now`. */
  now?(): number;
  /** The plan commit's move of main, as the merge's step 9 (`MergePorts.exclusive`, review F3); absent: at once. */
  exclusive?<T>(f: () => Promise<T>): Promise<T>;
};
export type PlanInput = { slug: string; request: string; acceptance: string[]; files: string[]; symbols?: string[] };
export const PLAN_REASONS = ["grounding", "slug", "main-dirty", "invalid", "broken-check", "author-unavailable", "aborted", "git"] as const;
export type PlanReason = (typeof PLAN_REASONS)[number];
export type PlanStatus = "approved" | "refused" | "error";
/** `path`: the plan file (relative to the repository); `next`: the first startable unit. */
export type PlanResult = { status: PlanStatus; reason?: PlanReason; detail: string; path?: string; commit?: string; reviewId?: string;
  next?: { slug: string; id: string } };

const done = (status: PlanStatus, reason: PlanReason | undefined, detail: string): PlanResult => ({ status, ...(reason && { reason }), detail });

/** A path as the plan holds it: relative to the repository, `/`-separated; undefined when it leaves the repository. */
export function repoPath(checkout: string, p: string): string | undefined {
  const rel = isAbsolute(p) ? relative(checkout, p) : normalize(p);
  const out = rel.split("\\").join("/");
  return out === "" || out === "." || out === ".." || out.startsWith("../") || isAbsolute(out) ? undefined : posix.normalize(out);
}
/** The file facts of a checkout for the skeleton rules (design §3.2.4); a path that leaves it neither exists nor is a directory. */
export const checkoutFs = (checkout: string): PlanFs => {
  const at = (p: string): string | undefined => {
    const q = p === "." ? "." : repoPath(checkout, p);
    return q === undefined ? undefined : join(checkout, q);
  };
  return {
    exists: (p) => { const f = at(p); return f !== undefined && existsSync(f); },
    isDir: (p) => { const f = at(p); try { return f !== undefined && statSync(f).isDirectory(); } catch { return false; } },
  };
};

/** The repository's main branch (the first of `mainBranches` that exists) and the checkout that has it, if any. */
export async function mainOf(git: Git, s: RouterSettings, repo: string): Promise<{ name: string; sha: string; checkout?: string } | undefined> {
  for (const name of s.mergeGate.mainBranches) {
    const sha = await git.sha(repo, name);
    if (sha === undefined) continue;
    const there = (await git.worktrees(repo)).find((w) => w.branch === name && !w.prunable);
    return { name, sha, ...(there && { checkout: there.dir }) };
  }
  return undefined;
}

/** `plan_request` (design §3.5.2). Total: an unexpected exception is a `git` error. */
export async function planRequest(p: PlanPorts, input: PlanInput, cwd: string): Promise<PlanResult> {
  try { return await request(p, input, cwd); } catch (err) { return done("error", "git", `git failed: ${(err as Error)?.message ?? String(err)}`); }
}

async function request(p: PlanPorts, input: PlanInput, cwd: string): Promise<PlanResult> {
  const s = p.settings, git = p.git;
  // ── 1 grounding: the repository, its main branch and checkout, the slug, the files and symbols, a clean main (D51) ──
  const repo = await git.root(cwd);
  if (repo === undefined) return done("error", "git", `git failed: ${cwd} is not in a git repository`);
  await refreshFacts({ git, store: p.branches, settings: s }, repo);
  const main = await mainOf(git, s, repo);
  if (!main) return done("error", "git", `git failed: none of the main branches (${s.mergeGate.mainBranches.join(", ")}) exists in ${repo}`);
  const checkout = main.checkout ?? p.branches.facts.mainCheckout.get(repo) ?? repo;
  const file = posix.join(s.plans.dir, `${input.slug}.md`);
  if (p.plans.get(input.slug) || existsSync(join(checkout, file))) {
    if (!p.plans.get(input.slug) && (await git.show(repo, main.sha, file)) !== undefined) { // review L7 F13
      return done("refused", "slug", `the slug ${input.slug} is used by ${file} on ${main.name}, a plan of another session `
        + "(plan records stay in the session that made them); continue the plan there, or choose another slug");
    }
    return done("refused", "slug", `the slug ${input.slug} is used by a plan already; choose another`);
  }
  const misses: string[] = [], files: string[] = [];
  for (const f of input.files) {
    const rel = repoPath(checkout, f);
    if (rel === undefined || !existsSync(join(checkout, rel))) misses.push(`file ${f} does not exist`);
    else files.push(rel);
  }
  for (const sym of input.symbols ?? []) {
    if (!(await git.grepWord(checkout, sym, files)).length) misses.push(`symbol ${sym} occurs as a word in none of the files`);
  }
  if (misses.length) return done("refused", "grounding", `grounding failed: ${misses.join("; ")}`);
  if (main.checkout && (await git.dirty(main.checkout))) return done("refused", "main-dirty", reasonText("main-dirty", { checkout: main.checkout }));
  // ── 2–3 author, red runs ──
  const out = await p.overseer.run({ role: "plan-author", input: authorInput(s, input, files, await git.lsFiles(checkout, REPO_MAP)), cwd: checkout,
    submit: planSubmit(p, { repo, slug: input.slug, checkout, tip: main.sha }), signal: p.signal });
  if (p.signal?.aborted || (!out.ok && out.outcome === "aborted")) return done("error", "aborted", "aborted");
  if (!out.ok) return done("error", "author-unavailable", `the plan author is unavailable (${out.outcome})${because(out.why)}`);
  if (!out.value.ok) return done("error", out.value.reason, `${AUTHOR_FAILED[out.value.reason]}: ${out.value.reasons.join("; ")}`);
  // ── 4 render, commit on main (D50: plumbing, then the merge's fast-forward path), record ──
  const sk = out.value.sk, reviewId = out.reviewId;
  logPlan(p, { slug: input.slug, action: "skeleton", nTasks: nTasks(sk), reviewId });
  const now = await mainOf(git, s, repo);
  if (!now) return done("error", "git", `git failed: the main branch of ${repo} is gone`);
  const c = await git.commitFile(repo, now.sha, file, renderPlan({ slug: input.slug, request: input.request }, sk, new Set()),
    `plan(${input.slug}): approved ${reviewId}`);
  if (!c.ok) return { ...done("error", "git", `git failed: ${c.err}`), reviewId };
  const adv = await advanceMain(p, repo, now, c.out);
  if (!adv.ok) {
    return { ...(adv.reason === "main-dirty" ? done("refused", "main-dirty", reasonText("main-dirty", { checkout: adv.checkout }))
      : done("error", "git", `git failed: ${adv.err}`)), reviewId };
  }
  p.plans.put({ slug: input.slug, repo, file, skeletonHash: skeletonHash(sk), approvedBy: reviewId, triggers: [] });
  logPlan(p, { slug: input.slug, action: "approve", nTasks: nTasks(sk), reviewId });
  // ── 5 return: the path and the first startable unit ──
  const next = startable(sk, mergedUnits(sk, input.slug, p.branches.all()))[0];
  const start = next ? `; start with start_branch {"plan": {"slug": "${input.slug}", "id": "${next}"}}` : "";
  return { status: "approved", detail: `plan approved: ${file} at ${c.out.slice(0, 7)}${adv.push}${start}`, path: file, commit: c.out, reviewId,
    ...(next && { next: { slug: input.slug, id: next } }) };
}

/** The units a plan-bound branch may start now (design §3.3.2): per milestone whose dependencies merged, the milestone itself
 *  (`branch: milestone`) or each of its tasks whose dependencies merged (`branch: task`); merged units are not startable. */
export function startable(sk: Skeleton, merged: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const m of sk.milestones) {
    if (merged.has(m.id) || !m.dependsOn.every((d) => merged.has(d))) continue;
    if (m.branch === "milestone") out.push(m.id);
    else for (const t of m.tasks) if (!merged.has(t.id) && t.dependsOn.every((d) => merged.has(d))) out.push(t.id);
  }
  return out;
}

// ── steps 2–3: the author and the red runs ──
/** Design §3.2.1: the repository map is the first 400 tracked paths. */
const REPO_MAP = 400;
const AUTHOR_FAILED: Record<"invalid" | "broken-check" | "git", string> = {
  git: "git failed",
  invalid: "the plan author's skeleton is still invalid after plans.rounds",
  "broken-check": "task checks still cannot run after plans.rounds",
};
/** Review L7 F4: the budgets the merge enforces (`planBudget`), so the author plans what can merge. */
const limits = (s: RouterSettings): string => {
  const l = s.plans, task = planBudget(s, "task"), whole = planBudget(s, "milestone");
  return `Limits: a task changes at most ${l.taskFiles} files and about ${l.taskLines} lines; its files and create name at most ${task.files} paths, `
    + `and its branch merges at most ${task.lines} lines. A milestone has at most ${l.milestoneTasks} tasks; one with branch "milestone" is one branch: `
    + `its tasks' files and create name at most ${whole.files} paths together, and it merges at most ${whole.lines} lines. Paths are relative to the repository root.`;
};
/** Spot-check F1: how long the router lets the task checks run, so the author plans checks that finish (each has its own time; the
 *  round's red runs have a cap together). */
const checkTime = (s: RouterSettings): string => `Check time: each task check runs at most ${s.checkTimeoutSec} s; all the checks of one round together at most `
  + `${s.plans.redRunSec} s (plans.redRunSec). A check cut short, or left unstarted by that cap, is a finding.`;
/** The author's input (design §3.2.1): the request digest, the acceptance, the grounding, the limits, the repository map. */
export function authorInput(s: RouterSettings, i: PlanInput, files: readonly string[], map: readonly string[]): string {
  return [`Request: ${i.request}`, "Acceptance:", ...i.acceptance.map((a) => `- ${a}`),
    `Grounding files: ${files.join(", ")}`, `Grounding symbols: ${(i.symbols ?? []).join(", ") || "none"}`,
    limits(s), checkTime(s),
    "Every task check must fail on the main tip and pass once the task is done.",
    `Repository map (the first ${REPO_MAP} tracked paths):`, ...map].join("\n");
}

/** What `submit_plan` records: an accepted skeleton, or why the plan fails once `plans.rounds` are spent. */
export type Authored = { ok: true; sk: Skeleton } | { ok: false; reason: "invalid" | "broken-check" | "git"; reasons: string[] };
/** A red run's outcome: the check's exit, or `blocked`, the git guard's reason (review F7: the check was not run), or `git`, why
 *  git could not make its worktree (review L7 F6: the check was not run; the flow fails with `git`). */
type RedExit = { task: Task; exit: number; blocked?: string; git?: string; late?: string };
/** The first red run git could not make a worktree for, as a `git failed` detail's text. */
const lostRed = (red: readonly RedExit[]): string | undefined => {
  const r = red.find((x) => x.git !== undefined);
  return r && `the red run of ${r.task.id} has no worktree: ${r.git}`;
};
/** Exit 0: vacuous; 126/127, blocked or late: broken (design §3.5.2 step 3; review L7 F9: a check the round's time cut short or
 *  left unstarted is never a pass). */
const failsRed = (r: RedExit): boolean => r.blocked !== undefined || r.late !== undefined || r.exit === 0 || r.exit === 126 || r.exit === 127;
const brokenRed = (r: RedExit): boolean => failsRed(r) && (r.blocked !== undefined || r.late !== undefined || r.exit !== 0);
/** `M1.T1: \`cmd\` exit 127`, or `… was not run: <the guard's reason>`, or `… <late>`. */
const redLine = (r: RedExit): string =>
  `${r.task.id}: \`${r.task.check}\` ${r.blocked !== undefined ? `was not run: ${r.blocked}` : r.late ?? `exit ${r.exit}`}`;
const redFinding = (r: RedExit, i: number, tip: string): Finding => ({
  id: `F${i + 1}`, category: "check", target: r.task.id, blocking: true,
  defect: r.blocked !== undefined ? `the router's git guard blocks the check: ${r.blocked}` : r.late !== undefined ? `the check ${r.late}`
    : r.exit === 0 ? "the check passes on the main tip, before the task is done" : `the check cannot run (exit ${r.exit})`,
  evidence: r.blocked !== undefined ? `\`${r.task.check}\` was not run` : r.late !== undefined ? `\`${r.task.check}\` on ${tip.slice(0, 7)}`
    : `\`${r.task.check}\` exit ${r.exit} on ${tip.slice(0, 7)}`,
  fix: r.blocked !== undefined ? "a check that writes no main branch" : r.late !== undefined ? "fewer or faster task checks"
    : r.exit === 0 ? "the check fails on the main tip and passes once the task is done" : "the check command runs on the main tip and fails there",
});

/** Each task's check on `tip` in its own detached temporary worktree (removed afterwards); a worktree git cannot make ends the
 *  runs (review L7 F6: never a pass).
 *  Review F7: the git classifier reads each check first, as in the worktree of the branch it will run on (`unit`: the task's
 *  plan unit); a check it blocks is not run. */
async function redRuns(p: PlanPorts, repo: string, tip: string, tasks: readonly Task[], slug: string, unit: (t: Task) => string): Promise<RedExit[]> {
  const out: RedExit[] = [], w = p.settings.worktrees, now = p.now ?? Date.now, full = p.settings.checkTimeoutSec * 1000;
  // review L7 F9, spot-check F1: each check has its own checkTimeoutSec; the round's red runs together have plans.redRunSec,
  // counted from the first, and a check gets the lesser of its own time and what is left of the round's
  const cap = p.settings.plans.redRunSec * 1000;
  const late = (cut: boolean) => `was not run${cut ? " to its end" : ""}: the round's red runs share plans.redRunSec (${p.settings.plans.redRunSec} s)`;
  let end: number | undefined;
  for (const task of tasks) {
    if (p.signal?.aborted) break; // review F11: Esc stops the red runs
    const branch = branchName(w.branchPrefix, { plan: slug, id: unit(task) });
    const blocked = await vetCheck({ git: p.git, store: p.branches, settings: p.settings }, task.check, worktreeDir(w.root, repo, branch), branch);
    if (blocked !== undefined) { out.push({ task, exit: -1, blocked }); continue; }
    const ms = end === undefined ? Math.min(full, cap) : Math.min(full, end - now());
    if (ms <= 0) { out.push({ task, exit: -1, late: late(false) }); continue; }
    const dir = p.tmp();
    const made = await p.git.worktreeAddDetached(repo, dir, tip);
    if (!made.ok) { out.push({ task, exit: -1, git: made.err.trim() }); break; }
    end ??= now() + cap;
    try {
      const r = await p.run(task.check, dir, ms, p.signal);
      out.push(r.timedOut && ms < full ? { task, exit: -1, late: late(true) } : { task, exit: r.exit });
    } finally { await p.git.worktreeRemove(repo, dir, true); }
  }
  return out;
}

/** `submit_plan` (design §3.5.2 steps 2–3): validation, then the red runs. Within `plans.rounds` a failure goes back to the author as
 *  a resubmit; afterwards the submission is final: still invalid or broken fails the plan (D52), still vacuous is accepted with
 *  `vacuousCheck` on those tasks (LD9). `rewrite` (design §3.5.4 step 5): the author rewrites one milestone of an approved plan;
 *  only the rewrite's own findings count, and only its new or changed tasks run red. Each overseer attempt has its own rounds
 *  (review L7 F3: the fallback author starts afresh). */
export function planSubmit(p: PlanPorts, x: { repo: string; slug: string; checkout: string; tip: string; rewrite?: Rewrite }): SubmitSpec<Authored> {
  const rounds = p.settings.plans.rounds, used = new Map<number, number>();
  return {
    name: "submit_plan", parameters: SKELETON_SCHEMA, resubmits: rounds,
    description: "Submit the plan skeleton: milestones of small tasks, each with its files and one check command that fails before the task "
      + "and passes after it. The router validates it and runs every check on the main tip; a finding comes back as a resubmit.",
    async check(input, attempt = 1) {
      const round = (used.get(attempt) ?? 0) + 1;
      used.set(attempt, round);
      const last = round > rounds;
      const v = x.rewrite ? validateRewrite(input, p.settings, checkoutFs(x.checkout), x.rewrite) : validateSkeleton(input, p.settings, checkoutFs(x.checkout));
      if (!v.ok) return last ? { ok: true, value: { ok: false, reason: "invalid", reasons: v.reasons } } : v;
      const tasks = x.rewrite ? changedTasks(x.rewrite.old, v.value) : v.value.milestones.flatMap((m) => m.tasks);
      const red = await redRuns(p, x.repo, x.tip, tasks, x.slug, unitOf(v.value));
      if (p.signal?.aborted) return { ok: false, reasons: ["aborted"] }; // the run ends aborted (review F11)
      const lost = lostRed(red);
      if (lost) return { ok: true, value: { ok: false, reason: "git", reasons: [lost] } };
      const bad = red.filter(failsRed);
      if (!bad.length) return { ok: true, value: { ok: true, sk: x.rewrite ? marked(x.rewrite.old, v.value, new Set()) : v.value } };
      const lines = bad.map((r, i) => findingLine(redFinding(r, i, x.tip)));
      if (!last) return { ok: false, reasons: lines };
      const broken = bad.filter(brokenRed);
      if (broken.length) return { ok: true, value: { ok: false, reason: "broken-check", reasons: broken.map(redLine) } };
      return { ok: true, value: { ok: true, sk: marked(x.rewrite?.old, v.value, new Set(bad.map((r) => r.task.id))) } };
    },
  };
}

// ── amend_plan (design §3.5.4) ──
export type AmendChange = { op: "add" | "replace" | "remove"; id?: string; after?: string; task?: Task };
export type AmendInput = { slug: string; trigger: { id: string; kind?: "interface-break"; evidenceCommand?: string }; changes: AmendChange[];
  reason: string };
export const AMEND_REASONS = ["no-plan", "plan-changed", "trigger", "evidence", "checked", "invalid", "broken-check", "main-dirty",
  "review-unavailable", "author-unavailable", "aborted", "git"] as const;
export type AmendReason = (typeof AMEND_REASONS)[number];
/** `trigger`: the trigger the amendment answers; `full`: the review was a plan-review; `findings`: a rejection's. */
export type AmendResult = { status: "approved" | "rejected" | "refused" | "error"; reason?: AmendReason; detail: string; trigger?: string;
  full?: boolean; reviewId?: string; commit?: string; findings?: string[] };
const amendDone = (status: AmendResult["status"], reason: AmendReason | undefined, detail: string, more: Partial<AmendResult> = {}): AmendResult =>
  ({ status, ...(reason && { reason }), detail, ...more });

/** `amend_plan` (design §3.5.4). Total: an unexpected exception is a `git` error. */
export async function amendPlan(p: PlanPorts, input: AmendInput, cwd: string): Promise<AmendResult> {
  try { return await amendment(p, input, cwd); } catch (err) { return amendDone("error", "git", `git failed: ${(err as Error)?.message ?? String(err)}`); }
}

/** A skeleton without the router's own `vacuousCheck` marks, as `submit_plan`'s schema has it. */
const bare = (sk: Skeleton): Skeleton => ({ ...sk, milestones: sk.milestones.map((m) => ({ ...m, tasks: m.tasks.map(bareTask) })) });
const bareTask = ({ vacuousCheck: _v, ...t }: Task): Task => t;
const taskOf = (sk: Skeleton, id: string): Task | undefined => sk.milestones.flatMap((m) => m.tasks).find((t) => t.id === id);

/** Step 2: the changes applied in order to a copy; why a change cannot apply. `add` puts the task into the milestone its id
 *  names (after the task `after`, else last), or a new milestone of that id (after the milestone `after`, else last); `remove`
 *  takes a task (its milestone with its last task) or a milestone. */
export function applyChanges(sk: Skeleton, changes: readonly AmendChange[]): { sk: Skeleton; reasons: string[] } {
  const out = structuredClone(sk), reasons: string[] = [];
  const where = (id: string | undefined) => {
    for (const m of out.milestones) { const at = m.tasks.findIndex((t) => t.id === id); if (at >= 0) return { m, at }; }
    return undefined;
  };
  changes.forEach((c, i) => {
    const n = `change ${i + 1}`;
    if (c.op === "remove") {
      const mi = out.milestones.findIndex((m) => m.id === c.id), w = where(c.id);
      if (mi >= 0) out.milestones.splice(mi, 1);
      else if (!w) reasons.push(`${n}: no task ${c.id ?? "(no id)"}`);
      else {
        w.m.tasks.splice(w.at, 1);
        if (!w.m.tasks.length) out.milestones.splice(out.milestones.indexOf(w.m), 1);
      }
      return;
    }
    if (!c.task || typeof c.task !== "object") { reasons.push(`${n}: ${c.op} needs a task`); return; }
    const task = structuredClone(c.task);
    if (c.op === "replace") {
      const w = where(c.id);
      if (!w) reasons.push(`${n}: no task ${c.id ?? "(no id)"}`);
      else w.m.tasks[w.at] = task;
      return;
    }
    const mid = typeof task.id === "string" ? /^(M\d+)\.T\d+$/.exec(task.id)?.[1] : undefined;
    if (mid === undefined) { reasons.push(`${n}: the task's id names no milestone`); return; }
    const m = out.milestones.find((x) => x.id === mid);
    if (m) {
      const at = c.after === undefined ? m.tasks.length - 1 : m.tasks.findIndex((t) => t.id === c.after);
      if (at < 0 && c.after !== undefined) reasons.push(`${n}: no task ${c.after} in ${mid}`);
      else m.tasks.splice(at + 1, 0, task);
      return;
    }
    const at = c.after === undefined ? out.milestones.length - 1 : out.milestones.findIndex((x) => x.id === c.after);
    if (at < 0 && c.after !== undefined) { reasons.push(`${n}: no milestone ${c.after}`); return; }
    out.milestones.splice(at + 1, 0, { id: mid, goal: task.goal, acceptance: [], branch: "task", dependsOn: [], tasks: [task] });
  });
  return { sk: out, reasons };
}

async function amendment(p: PlanPorts, input: AmendInput, cwd: string): Promise<AmendResult> {
  const s = p.settings, git = p.git, slug = input.slug;
  const refused = (reason: AmendReason, detail: string, more: Partial<AmendResult> = {}) => amendDone("refused", reason, detail, more);
  // ── the plan: its record and its file on the main tip, with the approved skeleton ──
  const rec = p.plans.get(slug);
  if (!rec) {
    // review L7 F13: a plan file on main whose record stayed in another session
    const here = await git.root(cwd), m = here === undefined ? undefined : await mainOf(git, s, here);
    const file = posix.join(s.plans.dir, `${slug}.md`);
    if (here !== undefined && m && (await git.show(here, m.sha, file)) !== undefined) {
      return refused("no-plan", `no approved plan ${slug} in this session: ${otherSession(file, m.name)}`);
    }
    return refused("no-plan", `no approved plan ${slug}; plan_request makes one`);
  }
  const repo = rec.repo;
  await refreshFacts({ git, store: p.branches, settings: s }, repo);
  const main = await mainOf(git, s, repo);
  if (!main) return amendDone("error", "git", `git failed: none of the main branches (${s.mergeGate.mainBranches.join(", ")}) exists in ${repo}`);
  const checkout = main.checkout ?? p.branches.facts.mainCheckout.get(repo) ?? repo;
  const text = await git.show(repo, main.sha, rec.file), parsed = text === undefined ? undefined : parsePlan(text);
  if (!parsed || skeletonHash(parsed.sk) !== rec.skeletonHash) {
    return refused("plan-changed", `the plan file ${rec.file} on ${main.name} does not hold the approved skeleton`);
  }
  // review L7 F7: a dirty main checkout cannot take the amended plan (D51); refused before a trigger opens or a check runs
  if (main.checkout && (await git.dirty(main.checkout))) return refused("main-dirty", reasonText("main-dirty", { checkout: main.checkout }));
  const old = parsed.sk;
  // ── 1 trigger: an open one, or a new interface-break whose evidence command fails in the active worktree ──
  const t = input.trigger;
  let trigger: string, evidence: string | undefined;
  if (t.id === "new") {
    const cmd = t.evidenceCommand;
    if (t.kind !== "interface-break" || typeof cmd !== "string" || !cmd.trim()) return refused("trigger", "a new trigger needs kind interface-break and an evidenceCommand");
    const a = p.branches.active(), mine = a && a.repo === repo ? a : undefined, dir = mine ? mine.worktree : checkout;
    // review F7: the git classifier reads the command first, in its directory (the main checkout's branch is a main branch)
    const blocked = await vetCheck({ git, store: p.branches, settings: s }, cmd, dir, mine?.branch);
    if (blocked !== undefined) return refused("evidence", `the evidence command \`${cmd}\` was not run: ${blocked}`);
    const r = await p.run(cmd, dir, s.checkTimeoutSec * 1000, p.signal);
    if (p.signal?.aborted) return amendDone("error", "aborted", "aborted"); // review F11: before the trigger opens
    if (r.exit === 0) return refused("evidence", `the evidence command \`${cmd}\` exits 0 in ${dir}; an interface-break needs a command that fails`);
    // review L7 F10: a command that cannot run or does not finish shows no break (as a red run's 126/127)
    const why = r.timedOut ? `timed out in ${dir} (checkTimeoutSec ${s.checkTimeoutSec} s)` : r.exit === 126 || r.exit === 127 ? `cannot run in ${dir} (exit ${r.exit})` : undefined;
    if (why) return refused("evidence", `the evidence command \`${cmd}\` ${why}; an interface-break needs a command that runs and fails`);
    evidence = [`\`${cmd}\` exit ${r.exit} in ${dir}`, tailOf(r.output)].filter(Boolean).join("\n");
    trigger = p.plans.open(slug, "interface-break", a?.plan?.slug === slug ? a.plan.id : undefined)!;
  } else {
    const open = p.plans.openTriggers(slug);
    if (!open.length) return refused("trigger", "no replan trigger is open; finish the task as planned");
    if (!open.some((x) => x.id === t.id)) return refused("trigger", `trigger ${t.id} is not open; the open triggers: ${open.map((x) => x.id).join(", ")}`);
    trigger = t.id;
  }
  // ── 2 validate: the changes apply, checked tasks stay as they are, the amended skeleton passes §3.2.4 (only its own findings) ──
  const applied = applyChanges(old, input.changes);
  if (applied.reasons.length) return refused("invalid", `the amended plan is invalid: ${applied.reasons.join("; ")}`, { trigger });
  const merged = mergedUnits(old, slug, p.branches.all());
  const checked = new Set(old.milestones.flatMap((m) => m.tasks).map((x) => x.id).filter((id) => parsed.ticks.has(id) || merged.has(id)));
  const amended = bare(applied.sk), stuck = checkedReasons(old, amended, checked);
  if (stuck.length) return refused("checked", stuck.join("; "), { trigger });
  const own = ownReasons(s, checkoutFs(checkout), old, amended);
  if (own.length) return refused("invalid", `the amended plan is invalid: ${own.join("; ")}`, { trigger });
  // the new and changed tasks' checks on the main tip, as at plan time (§3.5.2 step 3): one that cannot run refuses, a vacuous
  // one is marked
  const changed = changedTasks(old, amended), red = await redRuns(p, repo, main.sha, changed, slug, unitOf(amended));
  if (p.signal?.aborted) return amendDone("error", "aborted", "aborted", { trigger });
  const lost = lostRed(red);
  if (lost) return amendDone("error", "git", `git failed: ${lost}`, { trigger });
  const broken = red.filter(brokenRed);
  if (broken.length) return refused("broken-check", `the amended checks cannot run: ${broken.map(redLine).join("; ")}`, { trigger });
  const passing = red.filter((r) => r.blocked === undefined && r.exit === 0);
  const final = marked(old, amended, new Set(passing.map((r) => r.task.id)));
  // review L7 F5: the reviewer and the model learn which amended checks pass on the main tip already (vacuous)
  const vacuous = passing.map((r) => `${r.task.id}: \`${r.task.check}\` exits 0 on ${main.name} ${main.sha.slice(0, 7)}, before the task is done (vacuous)`).join("; ");
  const vacNote = vacuous ? `; vacuous checks: ${vacuous}` : "";
  // ── 3 review: plan-review for an interface-break, an amended task in publicApiGlobs, a milestone added or removed; else delta ──
  const trig = p.plans.get(slug)!.triggers.find((x) => x.id === trigger)!;
  const removed = old.milestones.flatMap((m) => m.tasks).filter((x) => !taskOf(final, x.id));
  const olds = [...changed.flatMap((x) => taskOf(old, x.id) ?? []), ...removed];
  const paths = [...olds, ...changed].flatMap((x) => [...x.files, ...(x.create ?? [])]);
  const ms = (sk: Skeleton): string => sk.milestones.map((m) => m.id).sort().join(" ");
  const full = trig.kind === "interface-break" || paths.some((f) => s.plans.publicApiGlobs.some((g) => globMatch(g, f))) || ms(old) !== ms(final);
  const gone = new Set([...changed, ...removed].map((x) => x.id));
  const dependants = final.milestones.flatMap((m) => m.tasks).filter((x) => !gone.has(x.id) && x.dependsOn.some((d) => gone.has(d)));
  const c: AmendCtx = { rec, slug, request: requestOf(text!), trigger };
  const head = [`Plan: ${slug} (${rec.file})`, triggerLine(trig), ...(evidence ? [`Evidence: ${evidence}`] : []), `Reason: ${oneLine(input.reason)}`,
    ...(vacuous ? [`Vacuous checks: ${vacuous}`] : [])];
  const text2 = full ? [...head, "The plan with the amendment applied:", renderPlan({ slug, request: c.request }, final, kept(parsed, final))].join("\n")
    : [...head, ...section("Old tasks", olds.map(taskLine)), ...section("Proposed tasks", changed.map(taskLine)),
      ...section("Removed tasks", removed.map((x) => x.id)), ...section("Dependants", dependants.map(taskLine))].join("\n");
  const out = await p.overseer.run({ role: full ? "plan-review" : "delta", input: text2, cwd: checkout, submit: verdictSubmit(new Set([rec.file, ...paths])),
    signal: p.signal });
  if (!out.ok) {
    return out.outcome === "aborted" ? amendDone("error", "aborted", "aborted", { trigger, full })
      : amendDone("error", "review-unavailable", reasonText("review-unavailable", {}) + because(out.why), { trigger, full });
  }
  // ── 4 approved: re-render, commit on main, record, close the trigger ──
  if (approve(out.value.findings)) {
    const r = await commitAmended(p, c, final, out.reviewId, { trigger, full });
    return r.status === "approved" && vacuous ? { ...r, detail: `${r.detail}${vacNote}; the merge gate reports its red run as passed` } : r;
  }
  // ── 5 rejected: the findings; after plans.rounds rejections for this trigger the plan author rewrites the milestone ──
  const findings = out.value.findings.map(findingLine), n = p.plans.reject(slug, trigger), rounds = s.plans.rounds;
  logPlan(p, { slug, action: "reject", trigger: trig.kind, reviewId: out.reviewId, full });
  const no = { trigger, full, reviewId: out.reviewId, findings };
  if (n < rounds) return amendDone("rejected", undefined, `the plan amendment was rejected (${n} of plans.rounds ${rounds}); answer the findings with a new amend_plan${vacNote}`, no);
  const at = trig.task ?? input.changes.map((x) => x.id ?? x.task?.id).find((x): x is string => typeof x === "string");
  const mid = (at && /^M\d+/.exec(at)?.[0]) || old.milestones[0]!.id;
  const author = await p.overseer.run({ role: "plan-author", cwd: checkout, signal: p.signal,
    input: [`Rewrite milestone ${mid} of the plan below: the amendments proposed for it were rejected ${n} times (plans.rounds).`, ...head.slice(1),
      `Proposed changes: ${JSON.stringify(input.changes)}`, "Findings of the last review:", ...findings.map((x) => `- ${x}`),
      `Keep the invariants, every other milestone and every checked task (${[...checked].join(", ") || "none"}) exactly as they are; submit the whole skeleton.`,
      limits(s), "Every new or changed task check must fail on the main tip and pass once the task is done.", "The plan:", text!].join("\n"),
    submit: planSubmit(p, { repo, slug, checkout, tip: main.sha, rewrite: { old, checked, milestone: mid } }) });
  if (p.signal?.aborted || (!author.ok && author.outcome === "aborted")) return amendDone("error", "aborted", "aborted", no);
  if (!author.ok) return amendDone("error", "author-unavailable", `the plan author is unavailable (${author.outcome})${because(author.why)}`, no);
  if (!author.value.ok) return amendDone("error", author.value.reason, `${AUTHOR_FAILED[author.value.reason]}: ${author.value.reasons.join("; ")}`, no);
  logPlan(p, { slug, action: "skeleton", trigger: trig.kind, nTasks: nTasks(author.value.sk), reviewId: author.reviewId });
  const r = await commitAmended(p, c, author.value.sk, author.reviewId, { trigger, full, findings });
  return r.status === "approved" ? { ...r, detail: `the amendment was rejected ${n} times; the plan author rewrote ${mid}: ${r.detail}` } : r;
}

/** The plan unit each task of `sk` runs on (design §3.3.1): its milestone when that is one branch, else the task. */
const unitOf = (sk: Skeleton) => (t: Task): string => sk.milestones.find((m) => m.tasks.some((x) => x.id === t.id) && m.branch === "milestone")?.id ?? t.id;
/** `: <why>` for an overseer that could not start (its members at their caps or without a free slot), else nothing. */
const because = (why: string | undefined): string => (why ? `: ${why}` : "");
const nTasks = (sk: Skeleton): number => sk.milestones.reduce((n, m) => n + m.tasks.length, 0);
/** The `plan` line; best effort, it never fails a flow. */
function logPlan(p: PlanPorts, i: PlanLogInput): void {
  try { p.log?.(i); } catch { /* the line is best effort */ }
}

type AmendCtx = { rec: PlanRecord; slug: string; request: string; trigger: string };
/** Step 4: the amended plan rendered (the ticks of unchanged tasks kept) and committed on main through the merge's fast-forward
 *  path (D50), recorded, its trigger closed, and the live branches of its units given their new goal, check and whitelist. */
async function commitAmended(p: PlanPorts, c: AmendCtx, final: Skeleton, by: string, more: Partial<AmendResult>): Promise<AmendResult> {
  const git = p.git, repo = c.rec.repo, file = c.rec.file;
  const now = await mainOf(git, p.settings, repo);
  if (!now) return amendDone("error", "git", `git failed: the main branch of ${repo} is gone`, more);
  const text = await git.show(repo, now.sha, file), cur = text === undefined ? undefined : parsePlan(text);
  if (!cur || skeletonHash(cur.sk) !== c.rec.skeletonHash) {
    return amendDone("refused", "plan-changed", `the plan file ${file} on ${now.name} does not hold the approved skeleton`, more);
  }
  const made = await git.commitFile(repo, now.sha, file, renderPlan({ slug: c.slug, request: c.request }, final, kept(cur, final)), `plan(${c.slug}): amended ${by}`);
  if (!made.ok) return amendDone("error", "git", `git failed: ${made.err}`, { ...more, reviewId: by });
  const adv = await advanceMain(p, repo, now, made.out);
  if (!adv.ok) {
    return adv.reason === "main-dirty" ? amendDone("refused", "main-dirty", reasonText("main-dirty", { checkout: adv.checkout }), { ...more, reviewId: by })
      : amendDone("error", "git", `git failed: ${adv.err}`, { ...more, reviewId: by });
  }
  const rec = p.plans.get(c.slug)!, answered = rec.triggers.find((t) => t.id === c.trigger), kind = answered?.kind;
  p.plans.put({ ...rec, skeletonHash: skeletonHash(final), approvedBy: by });
  p.plans.close(c.slug, c.trigger);
  logPlan(p, { slug: c.slug, action: "amend", ...(kind && { trigger: kind }), nTasks: nTasks(final), reviewId: by, ...(more.full !== undefined && { full: more.full }) });
  const notes: string[] = [];
  for (const b of p.branches.all()) {
    if (b.plan?.slug !== c.slug || !["active", "fixer", "blocked"].includes(b.state)) continue;
    const id = b.plan.id, u = unitFacts(final, id);
    // review L7 F2: a blocked branch whose unit the amendment removed is abandoned; one whose unit it changed, or whose
    // remediation-failed trigger it answers, starts over (counts at 0), so start_branch resumes it (its name follows from the id)
    if (b.state === "blocked" && !u) {
      p.branches.update({ ...b, state: "abandoned" });
      notes.push(`${b.branch} is abandoned: the plan has no ${id} now`);
    } else if (b.state === "blocked" && (unitChanged(cur.sk, final, id) || (kind === "remediation-failed" && answered?.task === id))) {
      const { fixer: _none, ...rest } = b;
      p.branches.update({ ...rest, ...u, state: "active", rejections: 0, fixerRuns: 0 }); // not made active (review F8)
      notes.push(`${b.branch} is unblocked (its counts reset): resume it with start_branch {"plan": {"slug": "${c.slug}", "id": "${id}"}}`);
    } else if (u && canonical({ goal: b.goal, check: b.check, files: b.files }) !== canonical(u)) p.branches.update({ ...b, ...u }); // not made active (review F8)
  }
  return amendDone("approved", undefined, [`plan amended: ${file} at ${made.out.slice(0, 7)}${adv.push}; trigger ${c.trigger} is closed`, ...notes].join("; "),
    { ...more, reviewId: by, commit: made.out });
}

const same = (a: Task | undefined, b: Task | undefined): boolean => !!a && !!b && canonical(bareTask(a)) === canonical(bareTask(b));
/** The tasks of the unit `id` (a task, or a milestone's tasks) differ between `old` and `sk` (vacuous marks aside). */
const unitChanged = (old: Skeleton, sk: Skeleton, id: string): boolean => canonical(unitTasks(old, id)) !== canonical(unitTasks(sk, id));
const unitTasks = (sk: Skeleton, id: string): Task[] => {
  const m = sk.milestones.find((x) => x.id === id || x.tasks.some((t) => t.id === id));
  return (!m ? [] : m.id === id ? m.tasks : m.tasks.filter((t) => t.id === id)).map(bareTask);
};
/** The tasks of `sk` that are new or differ from `old` (vacuous marks aside). */
const changedTasks = (old: Skeleton, sk: Skeleton): Task[] => sk.milestones.flatMap((m) => m.tasks).filter((t) => !same(taskOf(old, t.id), t));
/** The ticks of `cur` whose task `sk` keeps as it is. */
const kept = (cur: { sk: Skeleton; ticks: ReadonlySet<string> }, sk: Skeleton): Set<string> =>
  new Set([...cur.ticks].filter((id) => same(taskOf(cur.sk, id), taskOf(sk, id))));
/** `vacuous` marked; a task `old` has unchanged keeps its mark; every other task bare. */
const marked = (old: Skeleton | undefined, sk: Skeleton, vacuous: ReadonlySet<string>): Skeleton => ({ ...sk, milestones: sk.milestones.map((m) => ({ ...m,
  tasks: m.tasks.map((t) => {
    const was = old && taskOf(old, t.id), b = bareTask(t);
    return vacuous.has(t.id) || (same(was, t) && was!.vacuousCheck) ? { ...b, vacuousCheck: true as const } : b;
  }) })) });
const checkedReasons = (old: Skeleton, sk: Skeleton, checked: ReadonlySet<string>): string[] =>
  [...checked].filter((id) => !same(taskOf(old, id), taskOf(sk, id))).map((id) => `${id} is checked (ticked or merged); it cannot change`);
/** The amended skeleton's own findings (design §3.2.4): those the approved one does not have against the same checkout (a task's
 *  `create` that a merged branch made, say). */
function ownReasons(s: RouterSettings, fs: PlanFs, old: Skeleton, sk: Skeleton): string[] {
  const before = validateSkeleton(bare(old), s, fs), known = new Set(before.ok ? [] : before.reasons), v = validateSkeleton(bare(sk), s, fs);
  return v.ok ? [] : v.reasons.filter((r) => !known.has(r));
}
/** An amendment the plan author writes (design §3.5.4 step 5): the approved plan, its checked tasks, the milestone to rewrite. */
type Rewrite = { old: Skeleton; checked: ReadonlySet<string>; milestone: string };
function validateRewrite(x: unknown, s: RouterSettings, fs: PlanFs, rw: Rewrite): { ok: true; value: Skeleton } | { ok: false; reasons: string[] } {
  const schema = schemaCheck(SKELETON_SCHEMA, x);
  if (schema.length) return { ok: false, reasons: schema };
  const sk = x as Skeleton, only = `rewrite only ${rw.milestone}`, reasons: string[] = [];
  const bareM = (m: Skeleton["milestones"][number]) => canonical({ ...m, tasks: m.tasks.map(bareTask) });
  if (canonical(sk.invariants) !== canonical(rw.old.invariants)) reasons.push(`invariants changed; ${only}`);
  for (const m of rw.old.milestones) {
    const now = sk.milestones.find((y) => y.id === m.id);
    if (m.id !== rw.milestone && (!now || bareM(now) !== bareM(m))) reasons.push(`${m.id} changed; ${only}`);
  }
  for (const m of sk.milestones) if (m.id !== rw.milestone && !rw.old.milestones.some((y) => y.id === m.id)) reasons.push(`${m.id} added; ${only}`);
  reasons.push(...checkedReasons(rw.old, sk, rw.checked), ...ownReasons(s, fs, rw.old, sk));
  return reasons.length ? { ok: false, reasons } : { ok: true, value: sk };
}
const oneLine = (t: string): string => t.replace(/\s+/g, " ").trim();
/** A task as a review input shows it: one line of canonical JSON. */
const taskLine = (t: Task): string => JSON.stringify(JSON.parse(canonical(bareTask(t))));
const section = (title: string, xs: readonly string[]): string[] => (xs.length ? [`${title}:`, ...xs] : [`${title}: none`]);
const triggerLine = (t: Trigger): string => `Trigger: ${t.id} ${t.kind}${t.task ? ` (task ${t.task})` : ""}`;
const requestOf = (text: string): string => text.split("\n").find((l) => l.startsWith("Request: "))?.slice("Request: ".length) ?? "";
