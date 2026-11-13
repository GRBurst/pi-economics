// The part of the actor-subagents API (patch api.ts) this package reads, as an own copy:
// packages stay portable, so nothing is imported across them. Types only.
export type AgentInfo = {
  name: string; parent: string; sessionId: string; model: string; thinkingLevel: string | undefined;
  state: "running" | "idle" | "paused"; idleSinceMs?: number; lastRequestAt?: number; contextTokens?: number; costUsd?: number; policyMeta?: unknown;
};
/** The events of the API's `subscribe` this package reads (the others are listed only to keep the union closed). */
export type ApiEvent =
  | { type: "route"; from: string; to: string; buffered: boolean }
  | { type: "kill"; name: string }
  | { type: "spawn" | "turn" | "pause" | "resume" | "error" };
export interface SubagentsApiV1 {
  list(): AgentInfo[];
  subscribe(l: (e: ApiEvent) => void): () => void;
}

// The internal channel of pi-economics (redesign §7.7; experiments' core/channel.ts), as this package reads it: an own
// copy of the names and of the parts of the payload it reads; the internal-channel check holds the copy to the source.
/** Payload Levers: a session's assignment (and its levers' states) whenever the engine assigns, derives or reads back. */
export const LEVERS = "pi-economics:levers:v1";
/** Payload LeversQuery: asks the engine for a session's Levers; answered synchronously. */
export const LEVERS_QUERY = "pi-economics:levers-query:v1";
export type Level = string | number | boolean;
/** What cache-lifecycle reads of a Levers payload: the arm and design (guard lines), a child's parent, the factors. */
export type Levers = {
  sessionId: string;
  parentSessionId?: string;
  design?: string;
  arm?: string;
  factors?: Record<string, { lever: string; assigned: Level }>;
};
export type LeversQuery = { sessionId: string; target?: string; reply(a: Levers | undefined): void };
