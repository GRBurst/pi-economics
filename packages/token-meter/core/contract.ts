// The data contract of pi's logs (<agentDir>/LOGS.md): the fields pi-analyse needs, per log, event and
// schema version. `check` reports every required field missing from lines of the period; `pi-analyse --check` exits
// non-zero on any. Relational rules (parentSessionId, arm) are what the joins need, so they are checked against the
// other logs: a child named by a spawn event must carry its parent; a session whose root has an experiment assignment
// must carry the arm from that assignment on.
import type { LogName, Logs } from "./analyse.ts";
import { leverViolations, type LeverState } from "./levers.ts";

export type Problem = { log: LogName; field: string; why: string; count: number; example: string };

const str = (v: unknown) => typeof v === "string" && v.length > 0;
const numb = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const time = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));
const oneOf = (...xs: unknown[]) => (v: unknown) => xs.includes(v);
const obj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
const int0 = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
const int1 = (v: unknown) => Number.isInteger(v) && (v as number) >= 1;
const bool = (v: unknown) => typeof v === "boolean";
const sha = (v: unknown) => typeof v === "string" && /^[0-9a-f]{7,64}$/.test(v);

/** task-router's tripwires (its core/local/tripwires.ts `TRIPS`; token-meter imports nothing of the router; the log-contract check compares the two). */
export const TRIPS = ["identical-call", "no-change-writes", "alternation", "repeated-error", "churn", "check-failing",
  "over-size", "risky-path", "context-soft", "context-stall", "outside-worktree"];
/** task-router's overseer roles (its core/local/overseer.ts `ROLES`; the log-contract check compares the two). */
export const ROLES = ["merge", "plan-author", "delta", "plan-review", "steer"];
/** task-router's merge refusal and error codes (its core/local/merge.ts `REASONS`; the log-contract check compares the two). */
export const REASONS = ["main-branch", "dirty", "behind", "fixer-running", "abandoned", "blocked", "size", "scope", "check", "main-dirty",
  "plan-changed", "no-worktree", "review-unavailable", "aborted", "git"];
/** task-router's replan trigger codes (its core/local/plan.ts `TRIGGERS`; the log-contract check compares the two). */
export const TRIGGERS = ["non-whitelisted", "interface-break", "regression", "over-budget", "remediation-failed"];

type Rule = { field: string; why: string; when?: (l: any) => boolean; ok: (v: any, l: any) => boolean };
const every = (fields: Record<string, (v: any) => boolean>, why: string, when?: (l: any) => boolean): Rule[] =>
  Object.entries(fields).map(([field, ok]) => ({ field, why, when, ok }));
/** Optional fields: never required, only their type is checked when present. */
const optional = (fields: Record<string, (v: any) => boolean>, why: string, when?: (l: any) => boolean): Rule[] =>
  Object.entries(fields).map(([field, ok]) => ({ field, why: `optional: ${why}`, when: (l) => (!when || when(l)) && field in l, ok }));
const versioned: Rule = { field: "v", why: "schema version, an integer when present", ok: (v, l) => !("v" in l) || Number.isInteger(v) };

/** Levers lines (design §5.3) record settings, no request: the request rules skip them. */
const isLevers = (l: any) => l.kind === "levers";
const requests = (rules: Rule[]): Rule[] => rules.map((r) => ({ ...r, when: (l) => !isLevers(l) && (!r.when || r.when(l)) }));
const leverStates = (v: unknown) => obj(v) && Object.values(v as object).every((x) => obj(x) && leverViolations(x as LeverState).length === 0);

