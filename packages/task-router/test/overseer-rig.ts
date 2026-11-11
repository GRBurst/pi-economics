// Shared rig for the overseer tests (plan S20): createOverseer against the harness with the fake API extension. Driven by a
// scripted poll: each `sleep` runs the next scripted child action.
import type { PolicyResult } from "../core/api.ts";
import { createOverseer, verdictSubmit, type Budget, type OverseerDeps, type RunArgs } from "../core/local/overseer.ts";
import type { Verdict } from "../core/local/verdict.ts";
import type { OverseerSettings } from "../core/types.ts";
import { harness } from "./harness.ts";

export type Ok = Exclude<PolicyResult, { reject: string }>;
export type Step = () => unknown;
export const OPUS = "anthropic/claude-opus-5-5";
export const VALID: Verdict = { verdict: "APPROVE", summary: "fine", findings: [] };
export const finding = (id: string) => ({ id, category: "correctness", target: "src/a.ts:1", defect: "d", evidence: "e", fix: "f", blocking: false });

export function rig(o: { overseer?: Partial<OverseerSettings>; budget?: Partial<Budget> } = {}) {
  const h = harness({ settings: { mode: "local", ...(o.overseer && { overseer: o.overseer }) } as never, apiExt: true });
  const script: Step[] = [];
  /** `each`: the child's action on a poll with no scripted step. */
  const on: { each?: Step } = {};
  const entries: Array<{ type: string; data: any }> = [];
  let k = 0, polls = 0;
  const d: OverseerDeps = {
    api: () => h.a.api, settings: h.router.settings, tickets: h.router.tickets, log: h.router.log,
    hex: (n) => (++k).toString(16).padStart(2 * n, "0"),
    now: () => h.clock.t,
    sleep: async (ms) => {
      if (++polls > 10_000) throw new Error("runaway poll loop");
      h.clock.t += ms;
      const step = script.shift();
      await (step ? step() : on.each?.());
    },
    budget: { opusUsed: 0, steerUsed: 0, ...o.budget },
    append: (type, data) => entries.push({ type, data }),
  };
  const ov = createOverseer(d);
  /** The submit tool of the i-th spawn (the last by default). */
  const tool = (i = -1) => (h.a.apiSpawns.at(i)!.policy as Ok).childTools![0]!;
  const run = (x: Partial<RunArgs<Verdict>> = {}) =>
    ov.run({ role: "merge", input: "review this", cwd: "/wt", submit: verdictSubmit(), ...x });
  /** The i-th spawn's (last by default) name, model and effort as the policy answered. */
  const spawned = (i = -1) => { const s = h.a.apiSpawns.at(i)!; const p = s.policy as Ok; return [s.args.name, p.model, p.thinkingLevel]; };
  return { h, d, ov, script, on, entries, tool, spawned, run };
}
