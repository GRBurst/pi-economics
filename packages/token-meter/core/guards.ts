// Guard and kill switch of the experiments package (spec §5.6.3). Pure; reads the task-router outcome log as plain events.
import type { ArmStat } from "./arms.ts";

export type Guard = { accepted: number; judged: number };

/** Verdict acceptance per arm: the arm is the one logged on the task's spawn event; the last verdict of a task counts, `unjudged` does not. */
export function acceptance(events: any[]): Record<string, Guard> {
  const armOf = new Map<string, string>();
  const last = new Map<string, string>();
  for (const e of events) {
    if (e?.event === "spawn" && typeof e.taskId === "string" && typeof e.arm === "string") armOf.set(e.taskId, e.arm);
    if (e?.event === "verdict" && typeof e.taskId === "string") last.set(e.taskId, e.verdict);
  }
  const out: Record<string, Guard> = {};
  for (const [task, v] of last) {
    const arm = armOf.get(task);
    if (arm === undefined || !["accepted", "partial", "rejected"].includes(v)) continue;
    const g = (out[arm] ??= { accepted: 0, judged: 0 });
    g.judged += 1;
    if (v === "accepted") g.accepted += 1;
  }
  return out;
}

const pct = (g: Guard) => `${Math.round((100 * g.accepted) / g.judged)}% (${g.accepted}/${g.judged})`;

/** Per arm, from <agentDir>/guards/events.jsonl: peeks after masking and corrections counted, the last rating of each session. */
export type Signal = { peeks: number; corrections: number; ratings: number[] };

export function signals(events: any[]): Record<string, Signal> {
  const out: Record<string, Signal> = {};
  const rated = new Map<string, Map<string, number>>(); // arm → session → last rating
  for (const e of events) {
    if (typeof e?.arm !== "string" || !e.arm) continue;
    const s = (out[e.arm] ??= { peeks: 0, corrections: 0, ratings: [] });
    if (e.event === "peek-after-mask") s.peeks += 1;
    else if (e.event === "correction") s.corrections += 1;
    else if (e.event === "rating" && typeof e.sessionId === "string" && Number.isInteger(e.value) && e.value >= 1 && e.value <= 5) {
      if (!rated.has(e.arm)) rated.set(e.arm, new Map());
      rated.get(e.arm)!.set(e.sessionId, e.value);
    }
  }
  for (const [arm, m] of rated) out[arm].ratings = [...m.values()];
  return out;
}

export type Limits = { minSessions: number; threshold: number; peekThreshold?: number; correctionThreshold?: number; ratingThreshold?: number };

const mean = (xs: number[]): number | undefined => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/**
 * arm → reason, for every arm (baseline excluded) with ≥ minSessions units that is worse than the baseline by more than a threshold:
 * verdict acceptance (fraction), peeks after masking and corrections (per unit), mean rating (points; needs ratings on both sides).
 * Peeks and corrections count 0 for an arm without events: no log, no signal.
 */
export function killSwitch(stats: ArmStat[], acc: Record<string, Guard>, limits: Limits, baseline: string, sig: Record<string, Signal> = {}): Record<string, string> {
  const base = acc[baseline];
  const baseUnits = stats.find((s) => s.arm === baseline)?.units;
  const out: Record<string, string> = {};
  for (const s of stats) {
    if (s.arm === baseline || s.units < limits.minSessions) continue;
    const why: string[] = [];
    const g = acc[s.arm];
    if (base?.judged && g?.judged && base.accepted / base.judged - g.accepted / g.judged > limits.threshold + 1e-9)
      why.push(`acceptance ${pct(g)} vs baseline ${pct(base)}, worse by more than ${Math.round(limits.threshold * 100)} points`);
    if (baseUnits) {
      for (const [label, key, max] of [["peeks after masking", "peeks", limits.peekThreshold], ["corrections", "corrections", limits.correctionThreshold]] as const) {
        const [a, b] = [(sig[s.arm]?.[key] ?? 0) / s.units, (sig[baseline]?.[key] ?? 0) / baseUnits];
        if (max !== undefined && a - b > max + 1e-9) why.push(`${label} ${a.toFixed(2)}/session vs baseline ${b.toFixed(2)}, more by more than ${max}`);
      }
    }
    const [ra, rb] = [mean(sig[s.arm]?.ratings ?? []), mean(sig[baseline]?.ratings ?? [])];
    if (ra !== undefined && rb !== undefined && limits.ratingThreshold !== undefined && rb - ra > limits.ratingThreshold + 1e-9)
      why.push(`rating ${ra.toFixed(1)} vs baseline ${rb.toFixed(1)}, lower by more than ${limits.ratingThreshold}`);
    if (why.length) out[s.arm] = `${why.join("; ")} after ${s.units} sessions`;
  }
  return out;
}
