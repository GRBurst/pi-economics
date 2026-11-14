// The add-ons of cache-lifecycle's levers (redesign §7.4, M5b.2): tier replace. cache-lifecycle is pi-economics' own
// intervention and reads its assigned level from the internal channel (core/channel.ts), so `apply` sets nothing.
// Order hazard (§7.4): a later extension's cache_warming_decision / context / before_provider_request handler can undo
// what cache-lifecycle returns, so only response evidence confirms: mainCacheTtl from the TTL split of the response's
// cache writes; warmPolicy and maskOnCold have no observer and stay unverified.
import type { Lever, Observed } from "./types.ts";

const TARGET = "cache-lifecycle";
const replace = { target: TARGET, scope: "session", tier: "replace", apply: () => {} } as const;
/** Review m2: the levels cache-lifecycle understands as a factor (core/shell.ts flag()); a stratum's other levels are infeasible. */
const understood = (known: readonly string[]) => <L>(_env: unknown, levels: readonly L[]): readonly L[] =>
  levels.filter((l) => known.includes(l as string));
const WARM = understood(["native", "orchestrator-aware"]);
const TTL = understood(["5m", "1h"]);
const MASK = understood(["off", "on"]);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** The TTL the response's cache writes show: pi 1.4 reports `cacheWrite1h` where the provider splits them (Anthropic). */
function writtenTtl(event: unknown): Observed<string> {
  const usage = isObj(event) && isObj(event.message) ? event.message.usage : undefined;
  if (!isObj(usage) || typeof usage.cacheWrite1h !== "number" || !(typeof usage.cacheWrite === "number" && usage.cacheWrite > 0)) return undefined;
  return { v: usage.cacheWrite1h > 0 ? "1h" : "5m", s: "fixed" };
}

export const CACHE_LIFECYCLE: readonly Lever[] = [
  { ...replace, id: `${TARGET}.warmPolicy`, readBackAt: "before_agent_start", feasible: WARM },
  {
    ...replace, id: `${TARGET}.mainCacheTtl`, readBackAt: "message_end", mainOnly: true,
    // A main session's TTL: cache-lifecycle writes 5 m in a child whatever the arm says; no state is recorded there (review F4).
    feasible: (env, levels) => (env.child ? [] : TTL(env, levels)),
    observe: (ctx) => writtenTtl(ctx.event),
  },
  { ...replace, id: `${TARGET}.maskOnCold`, readBackAt: "before_agent_start", feasible: MASK },
];
