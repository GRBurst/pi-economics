// The data-only lever kinds that set pi itself (redesign §7.4 control tier, §8.1, §12; M7b): `pi.thinkingLevel` and
// `pi.activeTool(<name>)`. The engine sets them through pi's session control at its own session_start and reads
// back with the matching getter at before_agent_start. The read-back is the EFFECTIVE value (M3b review F3:
// token-meter's `pi.defaultThinkingLevel` is the configured default for a new session, not what this one ran with).
// Both are a main session's levers: a child's level and tools are the actor's (an orchestrator's explicit choice),
// infeasible there like mainCacheTtl. Source of an observation that is not the assigned level: `fixed` when it is what
// pi reported right after the engine set it (pi's own clamp: the model cannot take the level; an ignored tool name),
// else `ext` (changed after: another extension, /thinking, pi's reset at a model switch; the source cannot tell them
// apart). Order hazard (§7.4): a later extension's before_agent_start handler runs after the engine's read-back, so
// its change shows at the next prompt.
import type { Kind, Lever, Observed } from "./types.ts";

/** pi's thinking levels, in pi 1.4's order (`off` … `xhigh`). */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

/** What the add-ons use of pi's ExtensionAPI: the session control methods. */
export type PiControl = {
  getThinkingLevel(): unknown;
  setThinkingLevel(level: string): void;
  getActiveTools(): readonly string[];
  setActiveTools(names: string[]): void;
  getAllTools(): ReadonlyArray<{ name: string }>;
  getCommands(): ReadonlyArray<{ name: string }>;
};

const safe = <T>(f: () => T): T | undefined => {
  try { return f(); } catch { return undefined; }
};

/** What an observer saw of a control: pi's own clamp (the value pi settled on when the engine set it) is `fixed`, any other value `ext`. */
const seenAs = <L extends string | boolean>(v: L, settled: L | undefined): Observed<L> => ({ v, s: v === settled ? "fixed" : "ext" });

function thinkingLevel(pi: PiControl): Lever<string> {
  const settled = new Map<string, string>(); // session → the level pi reported right after the engine set it
  return {
    id: "pi.thinkingLevel", target: "pi", scope: "session", tier: "control", readBackAt: "before_agent_start",
    feasible: (env, levels) => (env.child ? [] : levels.filter((l) => (THINKING_LEVELS as readonly string[]).includes(l))),
    apply(ctx, level) {
      pi.setThinkingLevel(level);
      const now = safe(() => pi.getThinkingLevel());
      if (typeof now === "string") settled.set(ctx.sessionId, now);
    },
    observe(ctx) {
      const v = safe(() => pi.getThinkingLevel());
      return typeof v === "string" ? seenAs(v, settled.get(ctx.sessionId)) : undefined;
    },
  };
}

function activeTool(pi: PiControl, tool: string): Lever<boolean> {
  const settled = new Map<string, boolean>();
  const isActive = () => pi.getActiveTools().includes(tool);
  return {
    id: `pi.activeTool(${tool})`, target: "pi", scope: "session", tier: "control", readBackAt: "before_agent_start",
    feasible: (env, levels) => (env.child || safe(() => pi.getAllTools().some((t) => t.name === tool)) !== true ? [] : levels.filter((l) => typeof l === "boolean")),
    apply(ctx, on) {
      const active = pi.getActiveTools();
      if (active.includes(tool) !== on) pi.setActiveTools(on ? [...active, tool] : active.filter((n) => n !== tool));
      const now = safe(isActive);
      if (now !== undefined) settled.set(ctx.sessionId, now);
    },
    observe(ctx) {
      const v = safe(isActive);
      return v === undefined ? undefined : seenAs(v, settled.get(ctx.sessionId));
    },
  };
}

/** `pi.activeTool(<name>)`: a tool name has no parentheses, commas, space, tab or line break (a levers line key stays one token; modules/experiments.nix says the same). */
const ACTIVE_TOOL = /^pi\.activeTool\(([^(), \t\r\n]+)\)$/;

/** The levers and the lever kinds that set pi through its session control. */
export function piAddons(pi: PiControl): { levers: readonly Lever[]; kinds: readonly Kind[] } {
  const tool: Kind = (id) => {
    const name = ACTIVE_TOOL.exec(id)?.[1];
    return name === undefined ? undefined : activeTool(pi, name);
  };
  return { levers: [thinkingLevel(pi)], kinds: [tool] };
}
