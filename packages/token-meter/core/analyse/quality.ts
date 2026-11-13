// (e) data quality: the span of each log, schema versions, unjoinable lines, the data contract. (B11: the "pi share of the account quota" is gone; Budget replaces it.)
import { rootUnits } from "../arms.ts";
import { check, type Problem } from "../contract.ts";
import { countBy, inPeriod, isLine, isRequestLine, LOGS, sum, versionOf, type FileInfo, type LogName, type Logs, type Period } from "./logs.ts";
import { apiUsd } from "./units.ts";
import { rowsBySession } from "./designs.ts";

export type QualitySection = { period: Period & { first?: string; last?: string };
  logs: Array<{ log: LogName; lines: number; first?: string; last?: string; versions: Record<string, number> }>;
  files: FileInfo[]; withoutArm: { roots: number; usd: number; share: number; assigned: number; examples: string[] };
  unjoinable: Array<{ what: string; n: number; examples: string[] }>;
  problems: Problem[] };

/** The outcome events of a delegated task, which join its spawn by `taskId`; session-level lines (task-router's `force`,
 *  `taskId: ""`) are none (plan D20). */
const TASK_EVENTS = new Set(["reroute", "check", "corrective", "escalate", "verdict", "spotcheck"]);

export function quality(all: Logs, logs: Logs, period: Period): QualitySection {
  const meter = logs.meter.filter((l) => isLine(l) && isRequestLine(l) && typeof l.sessionId === "string");
  const ts = (ls: any[]) => ls.filter(isLine).map((l) => l.ts as string).sort();
  const span = [...ts(logs.meter), ...ts(logs.outcomes), ...ts(logs.guards)].sort();
  const rows = rowsBySession(all.assignments);
  const armedRoots = new Set(meter.filter((l) => typeof l.arm === "string" && l.arm).map((l) => l.parentSessionId ?? l.sessionId));
  const bare = rootUnits(meter).filter((u) => !armedRoots.has(u.root));
  const total = sum(meter.map((l) => apiUsd(l)));
  const meterSessions = new Set(all.meter.filter(isRequestLine).map((l) => l?.sessionId)); // a levers line alone is no request (M3b)
  const spawnAll = all.outcomes.filter((e) => e?.event === "spawn");
  const spawnTasks = new Set(spawnAll.map((e) => e.taskId));
  const spawnParents = new Set(spawnAll.map((e) => e.parentSessionId));
  const spawnChildren = new Set(spawnAll.map((e) => e.sessionId));
  const unspawned = [...new Set(meter.filter((l) => typeof l.parentSessionId === "string" && !spawnChildren.has(l.sessionId)).map((l) => l.sessionId))];
  const spawns = logs.outcomes.filter((e) => e?.event === "spawn");
  const inPer = inPeriod({ meter: [], outcomes: [], guards: all.assignments, assignments: [] }, period).guards;
  const item = (what: string, xs: any[], ex: (x: any) => string) => ({ what, n: xs.length, examples: [...new Set(xs.map(ex))].slice(0, 3) });
  const sets: Record<LogName, any[]> = { meter: logs.meter, outcomes: logs.outcomes, assignments: inPer, guards: logs.guards };
  return {
    period: { ...period, first: span[0], last: span.at(-1) },
    logs: LOGS.map((log) => ({ log, lines: sets[log].length, first: ts(sets[log])[0], last: ts(sets[log]).at(-1), versions: countBy(sets[log], (l) => String(versionOf(l))) })),
    files: all.files ?? [],
    withoutArm: { roots: bare.length, usd: sum(bare.map((u) => u.cost)), share: total ? sum(bare.map((u) => u.cost)) / total : NaN, assigned: bare.filter((u) => rows.has(u.root)).length, examples: bare.slice(0, 3).map((u) => u.root) },
    unjoinable: [
      item("meter child lines whose parent session is unknown", meter.filter((l) => typeof l.parentSessionId === "string" && !meterSessions.has(l.parentSessionId) && !spawnParents.has(l.parentSessionId)), (l) => l.parentSessionId),
      item("child sessions without a spawn event (their $ is in no tier)", unspawned, (s) => String(s)),
      item("spawns without a child session id", spawns.filter((e) => typeof e.sessionId !== "string"), (e) => e.taskId),
      item("spawns whose child session has no meter line", spawns.filter((e) => typeof e.sessionId === "string" && !meterSessions.has(e.sessionId)), (e) => e.sessionId),
      item("task events without a spawn", logs.outcomes.filter((e) => TASK_EVENTS.has(e?.event) && !spawnTasks.has(e?.taskId)), (e) => String(e?.taskId)),
      item("guard events of sessions without meter lines", logs.guards.filter((e) => !meterSessions.has(e?.sessionId)), (e) => String(e?.sessionId)),
      item("assignments of sessions without meter lines", inPer.filter((r) => !meterSessions.has(r?.sessionId)), (r) => String(r?.sessionId)),
    ],
    problems: check({ ...logs, assignments: inPer }, all),
  };
}