const METER: Rule[] = [
  versioned,
  ...requests([
    ...every({ ts: time, sessionId: str, provider: str, model: str, kind: oneOf("turn", "warming", "nested", "compaction"), status: (v) => numb(v) || v === "error" }, "every meter line"),
    // Meter line v2 (design §5.2): the retry extension's counts were on every line up to v1; native ones are present iff observed.
    ...every({ retries: numb, retryWaitMs: numb }, "every meter line up to v1", (l) => !(Number.isInteger(l.v) && l.v >= 2)),
    ...every({ billing: oneOf("subscription", "api", "free", "local") }, "every meter line from v2", (l) => Number.isInteger(l.v) && l.v >= 2),
    ...optional({ retries: int0, retryWaitMs: (v) => numb(v) && v >= 0, design: str, cacheWrite1h: int0, durationMs: int0, ttftMs: int0, promptMs: int0, genMs: int0, cacheN: int0, promptN: int0, errorKind: oneOf("context_overflow", "rate_limit", "other"),
      systemHash: (v) => typeof v === "string" && /^[0-9a-f]{16}$/.test(v) }, "meter line v2"),
    ...every({ input: numb, cacheRead: numb, cacheWrite: numb, output: numb, costUsd: numb }, "usage of a successful request", (l) => l.status !== "error"),
  ]),
  ...every({ v: (v) => v === 2, ts: time, sessionId: str, eligible: bool, levers: leverStates }, "levers line (design §5.3: v2, every lever state valid)", isLevers),
  ...optional({ parentSessionId: str, arm: str, design: str, stratum: str }, "levers line", isLevers),
];
const OUTCOMES: Rule[] = [
  versioned,
  ...every({ ts: time, event: oneOf("spawn", "reroute", "check", "corrective", "escalate", "verdict", "spotcheck", "force", "hint", "review", "merge", "gatebypass", "plan") }, "every outcome event"),
  // A session-level line (task-router local mode, design §3.0.3) has `taskId: ""`: `force`, and a `merge` refused before a
  // branch was known (no branch given, none active).
  { field: "taskId", why: "every outcome event (force, merge: a string, may be empty)", ok: (v, l) => (l?.event === "force" || l?.event === "merge" ? typeof v === "string" : str(v)) },
  ...every({ kind: str, workerTier: str, workerEffort: str, sessionId: str, parentSessionId: str }, "spawn: tier mix, child-session join", (l) => l.event === "spawn"),
  ...optional({ assigned: oneOf("router", "random"), routeBase: str, unresolved: (v) => typeof v === "boolean", cwd: str, reviewOf: str }, "spawn: randomized routing, unresolved cards, working directory, spot-check review", (l) => l.event === "spawn"),
  ...every({ verdict: oneOf("accepted", "partial", "rejected", "unjudged") }, "verdict", (l) => l.event === "verdict"),
  ...optional({ reviewOf: str }, "verdict of a spot-check review: the task reviewed", (l) => l.event === "verdict"),
  ...optional({ requested: (v) => v === true }, "spotcheck: requested is true", (l) => l.event === "spotcheck"),
  ...every({ exit: numb }, "check", (l) => l.event === "check"),
  ...every({ from: str, to: str }, "escalate/reroute", (l) => l.event === "escalate" || l.event === "reroute"),
  ...optional({
    ability: str, level: int0, draft: (v) => v === true, workerLevel: int0, reviewLevel: int0,
    workerMember: str, workerModel: str, startEffort: str, waitMs: (v) => numb(v) && v >= 0,
  }, "spawn: requirement, levels, started member, model, effort, wait (router 2026-10-17)", (l) => l.event === "spawn"),
  ...optional({ fromModel: str, toModel: str }, "reroute/escalate: the models on both routes (router 2026-10-17); escalate.fromModel absent when the attempt is unknown", (l) => l.event === "escalate" || l.event === "reroute"),
  ...optional({ ability: str, fromLevel: int0, toLevel: int0 }, "escalate: ability and levels (router 2026-10-17); fromLevel absent when the attempt is unknown", (l) => l.event === "escalate"),
  // task-router local mode L2 (design §3.6): the force override's line and a forced spawn's fields
  ...every({ action: oneOf("set", "clear", "used", "expired", "rejected"), source: oneOf("command", "settings") }, "force", (l) => l.event === "force"),
  ...optional({ model: str, effort: oneOf("off", "minimal", "low", "medium", "high", "xhigh", "max"), reason: oneOf("unknown-model", "usage") }, "force", (l) => l.event === "force"),
  ...optional({ forced: (v) => v === true, forceSource: oneOf("command", "settings"), routedModel: str, routedEffort: str }, "spawn: a forced spawn", (l) => l.event === "spawn"),
  // task-router local mode L3 (design §3.1): a hint to the main session (taskId "main") or a child
  ...every({ trip: oneOf(...TRIPS), stage: oneOf("hint", "steer", "parent") }, "hint", (l) => l.event === "hint"),
  ...optional({ count: int0, sessionId: str }, "hint", (l) => l.event === "hint"),
  // task-router local mode L4 (design §3.0.3): an overseer attempt (taskId = the review id) and a ticket child's spawn
  ...every({ role: oneOf(...ROLES), member: str, model: str, outcome: oneOf("approve", "revise", "invalid", "timeout", "error") }, "review", (l) => l.event === "review"),
  ...optional({ blocking: int0, findings: int0, fallback: oneOf("budget", "error"), inconsistent: bool, attempt: int1, durationMs: int0, commit: sha, branch: str },
    "review", (l) => l.event === "review"),
  ...optional({ ticket: oneOf(...ROLES, "fixer") }, "spawn: the router's own child (overseer, fixer)", (l) => l.event === "spawn"),
  // task-router local mode L6 (design §3.0.3): one request_merge call (taskId = the branch); main moved outside the gate
  ...every({ outcome: oneOf("merged", "refused", "revise", "fixer", "failed") }, "merge", (l) => l.event === "merge"),
  ...optional({ reason: oneOf(...REASONS), commit: sha, nLines: int0, nFiles: int0, reviewId: str, pushed: bool }, "merge", (l) => l.event === "merge"),
  ...every({ from: sha, to: sha }, "gatebypass (taskId = the main branch)", (l) => l.event === "gatebypass"),
  ...optional({ repo: str }, "gatebypass: the repository's directory name", (l) => l.event === "gatebypass"),
  // task-router local mode L7 (design §3.0.3): a plan's skeleton, approval, replan trigger, amendment or rejection (taskId = the slug)
  ...every({ action: oneOf("skeleton", "approve", "trigger", "amend", "reject") }, "plan", (l) => l.event === "plan"),
  ...optional({ trigger: oneOf(...TRIGGERS), nTasks: int1, reviewId: str, full: bool }, "plan", (l) => l.event === "plan"),
];
/** assignments v2 (the experiments engine of M5b.1, design §5.4); before it the v1 engine's rows (no v, or v 1). */
const isV2 = (l: any): boolean => Number.isInteger(l.v) && l.v >= 2;
/** A row whose session has an arm: every v1-engine row, an eligible v2 row. */
const armed = (l: any): boolean => !isV2(l) || l.eligible === true;
const ASSIGNMENTS: Rule[] = [
  versioned,
  ...every({ ts: time, sessionId: str, mode: str }, "every assignment"),
  ...every({ arm: str, flags: obj }, "a v1 engine's assignment (v < 2)", (l) => !isV2(l)),
  ...every({ design: str }, "design of a v1 assignment (v1 vs v2 arms)", (l) => Number.isInteger(l.v) && l.v === 1),
  ...every({ mode: oneOf("off", "explore", "exploit"), eligible: bool }, "assignments v2", isV2),
  // A stratum without factors has one arm, named "" (no bits).
  ...every({ design: str, stratum: str, arm: (v) => typeof v === "string", factors: obj }, "an eligible v2 assignment", (l) => isV2(l) && l.eligible === true),
  ...every({ arm: (v) => v === undefined, factors: (v) => v === undefined }, "an ineligible v2 assignment has neither arm nor factors", (l) => isV2(l) && l.eligible === false),
  ...optional({ design: str, stratum: str, parentSessionId: str }, "assignments v2", isV2),
];
const GUARDS: Rule[] = [
  versioned,
  ...every({ ts: time, sessionId: str, event: oneOf("peek-after-mask", "correction", "rating") }, "every guard event"),
  ...every({ value: (v) => Number.isInteger(v) && v >= 1 && v <= 5 }, "rating value 1–5", (l) => l.event === "rating"),
];

