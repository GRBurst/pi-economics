// $ per accepted task (spec §5.6.3, routing metric). Pure; reads the meter log and the task-router outcome log as plain events.
export type TaskCost = { accepted: number; judged: number; costUsd: number; perAccepted: number };

const MAX_DEPTH = 64;

export type TaskRecord = { arm: string; session: string; /** The task's last verdict, if any. */ verdict?: string; /** Cost of the child's subtree, warming included. */ cost: number };

/**
 * One record per task whose spawn event carries a string `arm` and the child's `sessionId` (the caller chooses what `arm` means: the arm, the
 * tier, …). A task's subtree = the child session named by its spawn event and every meter session below it (`parentSessionId` chain).
 */
export function taskRecords(meter: any[], outcomes: any[]): Map<string, TaskRecord> {
  const parent = new Map<string, string>();
  for (const l of meter) if (typeof l?.sessionId === "string" && typeof l.parentSessionId === "string") parent.set(l.sessionId, l.parentSessionId);
  const task = new Map<string, { arm: string; session: string }>();
  const last = new Map<string, string>();
  for (const e of outcomes) {
    if (e?.event === "spawn" && typeof e.taskId === "string" && typeof e.arm === "string" && typeof e.sessionId === "string") task.set(e.taskId, { arm: e.arm, session: e.sessionId });
    if (e?.event === "verdict" && typeof e.taskId === "string") last.set(e.taskId, e.verdict);
  }
  const cost = new Map<string, number>(); // child session → subtree cost
  const roots = new Set([...task.values()].map((t) => t.session));
  for (const l of meter) {
    if (typeof l?.sessionId !== "string" || typeof l.costUsd !== "number") continue;
    const seen = new Set<string>(); // each ancestor once, whatever the chain looks like
    for (let i = 0, s: string | undefined = l.sessionId; s !== undefined && i < MAX_DEPTH && !seen.has(s); i++, s = parent.get(s)) {
      seen.add(s);
      if (roots.has(s)) cost.set(s, (cost.get(s) ?? 0) + l.costUsd);
    }
  }
  return new Map([...task].map(([id, t]) => [id, { ...t, verdict: last.get(id), cost: cost.get(t.session) ?? 0 }]));
}

/**
 * Per arm (the arm logged on the task's spawn event): the cost of the subtrees of its judged tasks ÷ its accepted tasks, so that
 * rejected and partial work is paid for by the accepted tasks. Tasks without a session id, and unjudged ones, are left out of
 * numerator and denominator alike; the last verdict of a task counts.
 */
export function taskCosts(meter: any[], outcomes: any[]): Record<string, TaskCost> {
  const out: Record<string, TaskCost> = {};
  for (const t of taskRecords(meter, outcomes).values()) {
    if (t.verdict === undefined || !["accepted", "partial", "rejected"].includes(t.verdict)) continue;
    const o = (out[t.arm] ??= { accepted: 0, judged: 0, costUsd: 0, perAccepted: NaN });
    o.judged += 1;
    o.costUsd += t.cost;
    if (t.verdict === "accepted") o.accepted += 1;
  }
  for (const o of Object.values(out)) o.perAccepted = o.accepted ? o.costUsd / o.accepted : NaN;
  return out;
}
