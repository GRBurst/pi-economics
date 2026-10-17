// Pure: joins provider-response snapshots and retry events to the message_end that consumes them,
// strictly per sessionId.
import type { Snapshot } from "./ratelimit.ts";

type State = { snap?: Snapshot; open: Map<string, number>; closed: Set<string>; retries: number; retryWaitMs: number };

export class Joiner {
  #sessions = new Map<string, State>();

  #state(sessionId: string): State {
    let s = this.#sessions.get(sessionId);
    if (!s) this.#sessions.set(sessionId, (s = { open: new Map(), closed: new Set(), retries: 0, retryWaitMs: 0 }));
    return s;
  }

  /** Replaces the pending snapshot of this session. */
  onResponse(sessionId: string, s: Snapshot): void {
    this.#state(sessionId).snap = s;
  }

  onRetryStart(sessionId: string, retryId: string, at: number): void {
    const s = this.#state(sessionId);
    s.closed.delete(retryId); // a fresh start reopens the id (numeric ids can be reused)
    s.open.set(retryId, at);
  }

  /** Completed and cancelled both end a retry; an end without a start is ignored.
   * Ends for ids already closed by closeOpen() are dropped: the episode was counted
   * on the message_end that consumed it. */
  onRetryEnd(sessionId: string, retryId: string, at: number): void {
    const s = this.#state(sessionId);
    if (s.closed.has(retryId)) {
      s.closed.delete(retryId);
      s.open.delete(retryId);
      return;
    }
    const start = s.open.get(retryId);
    if (start === undefined) return;
    s.open.delete(retryId);
    s.retries += 1;
    s.retryWaitMs += Math.max(0, at - start);
  }

  /** D8: closes every open episode of this session at `at` (one retry each,
   * wait += at − start) and remembers the closed ids, so the pi-retry
   * `completed`/`cancelled` that arrives AFTER the retried request's message_end
   * is not counted again. Call only from a NON-error message_end; error ends
   * keep the episodes open (the retried request may still fail). */
  closeOpen(sessionId: string, at: number): void {
    const s = this.#sessions.get(sessionId);
    if (!s) return;
    for (const [id, start] of [...s.open]) {
      if (s.closed.has(id)) { s.open.delete(id); continue; } // stale entry, already counted
      s.retries += 1;
      s.retryWaitMs += Math.max(0, at - start);
      s.closed.add(id);
    }
  }

  /** Returns and clears what is pending for this session. Open (or closed, not
   * yet confirmed by a late end) retries stay for the next take(): pi-retry
   * may report `completed` after the retried request's message_end. */
  take(sessionId: string): { snap?: Snapshot; retries: number; retryWaitMs: number } {
    const s = this.#sessions.get(sessionId);
    this.#sessions.delete(sessionId);
    if (!s) return { retries: 0, retryWaitMs: 0 };
    if (s.open.size > 0 || s.closed.size > 0) this.#sessions.set(sessionId, { open: s.open, closed: s.closed, retries: 0, retryWaitMs: 0 });
    const out: { snap?: Snapshot; retries: number; retryWaitMs: number } = { retries: s.retries, retryWaitMs: s.retryWaitMs };
    if (s.snap) out.snap = s.snap;
    return out;
  }
}
