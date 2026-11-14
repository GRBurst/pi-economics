// The add-ons of pi's own process-scope settings (redesign §8.1 "bench", §10, M9): the compaction levers. The bench
// writes the level into the run's settings.json before pi starts, so `apply` has nothing to do (tier seed: pi's own
// settings merge may still override it); the read-back is pi 1.4's EFFECTIVE value, as token-meter's observer computes
// it (core/effective-settings.ts; packages do not import each other, so this restates the three compaction levers):
// the project's settings (only when the project is trusted) over the global ones (nested objects merge, other values
// replace), then for the two token counts the entry of `compaction.modelOverrides` for the session's model, then the
// ordinary setting, then pi's default. An unset key is pi's default, which is what runs: recorded as the observation
// (so a level the settings did not carry reads back `refused`). A value pi rejects is no observation (unverified).
// Compaction levers are meaningful only in a session without infinite-context, which cancels every native compaction
// (D18); the bench loads none for such arms.
import { PROCESS_SETTINGS, isCount } from "../core/process-levers.ts";
import type { Level } from "../core/design.ts";
import type { Lever, Observed } from "./types.ts";

/** What pi merges: the global file (<agentDir>/settings.json), the project's (<cwd>/.pi/settings.json, undefined when untrusted) and the session's model ("provider/id"). */
export type SettingsReader = () => { global: unknown; project: unknown; model?: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function merge(base: Obj, over: Obj): Obj {
  const out: Obj = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = isObj(base[k]) && isObj(v) ? merge(base[k] as Obj, v) : v;
  }
  return out;
}

/** The effective value of one lever, or undefined when pi would reject what the files hold. */
function effective(files: ReturnType<SettingsReader>, id: string): Level | undefined {
  const { path, kind, default: dflt } = PROCESS_SETTINGS[id];
  const merged = merge(isObj(files.global) ? files.global : {}, isObj(files.project) ? files.project : {});
  const ok = (x: unknown) => (kind === "boolean" ? typeof x === "boolean" : isCount(x));
  if (kind === "tokens") {
    const byModel = isObj(merged.compaction) && files.model !== undefined ? merged.compaction.modelOverrides : undefined;
    const entry = isObj(byModel) && files.model !== undefined ? byModel[files.model] : undefined;
    if (entry !== undefined && !isObj(entry)) return undefined; // pi throws
    const o = isObj(entry) ? entry[path[path.length - 1]] : undefined;
    if (o !== undefined) return ok(o) ? (o as number) : undefined;
  }
  const x = path.reduce<unknown>((v, k) => (isObj(v) ? v[k] : undefined), merged);
  return x === undefined ? dflt : ok(x) ? (x as Level) : undefined;
}

const feasibleOf = (kind: "boolean" | "tokens") => <L extends Level>(_env: unknown, levels: readonly L[]): readonly L[] =>
  levels.filter((l) => (kind === "boolean" ? typeof l === "boolean" : isCount(l)));

export function piProcessLevers(read: SettingsReader): readonly Lever[] {
  return Object.entries(PROCESS_SETTINGS).map(([id, { kind }]): Lever => ({
    id, target: "pi", scope: "process", tier: "seed", readBackAt: "before_agent_start",
    feasible: feasibleOf(kind),
    apply: () => {},
    observe: (): Observed => {
      const v = effective(read(), id);
      return v === undefined ? undefined : { v, s: "fixed" };
    },
  }));
}
