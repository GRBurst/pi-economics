// The add-ons of pi's own process-scope settings (redesign §8.1 "bench", §10, M9): the compaction levers. The bench
// writes the level into the run's settings.json before pi starts, so `apply` has nothing to do (tier seed: pi's own
// settings merge may still override it); the read-back is the effective value, the project's settings over the global
// ones (pi's merge rule: nested objects merge, other values replace). Compaction levers are meaningful only in a
// session without infinite-context, which cancels every native compaction (D18); the bench loads none for such arms.
import { PROCESS_SETTINGS } from "../core/process-levers.ts";
import type { Level } from "../core/design.ts";
import type { Lever, Observed } from "./types.ts";

/** pi's settings files as read: the global one (<agentDir>/settings.json) and the project's (<cwd>/.pi/settings.json). */
export type SettingsReader = () => { global: unknown; project: unknown };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The effective value at `path` (project over global), undefined when neither sets it. */
function effective(files: ReturnType<SettingsReader>, path: readonly string[]): Level | undefined {
  for (const f of [files.project, files.global]) {
    let v: unknown = f;
    for (const k of path) v = isObj(v) ? v[k] : undefined;
    if (v !== undefined) return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : undefined;
  }
  return undefined;
}

const feasibleOf = (kind: "boolean" | "tokens") => <L extends Level>(_env: unknown, levels: readonly L[]): readonly L[] =>
  levels.filter((l) => (kind === "boolean" ? typeof l === "boolean" : typeof l === "number" && Number.isInteger(l) && l >= 0));

export function piProcessLevers(read: SettingsReader): readonly Lever[] {
  return Object.entries(PROCESS_SETTINGS).map(([id, { path, kind }]): Lever => ({
    id, target: "pi", scope: "process", tier: "seed", readBackAt: "before_agent_start",
    feasible: feasibleOf(kind),
    apply: () => {},
    observe: (): Observed => {
      const v = effective(read(), path);
      return v === undefined ? undefined : { v, s: "fixed" };
    },
  }));
}
