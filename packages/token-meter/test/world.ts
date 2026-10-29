// A small synthetic set of all four logs (meter, outcomes, assignments, guards) in the current schema,
// shared by the pi-analyse tests. Every number is chosen so the expected results can be computed by hand.
import type { Logs } from "../core/analyse.ts";

export const T0 = Date.parse("2026-10-05T10:00:00Z");
export const MIN = 60_000;
export const iso = (ms: number): string => new Date(ms).toISOString();

export function turn(sessionId: string, at: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { v: 1, ts: iso(at), sessionId, provider: "anthropic", model: "claude-opus", kind: "turn",
    input: 10, cacheRead: 1000, cacheWrite: 100, output: 50, costUsd: 1, status: 200, retries: 0, retryWaitMs: 0, ...extra };
}

/** `n` turns `gap` minutes apart from `start`; every line carries `extra`. */
export function turns(sessionId: string, start: number, n: number, extra: Record<string, unknown> = {}, gap = 10): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => turn(sessionId, start + i * gap * MIN, extra));
}

const V1 = { warmPolicy: ["native", "orchestrator-aware"], mainCacheTtl: ["5m", "1h"], foldHint: ["fixed", "cache-aware"], maskOnCold: ["off", "on"], freshOnCold: ["off", "advise"] };
const V2 = { ...V1, delegationRule: ["off", "on"] };
export function flagsOf(arm: string): Record<string, string> {
  const names = Object.entries(arm.length === 6 ? V2 : V1);
  return Object.fromEntries(names.map(([n, v], i) => [n, arm[i] === "+" ? v[1] : v[0]]));
}

/** v0 row (legacy: no v, no design) for v1 arms; v1 row with design "v2" for 6-char arms. */
export function assignment(sessionId: string, arm: string, at: number): Record<string, unknown> {
  const row = { ts: iso(at), sessionId, arm, mode: "explore", flags: flagsOf(arm) };
  return arm.length === 6 ? { v: 1, ...row, design: "v2" } : row;
}

/**
 * Roots (4 turns, 10 min apart → 0.5 active hours each):
 *   v1 (legacy lines, no v): m1 "-----" $1/turn, m2 "+++++" $2/turn
 *   v2: m3, m5 "------" $1/turn; m4, m6 "++++++" $3/turn
 * Children (spawned by the router): c1 under m3 (qwen, accepted), c2 under m4 (T1, rejected), c3 under m4 (T2, accepted, escalated from qwen).
 * Warming: one $0.5 warming line in m3. Quota: q5h rises 10 → 13 inside m3 (one window).
 */
export function world(): Logs {
  const legacy = (ls: Record<string, unknown>[]) => ls.map(({ v, ...l }) => l);
  const meter = [
    ...legacy(turns("m1", T0, 4, { arm: "-----", costUsd: 1 })),
    ...legacy(turns("m2", T0, 4, { arm: "+++++", costUsd: 2 })),
    ...turns("m3", T0 + 60 * MIN, 4, { arm: "------", costUsd: 1 }).map((l, i) => ({ ...l, q5h: 10 + i, q5hReset: 1 })),
    turn("m3", T0 + 65 * MIN, { arm: "------", kind: "warming", costUsd: 0.5, cacheWrite: 0, input: 0, output: 1 }),
    ...turns("m4", T0 + 60 * MIN, 4, { arm: "++++++", costUsd: 3, model: "claude-sonnet" }),
    ...turns("m5", T0 + 120 * MIN, 4, { arm: "------", costUsd: 1 }),
    ...turns("m6", T0 + 120 * MIN, 4, { arm: "++++++", costUsd: 3, model: "claude-sonnet" }),
    ...turns("c1", T0 + 61 * MIN, 2, { arm: "------", parentSessionId: "m3", costUsd: 0.1, provider: "openrouter", model: "qwen" }, 1),
    ...turns("c2", T0 + 61 * MIN, 2, { arm: "++++++", parentSessionId: "m4", costUsd: 0.5, model: "claude-sonnet" }, 1),
    ...turns("c3", T0 + 62 * MIN, 5, { arm: "++++++", parentSessionId: "m4", costUsd: 0.4, model: "claude-sonnet" }, 1),
  ];
  const spawn = (taskId: string, sessionId: string, parent: string, arm: string, workerTier: string, at: number) =>
    ({ v: 1, ts: iso(at), event: "spawn", taskId, cardHash: "h", kind: "implement", workerTier, workerEffort: "high", base: workerTier, importance: "normal", reasons: [], arm, sessionId, parentSessionId: parent });
  const outcomes = [
    spawn("t1", "c1", "m3", "------", "qwen", T0 + 61 * MIN),
    spawn("t2", "c2", "m4", "++++++", "T1", T0 + 61 * MIN),
    spawn("t3", "c3", "m4", "++++++", "T2", T0 + 62 * MIN),
    { v: 1, ts: iso(T0 + 62 * MIN), event: "escalate", taskId: "t3", from: "qwen", to: "T2", attemptOf: "t3" },
    { v: 1, ts: iso(T0 + 63 * MIN), event: "check", taskId: "t1", exit: 0, durationMs: 5 },
    { v: 1, ts: iso(T0 + 70 * MIN), event: "verdict", taskId: "t1", verdict: "accepted", note: "" },
    { v: 1, ts: iso(T0 + 70 * MIN), event: "verdict", taskId: "t2", verdict: "rejected", note: "" },
    { v: 1, ts: iso(T0 + 70 * MIN), event: "verdict", taskId: "t3", verdict: "accepted", note: "" },
  ];
  const assignments = [
    assignment("m1", "-----", T0 - MIN), assignment("m2", "+++++", T0 - MIN),
    assignment("m3", "------", T0 + 59 * MIN), assignment("m4", "++++++", T0 + 59 * MIN),
    assignment("m5", "------", T0 + 119 * MIN), assignment("m6", "++++++", T0 + 119 * MIN),
  ];
  const g = (sessionId: string, arm: string, event: string, at: number, value?: number) =>
    ({ v: 1, ts: iso(at), sessionId, arm, event, ...(value === undefined ? {} : { value }) });
  const guards = [
    g("m4", "++++++", "peek-after-mask", T0 + 70 * MIN), g("m4", "++++++", "correction", T0 + 71 * MIN),
    g("m6", "++++++", "correction", T0 + 130 * MIN), g("m3", "------", "rating", T0 + 90 * MIN, 5), g("m4", "++++++", "rating", T0 + 90 * MIN, 3),
  ];
  return { meter, outcomes, assignments, guards };
}
