// The add-on registry (redesign §7.4): which levers the engine can set, and the read-back that turns an assigned
// level, its feasibility and an observation into one lever state (§5.3). Pure; the shell drives it.
import type { Level, LeverId } from "../core/design.ts";
import type { Kind, Lever, LeverState, Observed, SessionCtx, TargetEnv } from "./types.ts";

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

/** The levers the engine can set (`levers` by id, and the lever each data-only kind makes of an id it recognises); a target's levers are live once it is loaded in this runtime ("pi" always is). */
export type Registry = { lever(id: LeverId): Lever | undefined; loaded(target: string): boolean; load(target: string): boolean };

export function createRegistry(levers: readonly Lever[], kinds: readonly Kind[] = []): Registry {
  const byId = new Map(levers.map((l) => [l.id, l]));
  const live = new Set(["pi"]);
  return {
    lever(id) {
      let l = byId.get(id);
      for (const kind of kinds) if (l === undefined && (l = kind(id)) !== undefined) byId.set(id, l); // one lever per id
      return l;
    },
    loaded: (target) => live.has(target),
    /** true when the target was not loaded before. */
    load: (target) => !live.has(target) && live.add(target) !== undefined,
  };
}

/** `level`: the factor's assigned level; `a`: the lever value it stands for (the level itself unless the add-on maps it); `ok`: the add-on can set it. */
type Track = { lever: Lever; name: string; level: Level; a: Level; ok: boolean; obs: Observed };

/**
 * One session's levers: each factor of its assignment whose add-on is registered and whose target is loaded starts once
 * (feasibility, then `apply` when feasible); an observer's last defined observation stands until a new one differs.
 * `levelsOf(name)` = the design's levels of a factor. `ctxOf()` = the session as the add-ons see it now (its model, branch
 * and entry writer; default: the id only); a lever that follows the model is evaluated again by `modelChanged`.
 */
export function sessionLevers(
  registry: Registry,
  assigned: { sessionId: string; factors?: Record<string, { lever: LeverId; assigned: Level }> },
  env: TargetEnv,
  levelsOf: (factor: string) => readonly Level[],
  ctxOf: () => SessionCtx = () => ({ sessionId: assigned.sessionId }),
) {
  const tracks = new Map<LeverId, Track>();
  const stateOf = (t: Track): LeverState | undefined => {
    const st = readBack(t.a, t.ok ? undefined : [], t.lever.observe ? t.obs : "no-observer");
    return st?.a === undefined ? st : { ...st, tier: t.lever.tier };
  };
  /** Feasibility and value of a track's level now; sets the level when feasible. */
  const start = (t: Track): void => {
    const ctx = ctxOf();
    const m = ctx.model;
    t.ok = t.lever.feasible(m === undefined ? env : { ...env, model: m }, levelsOf(t.name)).includes(t.level);
    t.a = t.lever.valueFor?.(ctx, t.level) ?? t.level;
    // A target's control may refuse (pi's before it is active): the lever stays tracked and is read back as it is.
    if (t.ok) {
      try { t.lever.apply(ctx, t.level); } catch (err) { console.warn(`experiments: ${t.lever.id}: apply failed: ${(err as Error).message}`); }
    }
  };
  return {
    /** Starts every live lever not started yet; true when one started. */
    refresh(): boolean {
      let started = false;
      for (const [name, f] of Object.entries(assigned.factors ?? {})) {
        const lever = registry.lever(f.lever);
        if (lever === undefined || tracks.has(lever.id) || !registry.loaded(lever.target)) continue;
        const t: Track = { lever, name, level: f.assigned, a: f.assigned, ok: false, obs: undefined };
        tracks.set(lever.id, t);
        start(t);
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
    /**
     * The session's model changed (`ctxOf()` already says the new one): the levers that follow the model are evaluated and
     * set again, and their earlier observation no longer holds. True when a state changed.
     */
    modelChanged(): boolean {
      let changed = false;
      for (const t of tracks.values()) {
        if (t.lever.follow !== "model") continue;
        const before = JSON.stringify(stateOf(t));
        start(t);
        t.obs = undefined;
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
