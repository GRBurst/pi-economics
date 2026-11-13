// The experiments package's designs (an own copy, a package imports no other), the arm id decoding and the first assignment row per session.

type Factors = Array<[string, [string, string]]>;
const V1: Factors = [["warmPolicy", ["native", "orchestrator-aware"]], ["mainCacheTtl", ["5m", "1h"]], ["foldHint", ["fixed", "cache-aware"]], ["maskOnCold", ["off", "on"]], ["freshOnCold", ["off", "advise"]]];
const V2: Factors = [...V1, ["delegationRule", ["off", "on"]]];
const V4: Factors = [V1[0], V1[1], V1[3]];
/**
 * The experiments package's designs (own copy): v1 = five factors (rows without `design`), v2 = six (`design: "v2"`), v3 = the same six
 * factors and arms as v2 (`design: "v3"`) but foldHint = cache-aware meant something else (a system-prompt paragraph): v2 and v3 sessions
 * are analysed in separate tables, never pooled, although they share arm ids. v4 = three factors (warmPolicy, mainCacheTtl, maskOnCold),
 * the full 2^3 (`design: "v4"`): foldHint went with infinite-context's fold hint, freshOnCold and delegationRule are no factors any more.
 */
export const DESIGNS: Record<string, Factors> = { v1: V1, v2: V2, v3: V2, v4: V4 };

/** A row's `design`, else by arm length (5 → v1, 6 → v2, 3 → v4). */
export const designOf = (arm: string, row?: any): string =>
  typeof row?.design === "string" ? row.design : arm.length === 5 ? "v1" : arm.length === 6 ? "v2" : arm.length === 3 ? "v4" : `${arm.length}-factor`;

/** First assignment row per session. */
export function rowsBySession(rows: any[]): Map<string, any> {
  const m = new Map<string, any>();
  for (const r of rows) if (typeof r?.sessionId === "string" && typeof r.arm === "string" && !m.has(r.sessionId)) m.set(r.sessionId, r);
  return m;
}

/** arm → { design, flags } from the assignment rows, else decoded from the arm id. */
export function armInfo(arms: string[], rows: any[]): Map<string, { design: string; flags: Record<string, string> }> {
  const out = new Map<string, { design: string; flags: Record<string, string> }>();
  for (const r of rows) if (typeof r?.arm === "string" && !out.has(r.arm) && r.flags && typeof r.flags === "object") out.set(r.arm, { design: designOf(r.arm, r), flags: r.flags });
  for (const arm of arms) {
    if (out.has(arm)) continue;
    const design = designOf(arm);
    const fs = DESIGNS[design] ?? [];
    out.set(arm, { design, flags: Object.fromEntries(fs.map(([n, v], i) => [n, arm[i] === "+" ? v[1] : v[0]])) });
  }
  return out;
}
