// Pure: builds the allowlisted meter line and serializes it (bounded size).
import { isAbsolute, join } from "node:path";
import { parseRatelimit } from "./ratelimit.ts";
import type { Quota, Snapshot } from "./ratelimit.ts";

export type Usage = { input: number; cacheRead: number; cacheWrite: number;
  output: number; reasoning?: number; costUsd?: number };
/** `errorMessage` is only the source for `errorClass`; its text is never copied into a line. */
export type LineInput = { now: Date; sessionId: string; parentSessionId?: string; arm?: string;
  provider: string; model: string; effort?: string; kind: "turn" | "warming" | "nested";
  usage?: Usage; status: number | "error"; retries: number; retryWaitMs: number; snap?: Snapshot;
  errorMessage?: string };
export type MeterLine = { ts: string; sessionId: string; parentSessionId?: string; arm?: string;
  provider: string; model: string; effort?: string; kind: LineInput["kind"];
  input?: number; cacheRead?: number; cacheWrite?: number; output?: number; reasoning?: number;
  costUsd?: number; status: number | "error"; retries: number; retryWaitMs: number;
  errorClass?: string } & Omit<Quota, "raw"> & { rawRatelimit?: Record<string, string> };

const MAX_STR = 256;
const MAX_BYTES = 4096;
/** Schema version of a meter line (LOGS.md); readers treat an absent `v` as 0 (legacy). */
export const SCHEMA_VERSION = 1;
const KEYS = ["v", "ts", "sessionId", "parentSessionId", "arm", "provider", "model", "effort", "kind",
  "input", "cacheRead", "cacheWrite", "output", "reasoning", "costUsd", "status", "retries", "retryWaitMs",
  "errorClass", "q5h", "q5hReset", "q7d", "q7dReset", "overage", "claim", "fallback", "rawRatelimit"] as const;

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

function errorClassOf(message: string | undefined): string {
  const m = /^\s*(\d{3})(?!\d)/.exec(message ?? "");
  return m ? m[1] : "error";
}

/** Only allowlisted fields are ever copied; free text (message bodies) never enters a line. */
export function buildLine(i: LineInput): MeterLine {
  const l: Record<string, unknown> = {
    v: SCHEMA_VERSION, ts: i.now.toISOString(), sessionId: i.sessionId, provider: i.provider, model: i.model, kind: i.kind,
  };
  if (i.parentSessionId !== undefined) l.parentSessionId = i.parentSessionId;
  if (i.arm !== undefined) l.arm = i.arm;
  if (i.effort !== undefined) l.effort = i.effort;
  for (const k of ["input", "cacheRead", "cacheWrite", "output", "reasoning", "costUsd"] as const) {
    const v = i.usage?.[k];
    if (v !== undefined) l[k] = v;
  }
  l.status = i.status;
  l.retries = i.retries;
  l.retryWaitMs = i.retryWaitMs;
  if (i.status === "error") l.errorClass = errorClassOf(i.errorMessage);
  if (i.snap) {
    const { raw, ...quota } = parseRatelimit(i.snap.headers);
    Object.assign(l, quota);
    if (Object.keys(raw).length > 0) l.rawRatelimit = raw;
  }
  return limitStrings(l, MAX_STR) as MeterLine;
}

/** Allowlist keys and clip every string value to `max` chars. */
function limitStrings(l: Record<string, unknown>, max: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of KEYS) {
    const v = l[k];
    if (v === undefined) continue;
    if (typeof v === "string") out[k] = clip(v, max);
    else if (k === "rawRatelimit" && v && typeof v === "object")
      out[k] = Object.fromEntries(Object.entries(v).map(([a, b]) => [a, clip(String(b), max)]));
    else out[k] = v;
  }
  return out;
}

/** One JSON line + "\n", < 4096 bytes: drop rawRatelimit first, then shrink string values. */
export function serialize(l: MeterLine): string {
  let cur = limitStrings({ ...l }, MAX_STR);
  const size = (o: Record<string, unknown>) => Buffer.byteLength(JSON.stringify(o)) + 1;
  if (size(cur) >= MAX_BYTES) {
    delete cur.rawRatelimit;
    for (let max = MAX_STR / 2; size(cur) >= MAX_BYTES && max >= 1; max = Math.floor(max / 2))
      cur = limitStrings(cur, max);
  }
  return JSON.stringify(cur) + "\n";
}

/** <agentDir>/<dir>/YYYY-MM.jsonl by UTC month; an absolute `dir` is used as is. */
export function monthFile(agentDir: string, now: Date, dir = "meter"): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return join(isAbsolute(dir) ? dir : join(agentDir, dir), `${y}-${m}.jsonl`);
}
