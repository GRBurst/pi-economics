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

/** What a lever's feasibility may depend on: the runtime it is assigned in. */
export type TargetEnv = { child: boolean };
/** The session an add-on acts in; `event` is the hook's event at read-back (message_end: `{ message }`). */
export type SessionCtx = { sessionId: string; event?: unknown };

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
  /** Absent: no observer (the state stays unverified). */
  observe?(ctx: SessionCtx): Observed<L>;
  readBackAt: "before_agent_start" | "message_end";
}
