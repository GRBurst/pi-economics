// Task card validation (spec §5.2.3). Pure; reports every problem at once.
import type { Card, Result, T0, T2 } from "./types.ts";

export const T0_KEYS: (keyof T0)[] = ["bounded", "specified", "verifiable", "lowRisk", "small", "linear"];
export const T2_VALUES: T2[] = [
  "open-design", "interface-change", "security", "concurrency",
  "migration-destructive", "repo-wide", "unknown-root-cause",
];

const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

export function parseCard(x: unknown): Result<Card> {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return { ok: false, errors: ["card must be an object"] };
  const o = x as Record<string, unknown>;
  const errors: string[] = [];
  const need = (k: string, ok: boolean, type: string) => {
    if (!ok) errors.push(`${k}: ${o[k] === undefined ? "missing" : "expected"} ${type}`);
  };
  need("kind", typeof o.kind === "string" && o.kind !== "", "non-empty string");
  need("files", isStrArr(o.files), "string[]");
  need("acceptance", isStrArr(o.acceptance), "string[]");
  const t0 = o.t0 as Record<string, unknown> | undefined;
  if (t0 === null || typeof t0 !== "object") errors.push("t0: missing object with six booleans");
  else for (const k of T0_KEYS) need(`t0.${k}`, typeof t0[k] === "boolean", "boolean");
  if (!Array.isArray(o.t2)) errors.push("t2: missing array");
  else for (const v of o.t2) if (!T2_VALUES.includes(v)) errors.push(`t2: unknown value ${JSON.stringify(v)}; allowed: ${T2_VALUES.join(", ")}`);
  for (const k of ["check", "attemptOf", "failure", "reviewOf"]) if (o[k] !== undefined) need(k, typeof o[k] === "string", "string");
  if (o.cwd !== undefined) need("cwd", typeof o.cwd === "string" && /^(\/|~$|~\/)/.test(o.cwd), "absolute path or ~/…");
  if (o.importance !== undefined) need("importance", o.importance === "high" || o.importance === "critical", '"high" or "critical"');
  if (o.skills !== undefined) need("skills", isStrArr(o.skills), "string[]");
  if (errors.length) return { ok: false, errors };

  const card: Card = {
    kind: o.kind as string, files: o.files as string[], acceptance: o.acceptance as string[],
    t0: Object.fromEntries(T0_KEYS.map((k) => [k, t0![k]])) as T0, t2: o.t2 as T2[],
  };
  for (const k of ["check", "importance", "attemptOf", "failure", "skills", "cwd", "reviewOf"] as const) {
    if (o[k] !== undefined) (card as Record<string, unknown>)[k] = o[k];
  }
  return { ok: true, value: card };
}
