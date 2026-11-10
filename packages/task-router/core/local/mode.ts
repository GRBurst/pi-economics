// Local mode switches (design §2.1): `mode` and the per-component toggles.
import type { RouterSettings } from "../types.ts";

export const LOCAL_COMPONENTS = ["hints", "worktrees", "mergeGate", "plans"] as const;
export type LocalComponent = (typeof LOCAL_COMPONENTS)[number];
export const isLocal = (s: RouterSettings): boolean => s.mode === "local";
/** "on" anywhere, "auto" in local mode only (design §2.1). */
export const componentOn = (s: RouterSettings, c: LocalComponent): boolean =>
  s[c].enabled === "on" || (s[c].enabled === "auto" && isLocal(s));
/** The status line `task-router` (design §2.5, OQ12): "local", or "local (main: <model>)" when the main runs on no local member.
 *  undefined = leave the status line alone (default mode). */
export function statusText(x: { local: boolean; main?: string; localModels: string[] }): string | undefined {
  if (!x.local) return undefined;
  return x.main !== undefined && !x.localModels.includes(x.main) ? `local (main: ${x.main})` : "local";
}
