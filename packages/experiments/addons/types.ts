// The add-on contract (redesign §7.4): how the engine sets one lever of a target and reads back whether it took.
// Pure types; the states use token-meter's LeverState shape (core/levers.ts, design §5.3), which the internal-channel
// check holds equal to this copy (packages do not import each other).
import type { Level, LeverId } from "../core/design.ts";

/** pi-economics assigned it | an extension chose it (own default or own experiment) | configuration or pi default */
export type Source = "pe" | "ext" | "fixed";
export type ReadBack = "confirmed" | "refused" | "unverified";
/** How an add-on applies a level (§7.4): seed (a default the target may override), control (the target asks the
 * engine), replace (pi-economics' own intervention reads the level), shadow (recorded, not applied). */
export type Tier = "seed" | "control" | "replace" | "shadow";
/** One lever's state on the channel and on token-meter's levers line (§5.3). */
export type LeverState = { v: Level; s: Source; a?: Level; rb?: ReadBack; tier?: Tier };
/** What an observer saw: the effective value and who decided it; undefined = nothing to see yet. */
export type Observed<L extends Level = Level> = { v: L; s: Source } | undefined;

/** A provider and model id, as pi's `ctx.model` carries them. */
export type ModelRef = { provider?: string; id?: string };
/** What a lever's feasibility may depend on: the runtime it is assigned in and the session's current model. */
export type TargetEnv = { child: boolean; model?: ModelRef };
/**
 * The session an add-on acts in; `event` is the hook's event at read-back (message_end: `{ message }`). `model` is the
 * session's current model; `branch` reads the session's branch (custom entries included) and `appendEntry` adds a custom
 * entry to it, for the seed tier, which writes the target's own durable input (§7.4). Absent where the host has none.
 * `resumed`: the engine adopted the session's assignment instead of drawing it (a resumed or reloaded branch), so pi had
 * restored the session's own state (its thinking level) before the engine started; a control lever then only observes.
 */
export type SessionCtx = {
  sessionId: string;
  event?: unknown;
  model?: ModelRef;
  branch?(): readonly unknown[];
  appendEntry?(customType: string, data: unknown): void;
  resumed?: true;
};

/** What a factor says about its lever beyond the id: `target`, the extension whose tool or command shows it is loaded (seed kinds, review F1b). */
export type FactorInfo = { target?: string };
/**
 * A data-only lever kind (§12): the family of ids `<name>(<arg>, …)` with `arity` arguments (`pi.activeTool(<name>)`);
 * `make` builds the lever an id of the family names, else undefined. `name` and `arity` are what addons/catalogue.json
 * lists for the Nix module (test/catalogue.test.ts holds them equal).
 */
export type Kind = { name: string; arity: number; make(id: LeverId, factor?: FactorInfo): Lever | undefined };

export interface Lever<L extends Level = Level> {
  id: LeverId;
  /** The extension whose behaviour the lever sets ("pi" for pi itself); the lever is inert while it is not loaded. */
  target: string;
  scope: "request" | "session" | "process";
  tier: Tier;
  /** The levels the add-on can set here; [] = it cannot assign one (refused up front). */
  feasible(env: TargetEnv, levels: readonly L[]): readonly L[];
  /** Sets the level, in the engine's runtime, before the target reads it. */
  apply(ctx: SessionCtx, level: L): void;
  /**
   * The lever's own value a level stands for here, which `observe` reports and the lever state records as `a` (a range
   * lever's level is a fraction of the range the target's rule gives: the tokens it adopts). Absent: the level itself;
   * where the level has no value (nothing feasible), the level.
   */
  valueFor?(ctx: SessionCtx, level: L): Level;
  /**
   * A main session's lever (review F4): in a child (the actor's runtime) its value is the actor's or cache-lifecycle's own
   * choice, not what the design assigned, so the engine neither sets it nor records a state for it there: the child's
   * levers line omits it (not refused, not `ext`).
   */
  mainOnly?: true;
  /** "model": feasibility and value depend on the session's model, so a model switch re-evaluates and re-applies the level. */
  follow?: "model";
  /** Absent: no observer (the state stays unverified). */
  observe?(ctx: SessionCtx): Observed<L>;
  readBackAt: "before_agent_start" | "message_end";
}
