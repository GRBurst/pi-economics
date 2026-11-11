// Local mode L7 (design §3.5.2, §3.5.4; plan D49–D53, LD10): the plan flow behind `plan_request` and `amend_plan`.
// L7.T6: `plan_request` step 1, the grounding check, refuses before any overseer runs (a main checkout that is dirty too, D51).
// L7.T7: steps 2–3, the plan author and the red runs of its task checks on the main tip, counted toward `plans.rounds` (D52).
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, posix, relative } from "node:path";
import type { Runner } from "../gate.ts";
import type { RouterSettings } from "../types.ts";
import type { BranchStore } from "./branches.ts";
import type { Git } from "./git.ts";
import { type OverseerPort, reasonText } from "./merge.ts";
import type { SubmitSpec } from "./overseer.ts";
import { type PlanFs, type Skeleton, SKELETON_SCHEMA, type Task, validateSkeleton } from "./plan.ts";
import { findingLine, type Finding } from "./verdict.ts";
import type { PlanStore } from "./plans.ts";
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
  return { ...done("approved", undefined, "the skeleton is accepted"), reviewId: out.reviewId };
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
