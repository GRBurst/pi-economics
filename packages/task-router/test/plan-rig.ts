// A rig for the plan flow tests (L7.T6–T15; design §3.5): a temporary repository with real git (D56) holding a few source
// files, the branch and plan stores, the main-ref entries, the real check runner, and a counting overseer that feeds each
// run's scripted submissions to the run's submit check in turn (as the overseer's child would resubmit).
import { join } from "node:path";
import { createBranchStore } from "../core/local/branches.ts";
import { createGit, gitRunner } from "../core/local/git.ts";
import { createMainRefs } from "../core/local/merge.ts";
import type { RunArgs, RunResult } from "../core/local/overseer.ts";
import { createPlanStore } from "../core/local/plans.ts";
import { type PlanPorts } from "../core/local/planflow.ts";
import type { PlanLogInput } from "../core/outcome.ts";
import { runCheck, type Runner } from "../core/gate.ts";
import { parseSettings } from "../core/settings.ts";
import { tempRepo } from "./git-repo.ts";

export function planRig(o: { settings?: Record<string, unknown> } = {}) {
  const r = tempRepo();
  r.commit("src/a.ts", "export function parse(s: string) { return s; }\n");
  r.commit("src/b.ts", "export const wire = 1;\n");
  r.commit("test/a.test.ts", "import { parse } from '../src/a.ts';\n");
  r.commit("docs/plans/.keep", "");
  const git = createGit(gitRunner("git", r.env));
  const entries: Array<{ type: string; data: any }> = [];
  const refs = createMainRefs(() => undefined);
  const append = (type: string, data: unknown): void => { entries.push({ type, data: structuredClone(data) }); refs.observe(type, data); };
  /** The `plan` lines (design §3.0.3) the flows and the store logged, in order. */
  const logs: PlanLogInput[] = [];
  const log = (i: PlanLogInput): void => void logs.push(i);
  const branches = createBranchStore(append), plans = createPlanStore(append, log);
  const settings = parseSettings({ mode: "local", ...o.settings }).settings;
  /** Per overseer run: the submissions its child makes, in order (a run without any ends `invalid`; "fail": it cannot run). */
  const script: Array<unknown[] | "fail"> = [];
  const runs: RunArgs<unknown>[] = [];
  /** Every answer of a submit check, in order. */
  const replies: Array<{ ok: boolean; reasons?: string[]; value?: unknown }> = [];
  const overseer = {
    ready: () => true,
    async run<T>(a: RunArgs<T>): Promise<RunResult<T>> {
      runs.push(a as RunArgs<unknown>);
      const subs = script.shift() ?? [];
      if (subs === "fail") return { ok: false, outcome: "error" };
      let invalid = 0;
      for (const x of subs) {
        const c = await a.submit.check(x);
        replies.push(c);
        if (c.ok) return { ok: true, value: c.value, reviewId: `rv-${runs.length}`, member: "opus", model: "anthropic/claude-opus-5-5" };
        if (++invalid > (a.submit.resubmits ?? settings.overseer.resubmits)) break;
      }
      return { ok: false, outcome: "invalid" };
    },
  };
  let tmps = 0;
  const checks: Array<{ cmd: string; cwd: string }> = [];
  const run: Runner = (cmd, cwd, ms) => { checks.push({ cmd, cwd }); return runCheck(cmd, cwd, ms); };
  const ports: PlanPorts = { git, run, overseer, branches, plans, settings, append, tmp: () => join(r.base, `red-${++tmps}`), log };
  const mainSha = (): string => r.git(["rev-parse", "main"]);
  return { r, git, entries, logs, refs, branches, plans, settings, script, runs, replies, overseer, checks, ports, mainSha };
}
export type PlanRig = ReturnType<typeof planRig>;
