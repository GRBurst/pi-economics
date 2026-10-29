// Effort guard (spec §5.4): `max` is a burst, never a setting. After maxBurstTurns turns at max the previous level
// comes back; the cache survives a level switch (spike T1.4), and the meter's `effort` field shows the change.
import type { ThinkingLevel } from "./types.ts";

export type EffortPi = {
  on(name: string, handler: (e: any, ctx: any) => unknown): void;
  getThinkingLevel?(): ThinkingLevel;
  setThinkingLevel?(level: ThinkingLevel): void;
};

export function installEffortGuard(pi: EffortPi, maxBurstTurns: number): void {
  if (!pi.getThinkingLevel || !pi.setThinkingLevel) return;
  let previous: ThinkingLevel = "xhigh";
  let burst = 0;
  pi.on("turn_start", () => {
    const level = pi.getThinkingLevel!();
    if (level !== "max") { previous = level; burst = 0; }
  });
  pi.on("turn_end", (_e, ctx) => {
    if (pi.getThinkingLevel!() !== "max" || ++burst < maxBurstTurns) return;
    pi.setThinkingLevel!(previous);
    burst = 0;
    ctx?.ui?.notify?.(`task-router: effort max is a burst; restored ${previous} after ${maxBurstTurns} turn${maxBurstTurns === 1 ? "" : "s"}`, "info");
  });
}
