// The internal channel (redesign §7.7): how the engine hands a session's assignment and its levers' read-back states
// to pi-economics' own add-ons, on pi.events, never a globalThis API. pi's bus runs a synchronous handler inside
// emit, so a query is answered before `query` returns. pi.events is one runtime's: a child's runtime has its own
// bus, on which experiments, loaded there too, serves the child's assignment (core/shell.ts, child mode).
import type { LeverState } from "../addons/types.ts";
import type { AssignmentV2 } from "./assign.ts";
import type { LeverId } from "./design.ts";

/** Payload Levers: every new or derived assignment, and every change of its levers' states. */
export const LEVERS = "pi-economics:levers:v1";
/** Payload LeversQuery: an add-on that started after the publish asks for a session's Levers. */
export const LEVERS_QUERY = "pi-economics:levers-query:v1";

/**
 * A session's assignment as the add-ons see it; a child's equals its parent's but for sessionId/parentSessionId, so a
 * child's `eligible` is its root unit's (the child runs the root's arm; it is no unit of its own: its levers line says
 * `eligible: false`). `parentSessionId` is set on children only (assignments rows never carry it). Read-only.
 */
export type Assigned = Pick<AssignmentV2, "sessionId" | "parentSessionId" | "design" | "stratum" | "arm" | "eligible" | "factors">;
/** An Assigned with the read-back state of each lever the engine set (§7.4): only levers whose target is loaded. */
export type Levers = Assigned & { levers: Record<LeverId, LeverState> };
/** `target`: the asking component when it is a lever target; its first query makes its levers live (§7.4). */
export type LeversQuery = { sessionId: string; target?: string; reply(a: Levers | undefined): void };
/** pi.events (EventBus): emit is synchronous; `on` returns the unsubscribe. */
export type Bus = { emit(channel: string, data: unknown): void; on(channel: string, handler: (data: any) => unknown): () => void };

export const publish = (bus: Bus, a: Levers): void => bus.emit(LEVERS, a);

export const onAssigned = (bus: Bus, l: (a: Levers) => void): (() => void) => bus.on(LEVERS, l);

/** The engine's side: answers every query from `lookup`; returns the unsubscribe. */
export const serve = (bus: Bus, lookup: (sessionId: string, target?: string) => Levers | undefined): (() => void) =>
  bus.on(LEVERS_QUERY, (q: LeversQuery) => {
    const a = lookup(q.sessionId, q.target);
    if (a !== undefined) q.reply(a);
  });

/** An add-on's side: the first answer to a query for `sessionId`; undefined when no engine knows the session (or none is loaded). */
export function query(bus: Bus, sessionId: string, target?: string): Levers | undefined {
  let answer: Levers | undefined;
  const q: LeversQuery = { sessionId, ...(target === undefined ? {} : { target }), reply: (a) => void (answer ??= a) };
  bus.emit(LEVERS_QUERY, q);
  return answer;
}
