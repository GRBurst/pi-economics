// Hint engine (design §3.1.2, plan S11, D14): the fixed text per trip, the `<router-hint>` block (the pattern of core/fresh.ts),
// and when a detection is delivered. Pure: the caller numbers the calls and owns delivery, logs and progress.
import type { HintSettings, RouterSettings } from "../types.ts";
import type { Trip } from "./tripwires.ts";

/** Fixed texts (plan Q7: pinned as S11 wrote them); they carry no model-generated content. */
export const HINT_TEXT: Record<Trip, (h: HintSettings, p: RouterSettings["plans"]) => string> = {
  "identical-call": (h) => `You ran this exact call ${h.identicalCalls} times; its result will not change. Use the result you have, or change the approach.`,
  "no-change-writes": (h) => `${h.noChangeWrites} writes changed nothing. Re-read the file before editing; oldText must match exactly.`,
  alternation: (h) => `You alternated between the same two calls ${h.alternations} times and no file changed. Change the approach.`,
  "repeated-error": (h) => `The same error came back ${h.repeatedErrors} times in a row. Fix its cause; do not repeat the call unchanged.`,
  churn: (h) => `You wrote the same file ${h.churnEdits} times within ${h.churnTurns} turns. Re-read it, decide the whole change, then write it once.`,
  "check-failing": (h) => `The check failed ${h.checkFailures} times in a row. If the cause is unclear, spawn a debug-design card (files, check, acceptance).`,
  "over-size": (_h, p) => `This branch exceeds ${p.splitLines} changed lines or ${p.splitFiles} files. Commit what passes and split the rest.`,
  "risky-path": () => `This path matches a risk rule. Keep the change minimal and spawn a review card for it (the file and its check).`,
  "context-soft": (h) => `Context is above ${Math.round(h.contextSoftTokens / 1000)}k tokens. Fold finished work or hand off with a task card.`,
  // Raised by the write guard (design §3.3.3), which blocks the write with the same sentence plus the worktree's directory.
  "outside-worktree": () => "write in the worktree; use absolute paths under it",
  "context-stall": (h) => `Context is above ${h.contextPercent} % and nothing changed for ${h.stallTurns} turns. Hand the rest to a fresh agent with a task card, or fold finished work.`,
};
/** The fixed escalation (§3.1.2) while there is no steer overseer (L3; L4 runs the overseer when its budget has room). */
export const ESCALATION = "This persists after the hints. Spawn a debug-design card for it; the router will route it to Sonnet or above.";
export const block = (trip: Trip, n: number, text: string): string => `<router-hint trip="${trip}" n="${n}">${text}</router-hint>`;
/** `n`: the trip's detections since the last progress or escalation; `text`: the bare sentence (the caller wraps it in `block`). */
export type Delivery = { trip: Trip; n: number; stage: "hint" | "steer"; text: string };

/** Plan D14: every detection counts toward persistence; the cooldown suppresses only the hint; the escalation (detection
 *  1 + persistTrips since progress) is never suppressed and starts the count again. */
export function createHintEngine(h: HintSettings, p: RouterSettings["plans"]): {
  /** `size`: the branch's own budget for the `over-size` text (spot-check F6); absent: `splitLines`/`splitFiles`. */
  detected(trips: Trip[], call: number, size?: Pick<RouterSettings["plans"], "splitLines" | "splitFiles">): Delivery[];
  progress(): void;
} {
  const count = new Map<Trip, number>(), lastHint = new Map<Trip, number>();
  return {
    detected(trips, call, size) {
      const out: Delivery[] = [];
      for (const trip of trips) {
        const n = (count.get(trip) ?? 0) + 1;
        count.set(trip, n);
        if (n >= 1 + h.persistTrips) {
          count.set(trip, 0);
          out.push({ trip, n, stage: "steer", text: ESCALATION });
          continue;
        }
        const last = lastHint.get(trip);
        if (last !== undefined && call - last <= h.cooldownCalls) continue;
        lastHint.set(trip, call);
        out.push({ trip, n, stage: "hint", text: HINT_TEXT[trip](h, size ? { ...p, ...size } : p) });
      }
      return out;
    },
    progress() { count.clear(); },
  };
}
