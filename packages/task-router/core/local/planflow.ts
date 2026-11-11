// Local mode L7 (design §3.5.2, §3.5.4; plan D49–D53, LD10): the plan flow behind `plan_request` and `amend_plan`.
// L7.T6: `plan_request` step 1, the grounding check, refuses before any overseer runs (a main checkout that is dirty too, D51).
// L7.T7: steps 2–3, the plan author and the red runs of its task checks on the main tip, counted toward `plans.rounds` (D52).
// L7.T8: steps 4–5, the plan file committed on main through the merge's fast-forward path (LD10, D50), recorded, and the
// first startable unit.
// L7.T14: `amend_plan` steps 1–2, the trigger (an open one, or an interface-break with failing evidence) and the validation of
// the amended skeleton (its own findings only; checked tasks immutable).
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, posix, relative } from "node:path";
import type { Runner } from "../gate.ts";
import type { RouterSettings } from "../types.ts";
import type { BranchStore } from "./branches.ts";
import type { Git } from "./git.ts";
import { advanceMain, type OverseerPort, reasonText } from "./merge.ts";
import type { SubmitSpec } from "./overseer.ts";
import { canonical, parsePlan, type PlanFs, renderPlan, type Skeleton, SKELETON_SCHEMA, skeletonHash, type Task, validateSkeleton } from "./plan.ts";
import { findingLine, type Finding } from "./verdict.ts";
import { mergedUnits, type PlanStore } from "./plans.ts";
import { refreshFacts } from "./worktree.ts";

export type PlanPorts = {
  git: Git; run: Runner; overseer: OverseerPort; branches: BranchStore; plans: PlanStore; settings: RouterSettings;
  /** `pi.appendEntry` (design §3.0.2). */
  append(customType: string, data: unknown): void;
  /** A fresh path for a red run's temporary worktree (it must not exist). */
  tmp(): string;
  signal?: AbortSignal;
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
    submit: planSubmit(p, { repo, checkout, tip: main.sha }), signal: p.signal });
  if (!out.ok) {
    return out.outcome === "aborted" ? done("error", "aborted", "aborted") : done("error", "author-unavailable", `the plan author is unavailable (${out.outcome})`);
  }
  if (!out.value.ok) return done("error", out.value.reason, `${AUTHOR_FAILED[out.value.reason]}: ${out.value.reasons.join("; ")}`);
  // ── 4 render, commit on main (D50: plumbing, then the merge's fast-forward path), record ──
  const sk = out.value.sk, reviewId = out.reviewId;
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
const AUTHOR_FAILED: Record<"invalid" | "broken-check", string> = {
  invalid: "the plan author's skeleton is still invalid after plans.rounds",
  "broken-check": "task checks still cannot run after plans.rounds",
};
/** The author's input (design §3.2.1): the request digest, the acceptance, the grounding, the limits, the repository map. */
export function authorInput(s: RouterSettings, i: PlanInput, files: readonly string[], map: readonly string[]): string {
  const l = s.plans;
  return [`Request: ${i.request}`, "Acceptance:", ...i.acceptance.map((a) => `- ${a}`),
    `Grounding files: ${files.join(", ")}`, `Grounding symbols: ${(i.symbols ?? []).join(", ") || "none"}`,
    `Limits: a task changes at most ${l.taskFiles} files and about ${l.taskLines} lines; its files and create name at most ${l.splitFiles} paths; `
      + `a milestone has at most ${l.milestoneTasks} tasks and about ${l.milestoneLines} lines. Paths are relative to the repository root.`,
    "Every task check must fail on the main tip and pass once the task is done.",
    `Repository map (the first ${REPO_MAP} tracked paths):`, ...map].join("\n");
}

/** What `submit_plan` records: an accepted skeleton, or why the plan fails once `plans.rounds` are spent. */
export type Authored = { ok: true; sk: Skeleton } | { ok: false; reason: "invalid" | "broken-check"; reasons: string[] };
type RedExit = { task: Task; exit: number };
/** Exit 0: vacuous; 126/127: broken (design §3.5.2 step 3). */
const failsRed = (exit: number): boolean => exit === 0 || exit === 126 || exit === 127;
const redFinding = (r: RedExit, i: number, tip: string): Finding => ({
  id: `F${i + 1}`, category: "check", target: r.task.id, blocking: true,
  defect: r.exit === 0 ? "the check passes on the main tip, before the task is done" : `the check cannot run (exit ${r.exit})`,
  evidence: `\`${r.task.check}\` exit ${r.exit} on ${tip.slice(0, 7)}`,
  fix: r.exit === 0 ? "the check fails on the main tip and passes once the task is done" : "the check command runs on the main tip and fails there",
});

/** Each task's check on `tip` in its own detached temporary worktree (removed afterwards); a worktree git cannot make skips it. */
async function redRuns(p: PlanPorts, repo: string, tip: string, sk: Skeleton): Promise<RedExit[]> {
  const out: RedExit[] = [];
  for (const task of sk.milestones.flatMap((m) => m.tasks)) {
    const dir = p.tmp();
    if (!(await p.git.worktreeAddDetached(repo, dir, tip)).ok) continue;
    try { out.push({ task, exit: (await p.run(task.check, dir, p.settings.checkTimeoutSec * 1000)).exit }); }
    finally { await p.git.worktreeRemove(repo, dir, true); }
  }
  return out;
}

