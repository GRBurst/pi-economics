// (d) guards: signals per arm and the kill switch.
import { acceptance, killSwitch, signals, type Guard, type Limits, type Signal } from "../guards.ts";
import { type ArmStat } from "../arms.ts";
import { designOfLine } from "./designs.ts";
import { type DesignResult, type Objective } from "./experiment.ts";

/** One design of one stratum of the v2 engine (M5c, T5c.9): its arms' stats, guard signals and the arms its kill switch disables. */
export type StratumGuard = { design: string; stratum: string; objective: Objective; baseline: string; arms: ArmStat[]; kill: Record<string, string>; acc: Record<string, Guard>; sig: Record<string, Signal> };
/** `kill` = the v1–v4 designs' kill switch (flat arm → reason, state.json `disabled`); the v2 engine's is `perStratum`. */
export type GuardsSection = { limits: Limits; baselines: Record<string, string>; kill: Record<string, string>; perStratum: StratumGuard[];
  perArm: Array<{ design: string; arm: string; units: number; peeks: number; corrections: number; ratings: number[]; accepted: number; judged: number }> };

export function guards(designs: DesignResult[], outcomes: any[], events: any[], expSettings: any, rows: Map<string, any>): GuardsSection {
  const g = expSettings?.guards ?? {};
  // Own defaults for experiments' `guards` (a package cannot import another's settings).
  const limits: Limits = { minSessions: g.minSessions ?? 10, threshold: g.threshold ?? 0.2, peekThreshold: g.peekThreshold ?? 1, correctionThreshold: g.correctionThreshold ?? 1, ratingThreshold: g.ratingThreshold ?? 0.5 };
  // v2 and v3 share arm ids: every event and verdict goes to the design of its session (spawn events: the parent's) before it is keyed by arm.
  const designOfEvent = (e: any): string => designOfLine(e, rows.get(e?.sessionId) ?? rows.get(e?.parentSessionId));
  const spawnDesign = new Map(outcomes.filter((e) => e?.event === "spawn" && typeof e.taskId === "string").map((e) => [e.taskId as string, designOfEvent({ ...e, sessionId: undefined })]));
  const per = designs.map((d) => {
    const sig = signals(events.filter((e) => designOfEvent(e) === d.design));
    const acc = acceptance(outcomes.filter((e) => (e?.event === "spawn" ? spawnDesign.get(e.taskId) : spawnDesign.get(e?.taskId)) === d.design));
    return { d, sig, acc };
  });
  const stratumOfEvent = (e: any): unknown => (rows.get(e?.sessionId) ?? rows.get(e?.parentSessionId))?.stratum;
  const spawnStratum = new Map(outcomes.filter((e) => e?.event === "spawn" && typeof e.taskId === "string").map((e) => [e.taskId as string, e.stratum ?? stratumOfEvent({ ...e, sessionId: undefined })]));
  const perStratum = per.flatMap(({ d }) => d.strata.flatMap((st) => {
    if (!st.arms) return [];
    const sig = signals(events.filter((e) => designOfEvent(e) === d.design && stratumOfEvent(e) === st.stratum));
    const acc = acceptance(outcomes.filter((e) => spawnDesign.get(e?.taskId) === d.design && spawnStratum.get(e?.taskId) === st.stratum));
    return [{ design: d.design, stratum: st.stratum, objective: st.objective, baseline: d.baseline, arms: st.arms, kill: killSwitch(st.arms, acc, limits, d.baseline, sig), acc, sig }];
  }));
  const v2 = new Set(perStratum.map((s) => s.design));
  return {
    limits,
    perStratum,
    baselines: Object.fromEntries(designs.map((d) => [d.design, d.baseline])),
    kill: Object.assign({}, ...per.filter(({ d }) => !v2.has(d.design)).map(({ d, sig, acc }) => killSwitch(d.arms, acc, limits, d.baseline, sig))),
    perArm: per.flatMap(({ d, sig, acc }) => d.arms.map((s) => ({ design: d.design, arm: s.arm, units: s.units, peeks: sig[s.arm]?.peeks ?? 0, corrections: sig[s.arm]?.corrections ?? 0, ratings: sig[s.arm]?.ratings ?? [], accepted: acc[s.arm]?.accepted ?? 0, judged: acc[s.arm]?.judged ?? 0 }))),
  };
}
