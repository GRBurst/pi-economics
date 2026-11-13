// The analyser's log types, the four log names and the line helpers shared by every section.

import { type Plans } from "../plans.ts";

export type LogName = "meter" | "outcomes" | "assignments" | "guards";
export type FileInfo = { log: LogName; file: string; lines: number; unparsable: number };
export type Logs = { meter: any[]; outcomes: any[]; assignments: any[]; guards: any[];
  /** Per file read (torn or foreign lines are counted, not parsed). */
  files?: FileInfo[];
  /** experiments/settings.json and task-router/settings.json, when present. */
  expSettings?: any; routerSettings?: any;
  /** token-meter's `plans` setting (billing class per provider), parsed; absent = not known: every unit is then in stratum "api". */
  plans?: Plans };
/** Inclusive UTC days, YYYY-MM-DD. */
export type Period = { since?: string; until?: string };

export const LOGS: LogName[] = ["meter", "outcomes", "assignments", "guards"];
/** Schema version of a line; lines written before `v` existed are version 0. */
export const versionOf = (l: any): number => (Number.isInteger(l?.v) ? l.v : 0);

export const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export const isLine = (l: any): boolean => !!l && typeof l.ts === "string" && !Number.isNaN(Date.parse(l.ts));
export const byTs = (a: any, b: any): number => Date.parse(a.ts) - Date.parse(b.ts);
export const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);
export const countBy = <T>(xs: T[], key: (x: T) => string): Record<string, number> => xs.reduce((m, x) => ((m[key(x)] = (m[key(x)] ?? 0) + 1), m), {} as Record<string, number>);

/** Meter, outcomes and guards lines whose UTC day is in the period; assignments are kept whole (they are looked up by session). */
export function inPeriod(logs: Logs, p: Period): Logs {
  const keep = (l: any) => isLine(l) && (p.since === undefined || l.ts.slice(0, 10) >= p.since) && (p.until === undefined || l.ts.slice(0, 10) <= p.until);
  return { ...logs, meter: logs.meter.filter(keep), outcomes: logs.outcomes.filter(keep), guards: logs.guards.filter(keep) };
}

/** A failed request: the log line has no usage and is not a request (it is neither a fold, nor activity). */
export const isError = (l: any): boolean => l.status === "error";
/** A warm turn whose context fell below this share of the previous one is a fold. */
export const FOLD_SHRINK = 0.8;
/** Append to the list under `k` (linear; never copy the list). */
export function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const xs = m.get(k);
  if (xs) xs.push(v); else m.set(k, [v]);
}
