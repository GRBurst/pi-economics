// Pure: joins provider-response snapshots to the message_end that consumes them, strictly per sessionId.
// (M3a, D19: the retry-id pairing of the retry extension's bus events left with it; native retries are counted in shell.ts.)
import type { Snapshot } from "./ratelimit.ts";

export class Joiner {
  #snaps = new Map<string, Snapshot>();

  /** Replaces the pending snapshot of this session. */
  onResponse(sessionId: string, s: Snapshot): void {
    this.#snaps.set(sessionId, s);
  }

  /** Returns and clears what is pending for this session. */
  take(sessionId: string): { snap?: Snapshot } {
    const snap = this.#snaps.get(sessionId);
    this.#snaps.delete(sessionId);
    return snap ? { snap } : {};
  }
}
