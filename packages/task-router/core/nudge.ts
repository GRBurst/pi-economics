// Thin pi hook around core/delegation.ts: counts the tool calls of every turn of the MAIN session, resets on a
// spawn or on user input, and sends one steering custom message when the reminder is due (same API as the
// infinite-context nudge). Children never count and never get it.
import { countCalls, nudgeText } from "./delegation.ts";
import type { RouterSettings } from "./types.ts";

export type NudgePi = {
  on(name: string, handler: (e: any, ctx: any) => unknown): void;
  sendMessage?(message: { customType: string; content: string; display: boolean; details?: unknown }, options?: { deliverAs?: "steer" | "followUp" | "nextTurn"; triggerTurn?: boolean }): void;
};

export const NUDGE_TYPE = "task-router/delegation-nudge";

export function installNudge(pi: NudgePi, d: { settings: RouterSettings; isChild: (ctx: any) => boolean }): void {
  if (!pi.sendMessage) return;
  let count = 0;
  pi.on("session_start", () => { count = 0; });
  // A child's reply that wakes the orchestrator arrives as an extension message: not user input.
  pi.on("input", (e, ctx) => {
    if (e?.source !== "extension" && !d.isChild(ctx)) count = 0;
    return undefined;
  });
  pi.on("turn_end", (e, ctx) => {
    if (d.isChild(ctx)) return undefined;
    const s = d.settings.delegation;
    const r = countCalls(count, (e?.toolResults ?? []).map((t: { toolName?: string }) => String(t?.toolName)), s);
    count = r.count;
    if (!r.due) return undefined;
    pi.sendMessage!(
      { customType: NUDGE_TYPE, content: `<delegation-hint>\n${nudgeText(d.settings.routing)}\n</delegation-hint>`, display: true, details: { afterCalls: s.afterCalls } },
      { deliverAs: "steer" },
    );
    return undefined;
  });
}
