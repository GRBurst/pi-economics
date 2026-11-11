// Local mode L4 (design §3.2, plan S19–S20): the overseer. The router spawns it itself through the actor's spawn API
// (spawnPolicyApi ≥ 2) with a ticket in `task`; its own spawn policy answers a known ticket first, single use, with the
// ticket's model, cwd, read-only tools, the submit tool and a guard (D25). An unknown ticket falls through to card routing.
import { isAbsolute, relative } from "node:path";
import type { ChildTool, PolicyResult, SubagentsApiV1 } from "../api.ts";
import type { Guard, SyncGuard } from "../toolguard.ts";
import type { RouterSettings, ThinkingLevel } from "../types.ts";
import type { ReviewInput } from "../outcome.ts";
import type { ForcePort } from "../forceinstall.ts";
import type { Schema } from "./schema.ts";
import { approve, inconsistent, VERDICT_SCHEMA, validateVerdict, type Verdict } from "./verdict.ts";

/** The overseer roles; token-meter's contract keeps a copy (`ROLES`), compared by the log-contract check. */
export const ROLES = ["merge", "plan-author", "delta", "plan-review", "steer"] as const;
export type Role = (typeof ROLES)[number];
export type TicketRole = Role | "fixer";
export type Ticket = { role: TicketRole; reviewId: string; member: string; model: string; effort: ThinkingLevel; cwd: string;
  tools?: string[]; childTools: ChildTool[]; toolGuard?: Guard; briefAppend?: string;
  forced?: { source: "command" | "settings"; routedModel: string; routedEffort: ThinkingLevel };
  /** Set by `take`: the spawning caller's session (the spawn line's `parentSessionId`) and when (ms; the child holds a
   *  slot of `member` from then on while it is pending, like a routed child's reservation). */
  parentSession?: string; takenAt?: number };

/** `hex(bytes)`: a random hex string of 2·bytes characters (crypto in the shell, scripted in tests). */
export function createTickets(hex: (bytes: number) => string) {
  const open = new Map<string, Ticket>(), byName = new Map<string, Ticket>();
  return {
    /** A fresh ticket id (128 bits, 32 hex). */
    issue(t: Ticket): string {
      const id = hex(16);
      open.set(id, t);
      return id;
    },
    /** Single use: the ticket of `id` once, remembered under the child's name with the caller's session. */
    take(id: unknown, name: string, parentSession?: string, at?: number): Ticket | undefined {
      const t = typeof id === "string" ? open.get(id) : undefined;
      if (!t) return undefined;
      open.delete(id as string);
      byName.set(name, { ...t, ...(parentSession !== undefined && { parentSession }), ...(at !== undefined && { takenAt: at }) });
      return t;
    },
    /** The ticket children not forgotten yet, by name (their member's slots and daily cap count them). */
    held: (): [string, Ticket][] => [...byName],
    /** The ticket a child was spawned with (its spawn line, its events). */
    owner: (name: string): Ticket | undefined => byName.get(name),
    forget(name: string): void { byName.delete(name); },
    /** Closes a ticket no policy took (review F4: a spawn that failed before the policy ran); a taken one is gone already. */
    revoke(id: string): void { open.delete(id); },
  };
}
export type Tickets = ReturnType<typeof createTickets>;

export const hasSpawnApi = (a: SubagentsApiV1): a is SubagentsApiV1 & Required<Pick<SubagentsApiV1, "spawn" | "kill">> =>
  typeof a.spawn === "function" && typeof a.kill === "function";
/** The warning in local mode without the spawn API (design §3.0.4), once per session start of the process. */
export const NO_SPAWN_API = "task-router: local mode needs actor-subagents with spawnPolicyApi ≥ 2; merges are refused and plans are unavailable";

/** Blocks every tool outside `allowed` (the orchestration tools too); the last allowed tool is the submit tool. */
export const overseerGuard = (allowed: readonly string[]): SyncGuard => (tool) =>
  allowed.includes(tool) ? undefined : `overseer: ${tool} is not available; report with ${allowed[allowed.length - 1]}`;

export const ticketPolicy = (t: Ticket): PolicyResult => ({
  model: t.model, thinkingLevel: t.effort, cwd: t.cwd, childTools: t.childTools,
  ...(t.tools && { tools: t.tools }), ...(t.toolGuard && { toolGuard: t.toolGuard }), ...(t.briefAppend && { briefAppend: t.briefAppend }),
  meta: { taskId: t.reviewId, role: t.role },
});

