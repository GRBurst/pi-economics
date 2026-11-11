// Shared rigs for the merge pipeline tests (L6.T6–T12; plan S26): a temporary repository with real git (D56), the branch
// store, the real check runner and either a counting overseer whose verdicts are scripted (`mergeRig`) or the shell's own
// overseer against the fake actor API, whose children submit scripted verdicts (`reviewRig`).
import { join } from "node:path";
import { createBranchStore } from "../core/local/branches.ts";
import type { BranchRecord, BranchStore } from "../core/local/branches.ts";
import { createGit, gitRunner } from "../core/local/git.ts";
import type { Git } from "../core/local/git.ts";
import { createApprovals, requestMerge } from "../core/local/merge.ts";
import type { MergePorts } from "../core/local/merge.ts";
import type { RunArgs, RunResult } from "../core/local/overseer.ts";
import type { AgentInfo } from "../core/api.ts";
import type { Finding, Verdict } from "../core/local/verdict.ts";
import { startBranch } from "../core/local/worktree.ts";
import { runCheck } from "../core/gate.ts";
import type { Runner } from "../core/gate.ts";
import { parseSettings } from "../core/settings.ts";
import type { RouterSettings } from "../core/types.ts";
import { tempRepo } from "./git-repo.ts";
import type { TempRepo } from "./git-repo.ts";
import { harness } from "./harness.ts";
import type { Ok } from "./overseer-rig.ts";

export const APPROVE: Verdict = { verdict: "APPROVE", summary: "fine", findings: [] };
export const finding = (id: string, blocking = true, target = "x.ts:1"): Finding =>
  ({ id, category: "correctness", target, defect: `defect ${id}`, evidence: `evidence ${id}`, fix: `fix ${id}`, blocking });
export const REVISE: Verdict = { verdict: "REVISE", summary: "no", findings: [finding("F1")] };

type Rest = Omit<MergePorts, "git" | "run" | "branches" | "settings" | "tmp">;
/** The parts both rigs share: the check runner that records, the temporary directories, start_branch and request_merge. */
function common(r: TempRepo, git: Git, store: BranchStore, settings: RouterSettings, rest: Rest) {
  let tmps = 0;
  /** Every check the pipeline ran, in order. */
  const runs: Array<{ cmd: string; cwd: string }> = [];
  const run: Runner = (cmd, cwd, ms) => { runs.push({ cmd, cwd }); return runCheck(cmd, cwd, ms); };
  const ports: MergePorts = { git, run, branches: store, settings, tmp: () => join(r.base, `red-${++tmps}`), ...rest };
  /** start_branch for `slug`; the record. */
  const start = async (slug = "x", check = "true", goal = "add x"): Promise<BranchRecord> => {
    const res = await startBranch({ git, store, settings }, { slug, goal, check }, r.dir);
    if (!res.ok) throw new Error(res.errors.join("; "));
    return store.get(r.dir, res.value.branch)!;
  };
  const merge = (input: { branch?: string; summary?: string } = {}, cwd = r.dir) => requestMerge(ports, input, cwd);
  const mainSha = (): string => r.git(["rev-parse", "main"]);
  return { ports, runs, start, merge, mainSha };
}

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
  /** `review`: runs inside each review (a test changes the worktree meanwhile). */
  const hooks: { review?: (a: RunArgs<unknown>) => void } = {};
  const overseer = {
    ready: () => true,
    async run<T>(a: RunArgs<T>): Promise<RunResult<T>> {
      reviews.push(a as RunArgs<unknown>);
      hooks.review?.(a as RunArgs<unknown>);
      const v = verdicts.shift() ?? APPROVE;
      return v === "fail" ? { ok: false, outcome: "error" } : { ok: true, value: v as T, reviewId: `rv-${reviews.length}`, member: "opus", model: "anthropic/claude-opus-5-5" };
    },
  };
  const approvals = createApprovals(append);
  const c = common(r, git, store, settings, { overseer, approvals, append });
  return { r, git, store, entries, settings, verdicts, reviews, hooks, overseer, approvals, ...c };
}
export type MergeRig = ReturnType<typeof mergeRig>;

/** The shell (harness, fake actor API with the spawn extension) on a temporary repository, after session_start with the
 *  session's cwd = the main checkout. A child submits the next scripted verdict (default: approve) at its first poll. `repo`
 *  and `entries`: a second session on the same repository, rebuilt from the first one's entries. */
export function reviewRig(o: { settings?: Record<string, unknown>; repo?: TempRepo; entries?: Array<{ type: string; data: unknown }>;
  /** More of the session's ctx (a model registry for a settings force). */ ctx?: Record<string, unknown>;
  /** false: the actor without the spawn API (design §3.0.4). */ apiExt?: boolean;
  /** Agents the actor lists before session_start (restored from its roster). */ agents?: AgentInfo[];
  /** The session_start event (its `reason`). */ event?: Record<string, unknown> } = {}) {
  const r = o.repo ?? tempRepo();
  const git = createGit(gitRunner("git", r.env));
  const h = harness({ settings: { mode: "local", ...o.settings } as never, apiExt: o.apiExt ?? true, extra: { git } });
  h.f.entries.push(...(o.entries ?? []));
  h.a.agents.push(...(o.agents ?? []));
  const ctx = { ...o.ctx, cwd: r.dir, sessionManager: { getSessionId: () => "s-main", getBranch: () => h.f.entries.map((e) => ({ type: "custom", customType: e.type, data: e.data })) } };
  h.f.fire("session_start", o.event ?? {}, ctx);
  const verdicts: Verdict[] = [];
  let answered = 0;
  h.hooks.onSleep = () => {
    if (h.a.apiSpawns.length <= answered) return;
    const s = h.a.apiSpawns[answered++]!;
    const submit = (s.policy as Ok | undefined)?.childTools?.[0]; // a fixer has no submit tool
    if (s.result.ok && submit) void submit.execute(verdicts.shift() ?? APPROVE);
  };
  const append = (type: string, data: unknown): void => { h.f.entries.push({ type, data }); };
  const c = common(r, git, h.router.branches, h.router.settings, { overseer: h.router.overseer, approvals: h.router.approvals, append, fixer: h.router.fixer });
  return { r, git, h, ctx, verdicts, ...c };
}
export type ReviewRig = ReturnType<typeof reviewRig>;
