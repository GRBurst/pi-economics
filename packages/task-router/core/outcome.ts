// Outcome log events (spec §5.2.7, R2): allowlisted keys, bounded strings, no card or prompt text.
import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import type { Card, LoggedPlan, Start } from "./types.ts";

export type OutcomeEvent = Record<string, string | number | boolean | string[]>;
export type Verdict = "accepted" | "partial" | "rejected" | "unjudged";

/** Schema version of an outcome event (LOGS.md); readers treat an absent `v` as 0 (legacy). */
export const SCHEMA_VERSION = 1;
const KEYS = [
  "v", "ts", "event", "taskId", "cardHash", "kind", "workerTier", "workerEffort", "reviewTier", "reviewEffort",
  "base", "importance", "reasons", "arm", "sessionId", "parentSessionId", "attemptOf", "from", "to", "reason",
  "exit", "durationMs", "verdict", "note",
  // optional, T5.20
  "unresolved", "assigned", "routeBase", "reviewOf", "requested",
  // optional, router 2026-10-17 (spec §6.4): requirement, levels, started member, model, effort, wait; reroute/escalate models, levels
  "ability", "level", "draft", "workerLevel", "reviewLevel", "workerMember", "workerModel", "startEffort", "waitMs",
  "fromModel", "toModel", "fromLevel", "toLevel",
];
const MAX_STR = 256;
const MAX_ITEMS = 20;
const clip = (s: string) => s.slice(0, MAX_STR);

/** Only allowlisted keys, strings clipped, undefined dropped. */
function finish(raw: Record<string, unknown>): OutcomeEvent {
  const out: OutcomeEvent = {};
  for (const k of KEYS) {
    const v = raw[k];
    if (typeof v === "string") out[k] = clip(v);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, MAX_ITEMS).map((x) => clip(String(x)));
  }
  return out;
}

const base = (event: string, now: Date, taskId: string) => ({ v: SCHEMA_VERSION, ts: now.toISOString(), event, taskId });

/** Hash of the card; the card text itself is never logged. */
export const cardHash = (c: Card): string => createHash("sha256").update(JSON.stringify(c)).digest("hex").slice(0, 16);

/** `workerTier`/`workerEffort` are the planned leg (RD2); `start` is what the child started on (a routed spawn only). */
export const spawnEvent = (i: { now: Date; taskId: string; card: Card; plan: LoggedPlan; start?: Start; arm?: string; sessionId?: string; parentSessionId?: string; attemptOf?: string; unresolved?: boolean }) =>
  finish({
    ...base("spawn", i.now, i.taskId), cardHash: cardHash(i.card), kind: i.card.kind,
    workerTier: i.plan.worker.tier, workerEffort: i.plan.worker.effort,
    reviewTier: i.plan.review?.tier, reviewEffort: i.plan.review?.effort,
    ability: i.plan.ability, level: i.plan.level, draft: i.plan.draft, workerLevel: i.plan.worker.level, reviewLevel: i.plan.review?.level,
    workerMember: i.start?.member, workerModel: i.start?.model, startEffort: i.start?.effort, waitMs: i.start?.waitMs,
    base: i.plan.base, importance: i.plan.importance, reasons: i.plan.reasons,
    arm: i.arm, sessionId: i.sessionId, parentSessionId: i.parentSessionId, attemptOf: i.attemptOf ?? i.card.attemptOf,
    assigned: i.plan.assigned, routeBase: i.plan.routeBase, unresolved: i.unresolved || undefined, reviewOf: i.card.reviewOf,
  });
export const rerouteEvent = (i: { now: Date; taskId: string; from: string; to: string; reason: string }) =>
  finish({ ...base("reroute", i.now, i.taskId), from: i.from, to: i.to, reason: i.reason });
export const checkEvent = (i: { now: Date; taskId: string; exit: number; durationMs: number }) =>
  finish({ ...base("check", i.now, i.taskId), exit: i.exit, durationMs: i.durationMs });
export const correctiveEvent = (i: { now: Date; taskId: string }) => finish(base("corrective", i.now, i.taskId));
export const escalateEvent = (i: { now: Date; taskId: string; from: string; to: string; attemptOf?: string }) =>
  finish({ ...base("escalate", i.now, i.taskId), from: i.from, to: i.to, attemptOf: i.attemptOf });
export const verdictEvent = (i: { now: Date; taskId: string; verdict: Verdict; note?: string; reviewOf?: string }) =>
  finish({ ...base("verdict", i.now, i.taskId), verdict: i.verdict, note: i.note, reviewOf: i.reviewOf });
export const spotcheckEvent = (i: { now: Date; taskId: string }) => finish({ ...base("spotcheck", i.now, i.taskId), requested: true });

export const serializeEvent = (e: OutcomeEvent): string => `${JSON.stringify(e)}\n`;

/** <agentDir>/task-router/outcomes/YYYY-MM.jsonl by UTC month; an absolute `dir` is used as is. */
export function outcomeFile(agentDir: string, now: Date, dir = "task-router/outcomes"): string {
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return join(isAbsolute(dir) ? dir : join(agentDir, dir), `${now.getUTCFullYear()}-${m}.jsonl`);
}
