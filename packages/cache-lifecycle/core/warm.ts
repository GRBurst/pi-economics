// Idle prompt-cache warming policy (spec §5.3): pure decision table.

export type WarmInput = {
  role: "main" | "child";
  runningChildren: number;
  /** A child has sent a message and waits for the answer. */
  awaitingReply: boolean;
  /** Paused or killed child: nothing will use its cache. */
  finished: boolean;
  /** Time since the session's last real message (warm pings do not count). */
  idleMs: number;
  capMs: number;
};

/** "warm" / "stop" override pi's native rule; undefined defers to it. */
export function decideWarm(w: WarmInput): "warm" | "stop" | undefined {
  if (w.finished || w.idleMs >= w.capMs) return "stop";
  if (w.role === "main" && w.runningChildren > 0) return "warm";
  if (w.role === "child" && w.awaitingReply) return "warm";
  return undefined;
}
