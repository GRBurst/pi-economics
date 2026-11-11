// Local-mode settings rules (design §3.0.1; plan D1–D3). `defaults()` owns the keys (so `merge()` accepts them); this file
// owns their rules. An invalid value gets its default back, reported as "<path>: <why>; default kept".
import { EFFORTS } from "../members.ts";
import type { RouterSettings, ThinkingLevel } from "../types.ts";
import { LOCAL_COMPONENTS, componentOn, isLocal } from "./mode.ts";

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

/** Number leaves of the local sections that are ranges, not counts: path, upper bound (the lower bound 0 is exclusive). */
const RANGES: [string, number][] = [["hints.errorSimilarity", 1], ["hints.contextPercent", 100]];
/** Counts that may be 0: Opus never used, no steering, no resubmits, no fixer (review F11). */
const ZERO_OK = ["overseer.budget", "overseer.steerBudget", "overseer.resubmits", "mergeGate.fixerRounds"];
const SECTIONS = ["hints", "overseer", "mergeGate", "plans"] as const;
const isStr = (x: unknown): x is string => typeof x === "string";
/** path, the list rule, its reason. */
const LISTS: [string, (xs: unknown[]) => boolean, string][] = [
  ["mergeGate.mainBranches", (xs) => xs.length > 0 && xs.every((x) => isStr(x) && x !== ""), "must be a non-empty list of non-empty strings"],
  ["overseer.tools", (xs) => xs.length > 0 && xs.every(isStr), "must be a non-empty list of strings"],
  ["mergeGate.extraChecks", (xs) => xs.every(isStr), "must be a list of strings"],
  ["plans.publicApiGlobs", (xs) => xs.every(isStr), "must be a list of strings"],
];
/** pi's built-in tools that change files (`overseer.tools` may hold none of them). */
const WRITERS = ["bash", "edit", "write"];
/** A member reference and the effort paired with it. */
const MEMBERS: [string, string][] = [
  ["overseer.member", "overseer.effort"], ["overseer.fallbackMember", "overseer.fallbackEffort"], ["mergeGate.fixerMember", "mergeGate.fixerEffort"],
];

/** Called at the end of `validate()` (core/settings.ts); `s` is the merged settings, `base` the defaults. A wrong-typed value
 *  never gets here: `merge()` keeps the default for it. */
export function validateLocal(s: RouterSettings, base: RouterSettings, problems: string[]): void {
  const reset = (path: string, why: string): void => {
    set(s, path, structuredClone(get(base, path)));
    problems.push(`${path}: ${why}; default kept`);
  };
  for (const [path, values, why] of ENUMS) if (!values.includes(get(s, path) as string)) reset(path, why ?? `must be ${listing(values)}`);
  const ranges = new Map(RANGES);
  for (const sec of SECTIONS) for (const [k, d] of Object.entries(base[sec])) {
    const path = `${sec}.${k}`, v = get(s, path) as number, top = ranges.get(path);
    if (typeof d !== "number") continue;
    const floor = ZERO_OK.includes(path) ? 0 : 1;
    if (top === undefined && !(Number.isInteger(v) && v >= floor)) reset(path, floor === 0 ? "must be a non-negative integer" : "must be a positive integer");
    if (top !== undefined && !(v > 0 && v <= top)) reset(path, `must be a number in (0, ${top}]`);
  }
  for (const [path, ok, why] of LISTS) if (!ok(get(s, path) as unknown[])) reset(path, why);
  // An overseer audits and must not write (design §3.2, P13 Q11): its tools are read-only.
  const writer = s.overseer.tools.find((t) => WRITERS.includes(t));
  if (writer !== undefined) reset("overseer.tools", `${writer} can write`);
  // Plan D40: plans switched on need worktrees and mergeGate active; else they are switched off (auto is silently inactive).
  if (s.plans.enabled === "on" && !(componentOn(s, "worktrees") && componentOn(s, "mergeGate"))) {
    s.plans.enabled = "off";
    problems.push("plans: needs worktrees and mergeGate; off");
  }
  // Plan D2: member references only matter when a component that uses them can run; in default mode with every component
  // "auto" a blank Opus or Sonnet must not add a problem (G6, AC-N2).
  if (!isLocal(s) && !LOCAL_COMPONENTS.some((c) => s[c].enabled === "on")) return;
  const live = (n: string): boolean => s.models[n] !== undefined && s.models[n].model !== "";
  for (const [mp, ep] of MEMBERS) {
    // A default that is itself invalid (a blank Opus) is reported and kept; its effort cannot be checked then.
    if (!live(get(s, mp) as string)) reset(mp, `${JSON.stringify(get(s, mp))} is not an enabled member`);
    const member = get(s, mp) as string;
    if (!live(member)) continue;
    const ladder = s.models[member].efforts, e = get(s, ep) as ThinkingLevel;
    if (!ladder.includes(e)) reset(ep, `${e} is not an effort of ${member} (${ladder.join(", ")})`);
  }
}
