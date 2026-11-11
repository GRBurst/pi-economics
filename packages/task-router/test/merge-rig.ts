// Shared rig for the merge pipeline tests (L6.T6–T12; plan S26): a temporary repository with real git (D56), the branch
// store, the real check runner and a counting overseer whose verdicts are scripted.
import { join } from "node:path";
import { createBranchStore } from "../core/local/branches.ts";
import type { BranchRecord } from "../core/local/branches.ts";
import { createGit, gitRunner } from "../core/local/git.ts";
import { requestMerge } from "../core/local/merge.ts";
import type { MergePorts } from "../core/local/merge.ts";
import type { RunArgs, RunResult } from "../core/local/overseer.ts";
import type { Finding, Verdict } from "../core/local/verdict.ts";
import { startBranch } from "../core/local/worktree.ts";
import { runCheck } from "../core/gate.ts";
import type { Runner } from "../core/gate.ts";
import { parseSettings } from "../core/settings.ts";
import { tempRepo } from "./git-repo.ts";

export const APPROVE: Verdict = { verdict: "APPROVE", summary: "fine", findings: [] };
export const finding = (id: string, blocking = true, target = "x.ts:1"): Finding =>
  ({ id, category: "correctness", target, defect: `defect ${id}`, evidence: `evidence ${id}`, fix: `fix ${id}`, blocking });
export const REVISE: Verdict = { verdict: "REVISE", summary: "no", findings: [finding("F1")] };

export function mergeRig(o: { settings?: Record<string, unknown> } = {}) {
  const r = tempRepo();
  const git = createGit(gitRunner("git", r.env));
  const entries: Array<{ type: string; data: any }> = [];
  const append = (type: string, data: unknown): void => { entries.push({ type, data: structuredClone(data) }); };
  const store = createBranchStore(append);
  const settings = parseSettings({ mode: "local", ...o.settings }).settings;
  /** What the overseer answers, in order (default: approve); "fail" = an overseer that could not run. */
  const verdicts: Array<Verdict | "fail"> = [];
  const reviews: RunArgs<unknown>[] = [];
  const overseer = {
    ready: () => true,
    async run<T>(a: RunArgs<T>): Promise<RunResult<T>> {
      reviews.push(a as RunArgs<unknown>);
      const v = verdicts.shift() ?? APPROVE;
      return v === "fail" ? { ok: false, outcome: "error" } : { ok: true, value: v as T, reviewId: `rv-${reviews.length}`, member: "opus", model: "anthropic/claude-opus-5-5" };
    },
  };
  let tmps = 0;
  /** Every check the pipeline ran, in order. */
  const runs: Array<{ cmd: string; cwd: string }> = [];
  const run: Runner = (cmd, cwd, ms) => { runs.push({ cmd, cwd }); return runCheck(cmd, cwd, ms); };
  const ports: MergePorts = { git, run, overseer, branches: store, settings, append, tmp: () => join(r.base, `red-${++tmps}`) };
  /** start_branch for `slug`; the record. */
  const start = async (slug = "x", check = "true", goal = "add x"): Promise<BranchRecord> => {
    const res = await startBranch({ git, store, settings }, { slug, goal, check }, r.dir);
    if (!res.ok) throw new Error(res.errors.join("; "));
    return store.get(r.dir, res.value.branch)!;
  };
  const merge = (input: { branch?: string; summary?: string } = {}, cwd = r.dir) => requestMerge(ports, input, cwd);
  const mainSha = (): string => r.git(["rev-parse", "main"]);
  return { r, git, store, entries, settings, verdicts, reviews, overseer, ports, runs, start, merge, mainSha };
}
export type MergeRig = ReturnType<typeof mergeRig>;
