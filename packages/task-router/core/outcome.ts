// Outcome log events (spec §5.2.7, R2): allowlisted keys, bounded strings, no card or prompt text.
import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import type { Role, TicketRole } from "./local/overseer.ts";
import type { Trip } from "./local/tripwires.ts";
import type { Card, LoggedPlan, Start, ThinkingLevel } from "./types.ts";

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
  // local mode L2 (design §3.0.3): the force line; a forced spawn's source and what routing would have chosen
  "action", "source", "model", "effort", "forced", "forceSource", "routedModel", "routedEffort",
  // local mode L3 (design §3.0.3): the hint line
  "trip", "stage", "count",
  // local mode L4 (design §3.0.3): the review line; a ticket child's spawn line names its ticket role
  "role", "member", "outcome", "blocking", "findings", "fallback", "inconsistent", "attempt", "commit", "branch", "ticket",
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

/** `workerTier`/`workerEffort` are the planned leg (RD2); `start` is what the child started on (a routed spawn only; a forced
 *  non-member has no member, so no `workerMember`, plan D10); `forced`: the force it ran under and the routed counterfactual. */
export const spawnEvent = (i: { now: Date; taskId: string; card: Card; plan: LoggedPlan; start?: Start; arm?: string; sessionId?: string; parentSessionId?: string; attemptOf?: string; unresolved?: boolean; forced?: Forced }) =>
  finish({
    ...base("spawn", i.now, i.taskId), cardHash: cardHash(i.card), kind: i.card.kind,
    workerTier: i.plan.worker.tier, workerEffort: i.plan.worker.effort,
    reviewTier: i.plan.review?.tier, reviewEffort: i.plan.review?.effort,
    ability: i.plan.ability, level: i.plan.level, draft: i.plan.draft, workerLevel: i.plan.worker.level, reviewLevel: i.plan.review?.level,
    workerMember: i.start?.member || undefined, workerModel: i.start?.model, startEffort: i.start?.effort, waitMs: i.start?.waitMs,
    base: i.plan.base, importance: i.plan.importance, reasons: i.plan.reasons,
    arm: i.arm, sessionId: i.sessionId, parentSessionId: i.parentSessionId, attemptOf: i.attemptOf ?? i.card.attemptOf,
    assigned: i.plan.assigned, routeBase: i.plan.routeBase, unresolved: i.unresolved || undefined, reviewOf: i.card.reviewOf,
    ...(i.forced ? { forced: true, forceSource: i.forced.source, routedModel: i.forced.routedModel, routedEffort: i.forced.routedEffort } : {}),
  });
/** A failover's line: the routes and, when known, the models on both (spec §6.4). */
export const rerouteEvent = (i: { now: Date; taskId: string; from: string; to: string; reason: string; fromModel?: string; toModel?: string }) =>
  finish({ ...base("reroute", i.now, i.taskId), from: i.from, to: i.to, reason: i.reason, fromModel: i.fromModel, toModel: i.toModel });
export const checkEvent = (i: { now: Date; taskId: string; exit: number; durationMs: number }) =>
  finish({ ...base("check", i.now, i.taskId), exit: i.exit, durationMs: i.durationMs });
export const correctiveEvent = (i: { now: Date; taskId: string }) => finish(base("corrective", i.now, i.taskId));
/** The escalate line's router fields (spec §6.4): the models on both routes, the re-spawn's ability, the levels. */
export type EscalateFields = { fromModel?: string; toModel?: string; ability?: string; fromLevel?: number; toLevel?: number };
export const escalateEvent = (i: { now: Date; taskId: string; from: string; to: string; attemptOf?: string } & EscalateFields) =>
  finish({
    ...base("escalate", i.now, i.taskId), from: i.from, to: i.to, attemptOf: i.attemptOf,
    fromModel: i.fromModel, toModel: i.toModel, ability: i.ability, fromLevel: i.fromLevel, toLevel: i.toLevel,
  });
export const verdictEvent = (i: { now: Date; taskId: string; verdict: Verdict; note?: string; reviewOf?: string }) =>
  finish({ ...base("verdict", i.now, i.taskId), verdict: i.verdict, note: i.note, reviewOf: i.reviewOf });
export const spotcheckEvent = (i: { now: Date; taskId: string }) => finish({ ...base("spotcheck", i.now, i.taskId), requested: true });
export type ForceAction = "set" | "clear" | "used" | "expired" | "rejected";
export type ForceSource = "command" | "settings";
export type Forced = { source: ForceSource; routedModel: string; routedEffort: ThinkingLevel };
/** A session-level line (design §3.0.3): `taskId: ""`; `model` is a model reference, never the command's text. */
export const forceEvent = (i: { now: Date; action: ForceAction; source: ForceSource; model?: string; effort?: string; reason?: "unknown-model" | "usage" }) =>
  finish({ ...base("force", i.now, ""), action: i.action, source: i.source, model: i.model, effort: i.effort, reason: i.reason });

export type HintStage = "hint" | "steer" | "parent";
/** A hint (design §3.1.2, §3.0.3): `taskId` is "main" or the child's name; the trip and stage, never the hint's text. */
export const hintEvent = (i: { now: Date; taskId: string; trip: Trip; stage: HintStage; count?: number; sessionId?: string }) =>
  finish({ ...base("hint", i.now, i.taskId), trip: i.trip, stage: i.stage, count: i.count, sessionId: i.sessionId });

export type ReviewOutcome = "approve" | "revise" | "invalid" | "timeout" | "error";
export type ReviewInput = { reviewId: string; role: Role; member: string; model: string; outcome: ReviewOutcome; attempt: number; durationMs: number;
  fallback?: "budget" | "error"; findings?: number; blocking?: number; inconsistent?: boolean; commit?: string; branch?: string };
/** One overseer attempt (design §3.0.3): `taskId` is the review id; the verdict's counts and flags, never its text. */
export const reviewEvent = (i: ReviewInput & { now: Date }) =>
  finish({
    ...base("review", i.now, i.reviewId), role: i.role, member: i.member, model: i.model, outcome: i.outcome, attempt: i.attempt,
    durationMs: i.durationMs, fallback: i.fallback, findings: i.findings, blocking: i.blocking, inconsistent: i.inconsistent,
    commit: i.commit, branch: i.branch,
  });
/** A ticket child's spawn line (D26): no card, so no `cardHash`; kind `overseer` (a fixer: `implement`), `ticket` its role. */
export const ticketSpawnEvent = (i: { now: Date; taskId: string; role: TicketRole; member: string; tier: string; model: string; effort: ThinkingLevel; arm?: string; sessionId?: string; parentSessionId?: string }) =>
  finish({
    ...base("spawn", i.now, i.taskId), kind: i.role === "fixer" ? "implement" : "overseer", ticket: i.role,
    workerTier: i.tier, workerEffort: i.effort, workerMember: i.member, workerModel: i.model, arm: i.arm, sessionId: i.sessionId, parentSessionId: i.parentSessionId,
  });

export const serializeEvent = (e: OutcomeEvent): string => `${JSON.stringify(e)}\n`;

/** <agentDir>/task-router/outcomes/YYYY-MM.jsonl by UTC month; an absolute `dir` is used as is. */
export function outcomeFile(agentDir: string, now: Date, dir = "task-router/outcomes"): string {
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return join(isAbsolute(dir) ? dir : join(agentDir, dir), `${now.getUTCFullYear()}-${m}.jsonl`);
}