// ── Running an overseer (plan S20, design §3.2.2) ──
/** `resubmits`: the attempt's resubmits for invalid input, if not `overseer.resubmits` (`submit_plan`: `plans.rounds`, L7).
 *  `check` gets the attempt's number (1, the fallback 2): a spec that counts submissions counts them per attempt (review L7 F3). */
export type SubmitSpec<T> = { name: "submit_verdict" | "submit_plan"; description: string; parameters: Schema; resubmits?: number;
  check(input: unknown, attempt?: number): Promise<{ ok: true; value: T } | { ok: false; reasons: string[] }> };
export type Budget = { opusUsed: number; steerUsed: number };
/** `why`: the spawn refusals of the attempts that did not start (a member at its dailyCap or without a free slot). */
export type RunResult<T> = { ok: true; value: T; reviewId: string; member: string; model: string }
                         | { ok: false; outcome: "timeout" | "error" | "invalid" | "skipped" | "aborted"; why?: string };
/** LD14 (review F5): `cwd` is the child session's (default `base()`, the main checkout), never inside `worktree`, the tree under
 *  review, which the brief names by its absolute path: pi loads AGENTS.md and project settings from the cwd, and a branch must
 *  not write its reviewer's instructions. */
export type RunArgs<T> = { role: Role; input: string; cwd?: string; worktree?: string; submit: SubmitSpec<T>; commit?: string; branch?: string;
  signal?: AbortSignal };
export type OverseerDeps = {
  api(): SubagentsApiV1 | undefined; settings: RouterSettings; tickets: Tickets;
  /** The router's own spawn policy is registered (review F1): without it a ticket reaches no one, so nothing is spawned. */
  policyOn(): boolean;
  /** A one-line warning (a child the router's policy did not route). */
  warn(text: string): void;
  /** The repository's main checkout (LD14): an overseer's default cwd. */
  base(): string;
  /** Random hex of 2·bytes characters (review ids, D34). */
  hex(bytes: number): string;
  now(): number; sleep(ms: number): Promise<void>;
  /** Mutable: counted at spawn (D30). */
  budget: Budget;
  /** `pi.appendEntry` (design §3.0.2). */
  append(customType: string, data: unknown): void;
  /** The outcome log's `review` line, one per attempt (design §3.0.3). */
  log: { review(i: ReviewInput): void };
  /** The force override (design §3.6.3): the fixer runs under an active force (D47); overseers never do (AC-F6). */
  force?: ForcePort;
};
/** The fixer's system prompt (Q18). */
export const FIXER_PROMPT = "You fix a branch that a merge review rejected. Work only in the worktree you are given, change what the blocking findings name, commit there, and report to main. Nothing merges without a new review.";

export const AUDITOR = `You are an auditor, not an author. Before reading the diff or plan, derive the invariants the goal implies; then check the work against them.
Report only through the submit tool. Every finding names a target (path[:line] or a plan task id) and a fix criterion: a checkable condition, not code.
Write no code and no replacement plan. You cannot edit files or run commands.`;
/** Review F3: the actor gives a quiet child no agent preamble (no handshake); the prompt still says so, so a model that expects
 *  one starts anyway, and that the run ends with the submit tool (else the reminder, then an error). */
const start = (tool: string): string => `No one answers you and no go-ahead comes: start at once, and end by calling ${tool}.`;
export const PROMPT: Record<Role, string> = {
  merge: `${AUDITOR}\nReview the branch below for merging into the main branch. A finding is blocking when the branch must not merge without its fix.\n${start("submit_verdict")}`,
  delta: `${AUDITOR}\nReview the plan amendment below against its trigger and evidence. A finding is blocking when the amendment must not be applied as proposed.\n${start("submit_verdict")}`,
  "plan-review": `${AUDITOR}\nReview the whole plan below with the amendment applied. A finding is blocking when work must not continue on this plan.\n${start("submit_verdict")}`,
  steer: `${AUDITOR}\nA local model is stuck; the call records below show how. Name the cause and what to do next. Mark a finding blocking only when the current approach cannot work.\n${start("submit_verdict")}`,
  "plan-author": `You are the planner. Write the plan skeleton for the request below and submit it with submit_plan.
Each task is small: few files, and one check command that fails before the task and passes after it. Write no code.\n${start("submit_plan")}`,
};

/** `submit_verdict` (design §3.2.3): the schema and the V1 rules; `targets` per role (D33). */
export const verdictSubmit = (targets?: ReadonlySet<string>): SubmitSpec<Verdict> => ({
  name: "submit_verdict",
  description: "Submit your review: a verdict, a summary and findings. Each finding names a target and a checkable fix criterion. This ends the review.",
  parameters: VERDICT_SCHEMA,
  check: async (x) => validateVerdict(x, targets),
});

