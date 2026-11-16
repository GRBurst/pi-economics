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
  plans?: Plans;
  /** token-meter's `currency.rates` setting ("FROM/TO" → rate); absent = none: costs in different currencies stay apart. */
  currencyRates?: Record<string, number> };
/** Inclusive UTC days, YYYY-MM-DD. */
export type Period = { since?: string; until?: string };

export const LOGS: LogName[] = ["meter", "outcomes", "assignments", "guards"];
/** Schema version of a line; lines written before `v` existed are version 0. */
export const versionOf = (l: any): number => (Number.isInteger(l?.v) ? l.v : 0);

export const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export const isLine = (l: any): boolean => !!l && typeof l.ts === "string" && !Number.isNaN(Date.parse(l.ts));
/** A meter line of a request (turn, warming, nested, compaction): every line but a levers line (design §5.3), which only records settings. */
export const isRequestLine = (l: any): boolean => l?.kind !== "levers";
export const byTs = (a: any, b: any): number => Date.parse(a.ts) - Date.parse(b.ts);
export const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);
export const countBy = <T>(xs: T[], key: (x: T) => string): Record<string, number> => xs.reduce((m, x) => ((m[key(x)] = (m[key(x)] ?? 0) + 1), m), {} as Record<string, number>);

/** Meter, outcomes and guards lines whose UTC day is in the period; assignments are kept whole (they are looked up by session). */
export function inPeriod(logs: Logs, p: Period): Logs {
  const keep = (l: any) => isLine(l) && (p.since === undefined || l.ts.slice(0, 10) >= p.since) && (p.until === undefined || l.ts.slice(0, 10) <= p.until);
  return { ...logs, meter: logs.meter.filter(keep), outcomes: logs.outcomes.filter(keep), guards: logs.guards.filter(keep) };
}

/** Tokens of a line, missing or not a number = 0: whether the request got an answer at all. */
export const hasUsage = (l: any): boolean => ["input", "cacheRead", "cacheWrite", "output"].some((k) => typeof l[k] === "number" && l[k] > 0);
/**
 * An aborted request (pi ended the message with stopReason "aborted": Esc, or the retries given up) is no request and no error: the line has
 * `aborted: true` (meter line v2); history: a turn line of v0 to v2 with a numeric status and no token at all was written for one (a successful
 * response always has output). A warming, nested or compaction line is never one.
 */
export const isAborted = (l: any): boolean => l?.kind === "turn" && (l.aborted === true || (!(l.v > 2) && typeof l.status === "number" && !hasUsage(l)));
/** A failed request: the log line has no usage and is not a request (it is neither a fold, nor activity). An aborted one is not an error. */
export const isError = (l: any): boolean => l.status === "error" && !isAborted(l);
/** A request the readers count: not a warming, not a failed one, not an aborted one. */
export const isRequest = (l: any): boolean => l.kind !== "warming" && !isError(l) && !isAborted(l);
/** A warm turn whose context fell below this share of the previous one is a fold. */
export const FOLD_SHRINK = 0.8;
/** Append to the list under `k` (linear; never copy the list). */
export function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const xs = m.get(k);
  if (xs) xs.push(v); else m.set(k, [v]);
}
