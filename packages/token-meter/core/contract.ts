// The data contract of pi's logs (<agentDir>/LOGS.md): the fields pi-analyse needs, per log, event and
// schema version. `check` reports every required field missing from lines of the period; `pi-analyse --check` exits
// non-zero on any. Relational rules (parentSessionId, arm) are what the joins need, so they are checked against the
// other logs: a child named by a spawn event must carry its parent; a session whose root has an experiment assignment
// must carry the arm from that assignment on.
import type { LogName, Logs } from "./analyse.ts";

export type Problem = { log: LogName; field: string; why: string; count: number; example: string };

const str = (v: unknown) => typeof v === "string" && v.length > 0;
const numb = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const time = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));
const oneOf = (...xs: unknown[]) => (v: unknown) => xs.includes(v);
const obj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);

type Rule = { field: string; why: string; when?: (l: any) => boolean; ok: (v: any, l: any) => boolean };
const every = (fields: Record<string, (v: any) => boolean>, why: string, when?: (l: any) => boolean): Rule[] =>
  Object.entries(fields).map(([field, ok]) => ({ field, why, when, ok }));
/** Optional fields: never required, only their type is checked when present. */
const optional = (fields: Record<string, (v: any) => boolean>, why: string, when?: (l: any) => boolean): Rule[] =>
  Object.entries(fields).map(([field, ok]) => ({ field, why: `optional: ${why}`, when: (l) => (!when || when(l)) && field in l, ok }));
const versioned: Rule = { field: "v", why: "schema version, an integer when present", ok: (v, l) => !("v" in l) || Number.isInteger(v) };

const METER: Rule[] = [
  versioned,
  ...every({ ts: time, sessionId: str, provider: str, model: str, kind: oneOf("turn", "warming", "nested"), status: (v) => numb(v) || v === "error", retries: numb, retryWaitMs: numb }, "every meter line"),
  ...every({ input: numb, cacheRead: numb, cacheWrite: numb, output: numb, costUsd: numb }, "usage of a successful request", (l) => l.status !== "error"),
];
const OUTCOMES: Rule[] = [
  versioned,
  ...every({ ts: time, event: oneOf("spawn", "reroute", "check", "corrective", "escalate", "verdict", "spotcheck"), taskId: str }, "every outcome event"),
  ...every({ kind: str, workerTier: str, workerEffort: str, sessionId: str, parentSessionId: str }, "spawn: tier mix, child-session join", (l) => l.event === "spawn"),
  ...optional({ assigned: oneOf("router", "random"), routeBase: str, unresolved: (v) => typeof v === "boolean", cwd: str, reviewOf: str }, "spawn: randomized routing, unresolved cards, working directory, spot-check review", (l) => l.event === "spawn"),
  ...every({ verdict: oneOf("accepted", "partial", "rejected", "unjudged") }, "verdict", (l) => l.event === "verdict"),
  ...optional({ reviewOf: str }, "verdict of a spot-check review: the task reviewed", (l) => l.event === "verdict"),
  ...optional({ requested: (v) => v === true }, "spotcheck: requested is true", (l) => l.event === "spotcheck"),
  ...every({ exit: numb }, "check", (l) => l.event === "check"),
  ...every({ from: str, to: str }, "escalate/reroute", (l) => l.event === "escalate" || l.event === "reroute"),
];
const ASSIGNMENTS: Rule[] = [
  versioned,
  ...every({ ts: time, sessionId: str, arm: str, mode: str, flags: obj }, "every assignment"),
  ...every({ design: str }, "design of a v ≥ 1 assignment (v1 vs v2 arms)", (l) => Number.isInteger(l.v) && l.v >= 1),
];
const GUARDS: Rule[] = [
  versioned,
  ...every({ ts: time, sessionId: str, event: oneOf("peek-after-mask", "correction", "rating") }, "every guard event"),
  ...every({ value: (v) => Number.isInteger(v) && v >= 1 && v <= 5 }, "rating value 1–5", (l) => l.event === "rating"),
];

const MAX_DEPTH = 64;

/** Problems in `logs` (the period); `all` (every line read) resolves joins across the period edge. */
export function check(logs: Logs, all: Logs = logs): Problem[] {
  const parent = new Map<string, string>();
  for (const e of all.outcomes) if (e?.event === "spawn" && str(e.sessionId) && str(e.parentSessionId)) parent.set(e.sessionId, e.parentSessionId);
  for (const l of all.meter) if (str(l?.sessionId) && str(l.parentSessionId)) parent.set(l.sessionId, l.parentSessionId);
  const assigned = new Map<string, number>();
  for (const r of all.assignments) if (str(r?.sessionId) && time(r.ts) && !assigned.has(r.sessionId)) assigned.set(r.sessionId, Date.parse(r.ts));
  /** An arm is due when the session or an ancestor was assigned one at or before `ts`. */
  const armDue = (sid: unknown, ts: unknown): boolean => {
    if (!str(sid) || !time(ts)) return false;
    const seen = new Set<string>();
    for (let s: string | undefined = sid as string, i = 0; s !== undefined && i < MAX_DEPTH && !seen.has(s); i++, s = parent.get(s)) {
      seen.add(s);
      const at = assigned.get(s);
      if (at !== undefined && at <= Date.parse(ts as string)) return true;
    }
    return false;
  };
  const children = new Set(all.outcomes.filter((e) => e?.event === "spawn" && str(e.sessionId)).map((e) => e.sessionId));
  const arm: Rule = { field: "arm", why: "the session's root has an experiment assignment", ok: str };
  const rules: Record<LogName, Rule[]> = {
    meter: [...METER, { field: "parentSessionId", why: "a spawn event names this session as a child", when: (l) => children.has(l.sessionId), ok: str },
      { ...arm, when: (l) => armDue(l.parentSessionId ?? l.sessionId, l.ts) || armDue(l.sessionId, l.ts) }],
    outcomes: [...OUTCOMES, { ...arm, why: "spawn whose parent session has an experiment assignment", when: (l) => l.event === "spawn" && armDue(l.parentSessionId, l.ts) }],
    assignments: ASSIGNMENTS,
    guards: [...GUARDS, { ...arm, when: (l) => armDue(l.sessionId, l.ts) }],
  };
  const out: Problem[] = [];
  for (const log of Object.keys(rules) as LogName[]) {
    for (const r of rules[log]) {
      const bad = logs[log].filter((l) => l && typeof l === "object" && (!r.when || r.when(l)) && !r.ok(l[r.field], l));
      if (bad.length) out.push({ log, field: r.field, why: r.why, count: bad.length, example: [bad[0].sessionId ?? bad[0].taskId, bad[0].ts].filter(Boolean).join(" @ ") || JSON.stringify(bad[0]).slice(0, 80) });
    }
  }
  return out;
}

export const renderProblems = (ps: Problem[]): string =>
  ps.length ? ps.map((p) => `${p.log}: ${p.count} line(s) miss ${p.field} (${p.why}; e.g. ${p.example})`).join("\n") + "\n" : "contract ok: every required field present\n";