/** The member for a run's first attempt (design §3.2.2 step 1): the Opus member while the budget lasts, else the fallback;
 *  a `steer` is skipped instead (it also needs `steerBudget`). */
export function pickMember(s: RouterSettings, role: Role, b: Budget):
  { member: string; effort: ThinkingLevel; fallback?: "budget" } | "skip" {
  const room = b.opusUsed < s.overseer.budget && (role !== "steer" || b.steerUsed < s.overseer.steerBudget);
  if (room) return { member: s.overseer.member, effort: s.overseer.effort };
  return role === "steer" ? "skip" : { member: s.overseer.fallbackMember, effort: s.overseer.fallbackEffort, fallback: "budget" };
}

/** Polls between the child's events (D27: the API has no idle event), the verify gate's interval. */
const POLL_MS = 2000;
export const REVIEW_TYPE = "task-router/review";
/** One entry per budget change (D30), rebuilt at session_start (design §3.0.2). */
export const BUDGET_TYPE = "task-router/budget";
const count = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;
/** The last well-formed budget entry on the branch, else nothing used. */
export function budgetOf(branch: readonly unknown[]): Budget {
  const last = branch.filter((e: any) => e?.type === "custom" && e.customType === BUDGET_TYPE && count(e.data?.opusUsed) && count(e.data?.steerUsed))
    .at(-1) as { data: Budget } | undefined;
  return last ? { opusUsed: last.data.opusUsed, steerUsed: last.data.steerUsed } : { opusUsed: 0, steerUsed: 0 };
}
/** `unrouted` (review F1): the spawn succeeded, but not through the router's policy; logged as an `error`, never retried. */
type Settled<T> = { kind: "ok"; value: T } | { kind: "timeout" | "invalid" | "aborted" | "unrouted" } | { kind: "error"; why?: string };
type SpawnApi = SubagentsApiV1 & Required<Pick<SubagentsApiV1, "spawn" | "kill">>;
/** `dir` is `root` or below it (both absolute). */
const inside = (dir: string, root: string): boolean => { const p = relative(root, dir); return p !== ".." && !p.startsWith("../") && !isAbsolute(p); };
/** LD14: the run with its cwd and brief, or why it may not start. */
function placed<T>(r: RunArgs<T>, base: string): (RunArgs<T> & { cwd: string }) | string {
  const cwd = r.cwd ?? base, wt = r.worktree;
  if (!isAbsolute(cwd) || (wt !== undefined && (!isAbsolute(wt) || inside(cwd, wt)))) return `cwd ${cwd}, worktree ${wt ?? "none"}`;
  return { ...r, cwd, ...(wt !== undefined && { input: `The worktree under review: ${wt} (read its files by this absolute path; your cwd is the main checkout).\n\n${r.input}` }) };
}