const MAX_DEPTH = 64;

/** Problems in `logs` (the period); `all` (every line read) resolves joins across the period edge. */
export function check(logs: Logs, all: Logs = logs): Problem[] {
  const parent = new Map<string, string>();
  for (const e of all.outcomes) if (e?.event === "spawn" && str(e.sessionId) && str(e.parentSessionId)) parent.set(e.sessionId, e.parentSessionId);
  for (const l of all.meter) if (str(l?.sessionId) && str(l.parentSessionId)) parent.set(l.sessionId, l.parentSessionId);
  const assigned = new Map<string, number>();
  for (const r of all.assignments) if (str(r?.sessionId) && time(r.ts) && armed(r) && !assigned.has(r.sessionId)) assigned.set(r.sessionId, Date.parse(r.ts));
  /** An arm is due when the session or an ancestor was assigned one at or before `ts`. */
  const armDue = (sid: unknown, ts: unknown): boolean => {
    if (!str(sid) || !time(ts)) return false;
    const seen = new Set<string>();
    for (let s: string | undefined = sid as string, i = 0; s !== undefined && i < MAX_DEPTH && !seen.has(s); i++, s = parent.get(s)) {
      seen.add(s);
      const at = assigned.get(s);
      if (at !== undefined && at <= Date.parse(ts as string)) return true;
    }
    return false;
  };
  const children = new Set(all.outcomes.filter((e) => e?.event === "spawn" && str(e.sessionId)).map((e) => e.sessionId));
  const arm: Rule = { field: "arm", why: "the session's root has an experiment assignment", ok: (v) => typeof v === "string" }; // "" = the one arm of a design without factors
  const rules: Record<LogName, Rule[]> = {
    meter: [...METER, { field: "parentSessionId", why: "a spawn event names this session as a child", when: (l) => children.has(l.sessionId), ok: str },
      { ...arm, when: (l) => armDue(l.parentSessionId ?? l.sessionId, l.ts) || armDue(l.sessionId, l.ts) }],
    // (M5b.2) A spawn needs no arm: routers no longer read pi-economics; the analyses join the root assignment (withSpawnArms).
    outcomes: OUTCOMES,
    assignments: ASSIGNMENTS,
    guards: [...GUARDS, { ...arm, when: (l) => armDue(l.sessionId, l.ts) }],
  };
  const out: Problem[] = [];
  for (const log of Object.keys(rules) as LogName[]) {
    for (const r of rules[log]) {
      const bad = logs[log].filter((l) => l && typeof l === "object" && (!r.when || r.when(l)) && !r.ok(l[r.field], l));
      if (bad.length) out.push({ log, field: r.field, why: r.why, count: bad.length, example: [bad[0].sessionId ?? bad[0].taskId, bad[0].ts].filter(Boolean).join(" @ ") || JSON.stringify(bad[0]).slice(0, 80) });
    }
  }
  return out;
}

export const renderProblems = (ps: Problem[]): string =>
  ps.length ? ps.map((p) => `${p.log}: ${p.count} line(s) miss ${p.field} (${p.why}; e.g. ${p.example})`).join("\n") + "\n" : "contract ok: every required field present\n";
