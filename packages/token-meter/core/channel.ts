// The internal channel of pi-economics (redesign §7.7; experiments' core/channel.ts), as the meter reads it: an own copy
// of the names and of the parts of the payload it reads (packages do not import each other); the internal-channel
// check holds the copy to the source. Types and names only.
import type { LeverId, LeverState } from "./levers.ts";

/** Payload Levers: a session's assignment and its levers' states, whenever the engine assigns, derives or reads back. */
export const LEVERS = "pi-economics:levers:v1";
/** Payload LeversQuery: asks the engine for a session's Levers; answered synchronously inside emit. */
export const LEVERS_QUERY = "pi-economics:levers-query:v1";

/** What the meter reads of a Levers payload (a child's `eligible` is its root unit's; its line says false). */
export type Levers = {
  sessionId: string;
  parentSessionId?: string;
  design?: string;
  stratum?: string;
  arm?: string;
  eligible: boolean;
  levers: Record<LeverId, LeverState>;
};
export type LeversQuery = { sessionId: string; target?: string; reply(a: Levers | undefined): void };
/** pi.events: emit runs the handlers synchronously; `on` returns the unsubscribe. */
export type Bus = { emit(channel: string, data: unknown): void; on(channel: string, handler: (data: any) => unknown): () => void };