/** `submit_plan` (design §3.5.2 steps 2–3): validation, then the red runs. Within `plans.rounds` a failure goes back to the author as
 *  a resubmit; afterwards the submission is final: still invalid or broken fails the plan (D52), still vacuous is accepted with
 *  `vacuousCheck` on those tasks (LD9). */
export function planSubmit(p: PlanPorts, x: { repo: string; checkout: string; tip: string }): SubmitSpec<Authored> {
  const rounds = p.settings.plans.rounds;
  let round = 0;
  return {
    name: "submit_plan", parameters: SKELETON_SCHEMA, resubmits: rounds,
    description: "Submit the plan skeleton: milestones of small tasks, each with its files and one check command that fails before the task "
      + "and passes after it. The router validates it and runs every check on the main tip; a finding comes back as a resubmit.",
    async check(input) {
      const last = ++round > rounds;
      const v = validateSkeleton(input, p.settings, checkoutFs(x.checkout));
      if (!v.ok) return last ? { ok: true, value: { ok: false, reason: "invalid", reasons: v.reasons } } : v;
      const bad = (await redRuns(p, x.repo, x.tip, v.value)).filter((r) => failsRed(r.exit));
      if (!bad.length) return { ok: true, value: { ok: true, sk: v.value } };
      const lines = bad.map((r, i) => findingLine(redFinding(r, i, x.tip)));
      if (!last) return { ok: false, reasons: lines };
      const broken = bad.filter((r) => r.exit !== 0);
      if (broken.length) return { ok: true, value: { ok: false, reason: "broken-check", reasons: broken.map((r) => `${r.task.id}: \`${r.task.check}\` exit ${r.exit}`) } };
      const vacuous = new Set(bad.map((r) => r.task.id));
      const sk: Skeleton = { ...v.value, milestones: v.value.milestones.map((m) => ({ ...m,
        tasks: m.tasks.map((t) => (vacuous.has(t.id) ? { ...t, vacuousCheck: true as const } : t)) })) };
      return { ok: true, value: { ok: true, sk } };
    },
  };
}

// ── amend_plan (design §3.5.4) ──
export type AmendChange = { op: "add" | "replace" | "remove"; id?: string; after?: string; task?: Task };
export type AmendInput = { slug: string; trigger: { id: string; kind?: "interface-break"; evidenceCommand?: string }; changes: AmendChange[];
  reason: string };
export const AMEND_REASONS = ["no-plan", "plan-changed", "trigger", "evidence", "checked", "invalid", "broken-check", "main-dirty",
  "review-unavailable", "aborted", "git"] as const;
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

async function amendment(p: PlanPorts, input: AmendInput, _cwd: string): Promise<AmendResult> {
  const s = p.settings, git = p.git, slug = input.slug;
  const refused = (reason: AmendReason, detail: string, more: Partial<AmendResult> = {}) => amendDone("refused", reason, detail, more);
  // ── the plan: its record and its file on the main tip, with the approved skeleton ──
  const rec = p.plans.get(slug);
  if (!rec) return refused("no-plan", `no approved plan ${slug}; plan_request makes one`);
  const repo = rec.repo;
  await refreshFacts({ git, store: p.branches, settings: s }, repo);
  const main = await mainOf(git, s, repo);
  if (!main) return amendDone("error", "git", `git failed: none of the main branches (${s.mergeGate.mainBranches.join(", ")}) exists in ${repo}`);
  const checkout = main.checkout ?? p.branches.facts.mainCheckout.get(repo) ?? repo;
  const text = await git.show(repo, main.sha, rec.file), parsed = text === undefined ? undefined : parsePlan(text);
  if (!parsed || skeletonHash(parsed.sk) !== rec.skeletonHash) {
    return refused("plan-changed", `the plan file ${rec.file} on ${main.name} does not hold the approved skeleton`);
  }
  const old = parsed.sk;
  // ── 1 trigger: an open one, or a new interface-break whose evidence command fails in the active worktree ──
  const t = input.trigger;
  let trigger: string;
  if (t.id === "new") {
    const cmd = t.evidenceCommand;
    if (t.kind !== "interface-break" || typeof cmd !== "string" || !cmd.trim()) return refused("trigger", "a new trigger needs kind interface-break and an evidenceCommand");
    const a = p.branches.active(), dir = a && a.repo === repo ? a.worktree : checkout;
    const r = await p.run(cmd, dir, s.checkTimeoutSec * 1000);
    if (r.exit === 0) return refused("evidence", `the evidence command \`${cmd}\` exits 0 in ${dir}; an interface-break needs a command that fails`);
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
  for (const x of old.milestones.flatMap((m) => m.tasks)) {
    if (!parsed.ticks.has(x.id) && !merged.has(x.id)) continue;
    const now = taskOf(applied.sk, x.id);
    if (!now || canonical(now) !== canonical(x)) return refused("checked", `${x.id} is checked (ticked or merged); it cannot change`, { trigger });
  }
  const fs = checkoutFs(checkout), before = validateSkeleton(bare(old), s, fs), known = new Set(before.ok ? [] : before.reasons);
  const v = validateSkeleton(bare(applied.sk), s, fs);
  const own = v.ok ? [] : v.reasons.filter((r) => !known.has(r));
  if (own.length) return refused("invalid", `the amended plan is invalid: ${own.join("; ")}`, { trigger });
  return amendDone("error", "review-unavailable", reasonText("review-unavailable", {}), { trigger });
}
