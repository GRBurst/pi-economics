// The add-on registry (redesign §7.4): which levers the engine can set, and the read-back that turns an assigned
// level, its feasibility and an observation into one lever state (§5.3). Pure; the shell drives it.
import type { Level, LeverId } from "../core/design.ts";
import type { Lever, LeverState, Observed, SessionCtx, TargetEnv } from "./types.ts";

/** The target's own source: an observation never says pi-economics decided what it did not assign (or what was refused). */
const own = (o: { v: Level; s: LeverState["s"] }): LeverState => ({ v: o.v, s: o.s === "pe" ? "ext" : o.s });

/**
 * The state of a lever assigned `a` (undefined: not assigned), whose add-on could set `feasible` (undefined: every
 * level), as `obs` shows it ("no-observer": the add-on has none; undefined: nothing observed yet). undefined = not
 * recorded. A refusal keeps the observed source (§7.4); an infeasible level the target happens to run anyway is the
 * target's own value, not pi-economics' (refused needs v ≠ a), and one never observed is not recorded.
 */
export function readBack(a: Level | undefined, feasible: readonly Level[] | undefined, obs: Observed | "no-observer"): LeverState | undefined {
  const seen = obs === "no-observer" ? undefined : obs;
  if (a === undefined) return seen === undefined ? undefined : own(seen);
  if (feasible !== undefined && !feasible.includes(a)) {
    if (seen === undefined) return undefined;
    return seen.v === a ? own(seen) : { ...own(seen), a, rb: "refused" };
  }
  if (seen === undefined) return { v: a, s: "pe", a, rb: "unverified" };
  if (seen.v === a) return { v: a, s: "pe", a, rb: "confirmed" };
  return { ...own(seen), a, rb: "refused" };
}

/** The levers the engine can set; a target's levers are live once it is loaded in this runtime ("pi" always is). */
export type Registry = { lever(id: LeverId): Lever | undefined; loaded(target: string): boolean; load(target: string): boolean };

export function createRegistry(levers: readonly Lever[]): Registry {
  const byId = new Map(levers.map((l) => [l.id, l]));
  const live = new Set(["pi"]);
  return {
    lever: (id) => byId.get(id),
    loaded: (target) => live.has(target),
    /** true when the target was not loaded before. */
    load: (target) => !live.has(target) && live.add(target) !== undefined,
  };
}

type Track = { lever: Lever; a: Level; feasible: readonly Level[]; obs: Observed };

/**
 * One session's levers: each factor of its assignment whose add-on is registered and whose target is loaded starts once
 * (feasibility, then `apply` when feasible); an observer's last defined observation stands until a new one differs.
 * `levelsOf(name)` = the design's levels of a factor.
 */
export function sessionLevers(
  registry: Registry,
  assigned: { sessionId: string; factors?: Record<string, { lever: LeverId; assigned: Level }> },
  env: TargetEnv,
  levelsOf: (factor: string) => readonly Level[],
) {
  const tracks = new Map<LeverId, Track>();
  const ctx: SessionCtx = { sessionId: assigned.sessionId };
  const stateOf = (t: Track): LeverState | undefined => {
    const st = readBack(t.a, t.feasible, t.lever.observe ? t.obs : "no-observer");
    return st?.a === undefined ? st : { ...st, tier: t.lever.tier };
  };
  return {
    /** Starts every live lever not started yet; true when one started. */
    refresh(): boolean {
      let started = false;
      for (const [name, f] of Object.entries(assigned.factors ?? {})) {
        const lever = registry.lever(f.lever);
        if (lever === undefined || tracks.has(lever.id) || !registry.loaded(lever.target)) continue;
        const feasible = lever.feasible(env, levelsOf(name));
        tracks.set(lever.id, { lever, a: f.assigned, feasible, obs: undefined });
        if (feasible.includes(f.assigned)) lever.apply(ctx, f.assigned);
        started = true;
      }
      return started;
    },
    /** Reads back the started levers observed at `at`; true when a state changed. */
    observe(at: Lever["readBackAt"], c: SessionCtx): boolean {
      let changed = false;
      for (const t of tracks.values()) {
        if (t.lever.readBackAt !== at || !t.lever.observe) continue;
        const o = t.lever.observe(c);
        if (o === undefined || (t.obs !== undefined && t.obs.v === o.v && t.obs.s === o.s)) continue;
        const before = JSON.stringify(stateOf(t));
        t.obs = o;
        changed ||= JSON.stringify(stateOf(t)) !== before;
      }
      return changed;
    },
    /** The recorded states, by lever id. */
    states(): Record<LeverId, LeverState> {
      const out: Record<LeverId, LeverState> = {};
      for (const [id, t] of tracks) {
        const st = stateOf(t);
        if (st !== undefined) out[id] = st;
      }
      return out;
    },
  };
}
