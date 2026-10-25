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
