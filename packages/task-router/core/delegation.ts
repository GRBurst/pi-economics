// Delegation nudge (spec §5.6.5, T5.19): after `afterCalls` inline mechanical tool calls without a spawn or
// user input, the main session gets one short reminder. Pure: the shell feeds the tool names of each turn.
import type { RouterSettings } from "./types.ts";

export type DelegationSettings = RouterSettings["delegation"];

/** Tool names in call order → new running count, and whether the reminder is due now. */
export function countCalls(count: number, tools: string[], s: DelegationSettings): { count: number; due: boolean } {
  if (s.nudge === "off") return { count: 0, due: false };
  let due = false;
  for (const t of tools) {
    if (t === "spawn_subagent") {
      count = 0;
      due = false; // delegated after all
    } else if (s.tools.includes(t) && ++count >= s.afterCalls) {
      count = 0;
      due = true;
    }
  }
  return { count, due };
}

/** Agent-facing text; without routing there is no task card to fill. */
export const nudgeText = (routing: boolean): string =>
  `This looks delegable: if the remaining work is a bounded task, ${routing ? "fill a task card and spawn it" : "spawn it"}.`;
