// A child's tripwires (design §3.1.3; plan S13, D18, D19). The router is not loaded in children, so it sees a child's calls
// only through the spawn policy's `toolGuard`: calls without results. The guard records each call, runs `childTrips`, sends
// the child the hint as a message and, when the trip persists, notifies its parent once per trip. It is an observer: it
// never returns a string (a hint never blocks a call) and never throws (it runs on the actor's hot path, plan R4).
import type { SubagentsApiV1 } from "../api.ts";
import type { createOutcomeLog } from "../log.ts";
import type { SyncGuard } from "../toolguard.ts";
import type { RouterSettings } from "../types.ts";
import { block, createHintEngine } from "./hints.ts";
import { callKey, childTrips, push } from "./tripwires.ts";
import type { CallRecord, Trip } from "./tripwires.ts";

const WRITERS = new Set(["edit", "write"]);
type State = { ring: CallRecord[]; call: number; engine: ReturnType<typeof createHintEngine>; told: Set<Trip> };

export function createChildTrips(d: { settings: RouterSettings; api: () => SubagentsApiV1 | undefined; log: Pick<ReturnType<typeof createOutcomeLog>, "hint"> }): {
  guard(child: string, parent: string): SyncGuard;
  forget(child: string): void;
} {
  const h = d.settings.hints, states = new Map<string, State>();
  const send = (to: string, text: string): void => {
    try { void d.api()?.send(to, text, "router")?.catch?.(() => undefined); } catch { /* a hint is advisory */ }
  };
  return {
    /** A new spawn of `child` starts with a fresh state; the guard of a forgotten (killed) child does nothing. */
    guard(child, parent) {
      const st: State = { ring: [], call: 0, engine: createHintEngine(h, d.settings.plans), told: new Set() };
      states.set(child, st);
      return (tool, input) => {
        try {
          if (states.get(child) !== st) return undefined;
          st.call += 1;
          st.ring = push(st.ring, { tool, key: callKey(tool, input), isWrite: WRITERS.has(tool), turn: 0 }, h);
          for (const x of st.engine.detected(childTrips(st.ring, h), st.call)) {
            if (x.stage === "hint") {
              send(child, block(x.trip, x.n, x.text));
              d.log.hint(child, x.trip, "hint", x.n);
            } else if (!st.told.has(x.trip)) { // the persistence stage: the parent decides, once per trip (D18)
              st.told.add(x.trip);
              send(parent, `[router] ${child} looks stuck (${x.trip} ×${x.n}); consider killing it and respawning with attemptOf`);
              d.log.hint(child, x.trip, "parent", x.n);
            }
          }
        } catch { /* observer only: never block, never throw */ }
        return undefined;
      };
    },
    forget(child) { states.delete(child); },
  };
}
