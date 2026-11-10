// Local-mode settings rules (design §3.0.1; plan D1–D3). `defaults()` owns the keys (so `merge()` accepts them); this file
// owns their rules. An invalid value gets its default back, reported as "<path>: <why>; default kept".
import { EFFORTS } from "../members.ts";
import type { RouterSettings } from "../types.ts";
import { LOCAL_COMPONENTS } from "./mode.ts";

type Obj = Record<string, unknown>;
const get = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((x, k) => (x as Obj | undefined)?.[k], o);
const set = (o: unknown, path: string, v: unknown): void => {
  const ks = path.split("."), last = ks.pop()!;
  (ks.reduce<unknown>((x, k) => (x as Obj)[k], o) as Obj)[last] = v;
};
/** `"a" or "b"`, `"a", "b" or "c"`. */
const listing = (xs: readonly string[]): string => {
  const q = xs.map((x) => JSON.stringify(x));
  return q.length < 2 ? q.join("") : `${q.slice(0, -1).join(", ")} or ${q.at(-1)}`;
};
const EFFORT_WHY = `must be an effort (${EFFORTS.join(", ")})`;
/** path, allowed values, the reason when another message than "must be <listing>" reads better. */
const ENUMS: [string, readonly string[], string?][] = [
  ["mode", ["default", "local"]],
  ...LOCAL_COMPONENTS.map((c): [string, readonly string[]] => [`${c}.enabled`, ["auto", "on", "off"]]),
  ["hints.steer", ["on", "off"]],
  ["plans.regression", ["milestone", "plan", "off"]],
  ["force.thinkingLevel", ["", ...EFFORTS], `must be "" or an effort (${EFFORTS.join(", ")})`],
  ["overseer.effort", EFFORTS, EFFORT_WHY],
  ["overseer.fallbackEffort", EFFORTS, EFFORT_WHY],
  ["mergeGate.fixerEffort", EFFORTS, EFFORT_WHY],
];

/** Called at the end of `validate()` (core/settings.ts); `s` is the merged settings, `base` the defaults. */
export function validateLocal(s: RouterSettings, base: RouterSettings, problems: string[]): void {
  const reset = (path: string, why: string): void => {
    set(s, path, structuredClone(get(base, path)));
    problems.push(`${path}: ${why}; default kept`);
  };
  for (const [path, values, why] of ENUMS) if (!values.includes(get(s, path) as string)) reset(path, why ?? `must be ${listing(values)}`);
}
