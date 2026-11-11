// Local mode L7 (design §3.5.2, §3.5.4; plan D49–D53, LD10): the plan flow behind `plan_request` and `amend_plan`.
// L7.T6: `plan_request` step 1, the grounding check, refuses before any overseer runs (a main checkout that is dirty too, D51).
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, posix, relative } from "node:path";
import type { Runner } from "../gate.ts";
import type { RouterSettings } from "../types.ts";
import type { BranchStore } from "./branches.ts";
import type { Git } from "./git.ts";
import { type OverseerPort, reasonText } from "./merge.ts";
import type { PlanFs } from "./plan.ts";
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
  return done("error", "author-unavailable", "the plan author is not wired yet");
}
