// Local mode switches (design §2.1): `mode` and the per-component toggles.
import type { RouterSettings } from "../types.ts";
import type { Budget } from "./overseer.ts";

export const LOCAL_COMPONENTS = ["hints", "worktrees", "mergeGate", "plans"] as const;
export type LocalComponent = (typeof LOCAL_COMPONENTS)[number];
export const isLocal = (s: RouterSettings): boolean => s.mode === "local";
/** "on" anywhere, "auto" in local mode only (design §2.1). */
export const componentOn = (s: RouterSettings, c: LocalComponent): boolean =>
  s[c].enabled === "on" || (s[c].enabled === "auto" && isLocal(s));
/** The status line `task-router` (design §2.5, OQ12): "local", or "local (main: <model>)" when the main runs on no local member;
 *  an active force adds its description (`force`, design §3.6.3), alone in default mode (plan Q4).
 *  undefined = leave the status line alone (default mode, no force). `hint`: the trip of the last hint until the next progress
 *  (design §3.1.2 "a status entry", plan Q5). `opusLeft`: the Opus budget once it is low (design §2.5, see `opusLeft`). */
export function statusText(x: { local: boolean; main?: string; localModels: string[]; force?: string; opusLeft?: number; hint?: string }): string | undefined {
  const parts: string[] = [];
  if (x.local) parts.push(x.main !== undefined && !x.localModels.includes(x.main) ? `local (main: ${x.main})` : "local");
  if (x.force) parts.push(x.force);
  if (x.opusLeft !== undefined) parts.push(`opus ${x.opusLeft} left`);
  if (x.hint) parts.push(`hint ${x.hint}`);
  return parts.length ? parts.join(" · ") : undefined;
}
/** The Opus reviews left when at most 3 are (plan Q19), else undefined. */
export function opusLeft(s: RouterSettings, b: Budget): number | undefined {
  const n = s.overseer.budget - b.opusUsed;
  return n <= 3 ? Math.max(0, n) : undefined;
}