export function createOverseer(d: OverseerDeps) {
  let n = 0;
  /** One overseer child: spawn with a ticket, await its submit tool (reminder, timeout, events, abort), kill it. `charge`
   *  runs once the spawn succeeded (D30: an attempt that later times out still cost). */
  async function attempt<T>(a: SpawnApi, r: RunArgs<T> & { cwd: string }, no: number, member: string, model: string, effort: ThinkingLevel, reviewId: string,
    charge: () => void): Promise<Settled<T>> {
    const s = d.settings.overseer, name = `ovs-${r.role}-${++n}`;
    let settled: Settled<T> | undefined, wake!: () => void;
    const done = new Promise<void>((res) => { wake = res; });
    const finish = (o: Settled<T>): void => { if (!settled) { settled = o; wake(); } };
    let invalid = 0;
    /** A submission being checked (plan_request's red runs take real time): the deadline waits for it. */
    let checking: Promise<unknown> | undefined;
    const tool: ChildTool = {
      name: r.submit.name, description: r.submit.description, parameters: r.submit.parameters,
      async execute(x) {
        if (settled) return { text: "review closed", isError: true, terminate: true };
        const pending = (checking = r.submit.check(x, no));
        let c: Awaited<typeof pending>;
        try { c = await pending; } finally { if (checking === pending) checking = undefined; }
        if (c.ok) { finish({ kind: "ok", value: c.value }); return { text: "recorded", terminate: true }; }
        const why = `invalid: ${c.reasons.join("; ")}`;
        if (++invalid <= (r.submit.resubmits ?? s.resubmits)) return { text: `${why}; resubmit`, isError: true };
        finish({ kind: "invalid" });
        return { text: `${why}; no resubmits left`, isError: true, terminate: true };
      },
    };
    // D27: a `turn` event marks the child busy; `idle` in the list after it is one idle.
    let busy = false, idles = 0;
    const off = a.subscribe((e) => {
      if (!("name" in e) || e.name !== name) return;
      if (e.type === "turn") busy = true;
      if (e.type === "kill" || e.type === "error") finish({ kind: "error" });
    });
    const abort = (): void => finish({ kind: "aborted" });
    r.signal?.addEventListener("abort", abort, { once: true });
    let ticket: string | undefined;
    try {
      ticket = d.tickets.issue({ role: r.role, reviewId, member, model, effort, cwd: r.cwd, tools: s.tools, childTools: [tool],
        toolGuard: overseerGuard([...s.tools, tool.name]) });
      const sp = await a.spawn({ name, systemPrompt: PROMPT[r.role], message: r.input, task: { ticket } }, { by: "main", quiet: true })
        .catch((err: Error) => ({ ok: false as const, reason: err.message }));
      if (!sp.ok) { d.tickets.forget(name); return settled?.kind === "aborted" ? settled : { kind: "error", why: sp.reason }; }
      // Review F1: only the router's policy takes a ticket. A child it did not route (a foreign policy, none) may run with
      // every default tool and no guard, so it is killed before its first turn can act (fail closed), and nothing is charged.
      if (d.tickets.owner(name) === undefined) {
        await a.kill([name]).catch(() => []);
        d.warn(`task-router: ${name} was not spawned through the task-router policy; killed, the review fails`);
        return { kind: "unrouted" };
      }
      charge();
      const t0 = d.now();
      while (!settled) {
        await Promise.race([done, d.sleep(POLL_MS)]);
        if (settled) break;
        const state = a.list().find((x) => x.name === name)?.state;
        if (state === undefined) finish({ kind: "error" });
        else if (d.now() - t0 >= s.timeoutSec * 1000) {
          if (checking) await Promise.race([done, checking]).catch(() => undefined); // a submission made in time is judged first
          else finish({ kind: "timeout" });
        }
        else if (busy && state === "idle") {
          busy = false;
          if (++idles > 1) finish({ kind: "error" });
          else await a.send(name, `Submit with ${tool.name}.`, "router").catch(() => undefined);
        }
      }
      await a.kill([name]).catch(() => []);
      d.tickets.forget(name);
      // review L7 F3: a check still running (a kill or error event ended the attempt) settles first, so the fallback's checks
      // never run beside it
      while (checking) await checking.catch(() => undefined);
      return settled;
    } finally {
      if (ticket !== undefined) d.tickets.revoke(ticket); // review F4: never left open
      off();
      r.signal?.removeEventListener("abort", abort);
    }
  }
  /** The spawn API is there and the router's policy is registered (review F1). */
  const ready = (): boolean => { const a = d.api(); return !!a && hasSpawnApi(a) && d.policyOn(); };
  // Review L5: an Opus pick is held from the pick to its charge (or its failed spawn), so concurrent runs cannot both take the
  // last unit of `budget` or `steerBudget`.
  const held = { opus: 0, steer: 0 };
  const budget = (): Budget => ({ opusUsed: d.budget.opusUsed + held.opus, steerUsed: d.budget.steerUsed + held.steer });
  return {
    ready,
    /** The budget with the picks in flight counted as used (what the next pick sees). */
    budget,
    /** The merge fixer (design §3.4.4, D45–D47): a ticket on `fixerMember` at `fixerEffort` (or the active force), cwd the worktree,
     *  every tool with `toolGuard`, the card as its brief; not quiet, so its report and its death reach main. A child the router's
     *  policy did not route is killed (review F1). No Opus budget (D47); like every ticket spawn it counts toward
     *  `fixerMember`'s dailyCap and slots, and the policy refuses it on a capped or full member (L4 note, decided in L6). */
    async fixer(x: { worktree: string; reviewId: string; brief: string; message: string; toolGuard?: Guard }):
      Promise<{ ok: true; name: string } | { ok: false; reason: string }> {
      const a = d.api();
      if (!a || !hasSpawnApi(a) || !ready()) return { ok: false, reason: "the actor's spawn API is not available" };
      const g = d.settings.mergeGate, routed = d.settings.models[g.fixerMember]?.model;
      if (!routed) return { ok: false, reason: `mergeGate.fixerMember ${g.fixerMember} is no member` };
      const f = d.force?.active();
      const model = f?.model ?? routed, effort = f?.thinkingLevel ?? g.fixerEffort, name = `fixer-${d.hex(3)}`;
      const ticket = d.tickets.issue({ role: "fixer", reviewId: x.reviewId, member: g.fixerMember, model, effort, cwd: x.worktree, childTools: [],
        ...(x.toolGuard && { toolGuard: x.toolGuard }), briefAppend: x.brief,
        ...(f && { forced: { source: f.source, routedModel: routed, routedEffort: g.fixerEffort } }) });
      try {
        const sp = await a.spawn({ name, systemPrompt: FIXER_PROMPT, message: x.message, task: { ticket } }, { by: "main", quiet: false })
          .catch((err: Error) => ({ ok: false as const, reason: err.message }));
        if (!sp.ok) { d.tickets.forget(name); return { ok: false, reason: sp.reason }; }
        if (d.tickets.owner(name) === undefined) {
          await a.kill([name]).catch(() => []);
          d.warn(`task-router: ${name} was not spawned through the task-router policy; killed`);
          return { ok: false, reason: `${name} was not routed by the task-router policy` };
        }
        if (f) d.force?.used(name);
        return { ok: true, name };
      } finally { d.tickets.revoke(ticket); }
    },
    /** Design §3.2.2: two attempts (`steer` one), the second on the fallback member (D28); `invalid` is a failed attempt. */
    async run<T>(args: RunArgs<T>): Promise<RunResult<T>> {
      const a = d.api();
      if (!a || !hasSpawnApi(a) || !ready()) return { ok: false, outcome: "error" };
      const r = placed(args, d.base());
      if (typeof r === "string") {
        d.warn(`task-router: an overseer runs in the main checkout with absolute paths (LD14); refused ${r}`);
        return { ok: false, outcome: "error" };
      }
      const s = d.settings.overseer;
      let last: "timeout" | "error" | "invalid" = "error";
      const whys: string[] = [];
      for (const no of r.role === "steer" ? [1] : [1, 2]) {
        if (r.signal?.aborted) return { ok: false, outcome: "aborted" };
        const p = no === 1 ? pickMember(d.settings, r.role, budget()) : { member: s.fallbackMember, effort: s.fallbackEffort, fallback: "error" as const };
        if (p === "skip") return { ok: false, outcome: "skipped" };
        const model = d.settings.models[p.member]?.model;
        if (!model) continue;
        const steer = r.role === "steer" ? 1 : 0;
        let holding = !p.fallback;
        const unhold = (): void => { if (holding) { holding = false; held.opus -= 1; held.steer -= steer; } };
        if (holding) { held.opus += 1; held.steer += steer; }
        const charge = (): void => {
          if (p.fallback) return;
          unhold();
          d.budget.opusUsed += 1;
          if (r.role === "steer") d.budget.steerUsed += 1;
          d.append(BUDGET_TYPE, { opusUsed: d.budget.opusUsed, steerUsed: d.budget.steerUsed });
        };
        const reviewId = `rv-${d.hex(4)}`, t0 = d.now();
        const o = await attempt(a, r, no, p.member, model, p.effort, reviewId, charge).finally(unhold);
        // The line's outcome: a verdict's approval (V2), else how the attempt ended; an aborted attempt is an `error`.
        const v = o.kind === "ok" && r.submit.name === "submit_verdict" ? o.value as Verdict : undefined;
        d.log.review({ reviewId, role: r.role, member: p.member, model, attempt: no, durationMs: d.now() - t0, fallback: p.fallback,
          outcome: o.kind === "ok" ? (v && !approve(v.findings) ? "revise" : "approve") : o.kind === "aborted" || o.kind === "unrouted" ? "error" : o.kind,
          ...(v && { findings: v.findings.length, blocking: v.findings.filter((f) => f.blocking).length, ...(inconsistent(v) && { inconsistent: true }) }),
          commit: r.commit, branch: r.branch });
        if (o.kind === "aborted") return { ok: false, outcome: "aborted" };
        if (o.kind === "unrouted") return { ok: false, outcome: "error" }; // a second attempt would meet the same policy
        if (o.kind !== "ok") { last = o.kind; if (o.kind === "error" && o.why) whys.push(o.why); continue; }
        d.append(REVIEW_TYPE, { reviewId, role: r.role, member: p.member, ...(r.commit && { commit: r.commit }), verdict: o.value,
          ...(r.submit.name === "submit_verdict" && { approved: approve((o.value as Verdict).findings) }), ts: d.now() });
        return { ok: true, value: o.value, reviewId, member: p.member, model };
      }
      return { ok: false, outcome: last, ...(whys.length && { why: [...new Set(whys)].join("; ") }) };
    },
  };
}
