// Local mode L4 (design §3.2, plan S19–S20): the overseer. The router spawns it itself through the actor's spawn API
// (spawnPolicyApi ≥ 2) with a ticket in `task`; its own spawn policy answers a known ticket first, single use, with the
// ticket's model, cwd, read-only tools, the submit tool and a guard (D25). An unknown ticket falls through to card routing.
import type { ChildTool, PolicyResult, SubagentsApiV1 } from "../api.ts";
import type { Guard, SyncGuard } from "../toolguard.ts";
import type { RouterSettings, ThinkingLevel } from "../types.ts";
import type { Schema } from "./schema.ts";
import { approve, VERDICT_SCHEMA, validateVerdict, type Verdict } from "./verdict.ts";

export type Role = "merge" | "plan-author" | "delta" | "plan-review" | "steer";
export type TicketRole = Role | "fixer";
export type Ticket = { role: TicketRole; reviewId: string; member: string; model: string; effort: ThinkingLevel; cwd: string;
  tools?: string[]; childTools: ChildTool[]; toolGuard?: Guard; briefAppend?: string;
  forced?: { source: "command" | "settings"; routedModel: string; routedEffort: ThinkingLevel } };

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
    /** Single use: the ticket of `id` once, remembered under the child's name. */
    take(id: unknown, name: string): Ticket | undefined {
      const t = typeof id === "string" ? open.get(id) : undefined;
      if (!t) return undefined;
      open.delete(id as string);
      byName.set(name, t);
      return t;
    },
    /** The ticket a child was spawned with (its spawn line, its events). */
    owner: (name: string): Ticket | undefined => byName.get(name),
    forget(name: string): void { byName.delete(name); },
  };
}
export type Tickets = ReturnType<typeof createTickets>;

export const hasSpawnApi = (a: SubagentsApiV1): a is SubagentsApiV1 & Required<Pick<SubagentsApiV1, "spawn" | "kill">> =>
  typeof a.spawn === "function" && typeof a.kill === "function";

/** Blocks every tool outside `allowed` (the orchestration tools too); the last allowed tool is the submit tool. */
export const overseerGuard = (allowed: readonly string[]): SyncGuard => (tool) =>
  allowed.includes(tool) ? undefined : `overseer: ${tool} is not available; report with ${allowed[allowed.length - 1]}`;

export const ticketPolicy = (t: Ticket): PolicyResult => ({
  model: t.model, thinkingLevel: t.effort, cwd: t.cwd, childTools: t.childTools,
  ...(t.tools && { tools: t.tools }), ...(t.toolGuard && { toolGuard: t.toolGuard }), ...(t.briefAppend && { briefAppend: t.briefAppend }),
  meta: { taskId: t.reviewId, role: t.role },
});

// ── Running an overseer (plan S20, design §3.2.2) ──
export type SubmitSpec<T> = { name: "submit_verdict" | "submit_plan"; description: string; parameters: Schema;
  check(input: unknown): Promise<{ ok: true; value: T } | { ok: false; reasons: string[] }> };
export type Budget = { opusUsed: number; steerUsed: number };
export type RunResult<T> = { ok: true; value: T; reviewId: string; member: string; model: string }
                         | { ok: false; outcome: "timeout" | "error" | "invalid" | "skipped" | "aborted" };
export type RunArgs<T> = { role: Role; input: string; cwd: string; submit: SubmitSpec<T>; commit?: string; branch?: string; signal?: AbortSignal };
export type OverseerDeps = {
  api(): SubagentsApiV1 | undefined; settings: RouterSettings; tickets: Tickets;
  /** Random hex of 2·bytes characters (review ids, D34). */
  hex(bytes: number): string;
  now(): number; sleep(ms: number): Promise<void>;
  /** Mutable: counted at spawn (D30). */
  budget: Budget;
  /** `pi.appendEntry` (design §3.0.2). */
  append(customType: string, data: unknown): void;
};

export const AUDITOR = `You are an auditor, not an author. Before reading the diff or plan, derive the invariants the goal implies; then check the work against them.
Report only through the submit tool. Every finding names a target (path[:line] or a plan task id) and a fix criterion: a checkable condition, not code.
Write no code and no replacement plan. You cannot edit files or run commands.`;
export const PROMPT: Record<Role, string> = {
  merge: `${AUDITOR}\nReview the branch below for merging into the main branch. A finding is blocking when the branch must not merge without its fix.`,
  delta: `${AUDITOR}\nReview the plan amendment below against its trigger and evidence. A finding is blocking when the amendment must not be applied as proposed.`,
  "plan-review": `${AUDITOR}\nReview the whole plan below with the amendment applied. A finding is blocking when work must not continue on this plan.`,
  steer: `${AUDITOR}\nA local model is stuck; the call records below show how. Name the cause and what to do next. Mark a finding blocking only when the current approach cannot work.`,
  "plan-author": `You are the planner. Write the plan skeleton for the request below and submit it with submit_plan.
Each task is small: few files, and one check command that fails before the task and passes after it. Write no code.`,
};

/** `submit_verdict` (design §3.2.3): the schema and the V1 rules; `targets` per role (D33). */
export const verdictSubmit = (targets?: ReadonlySet<string>): SubmitSpec<Verdict> => ({
  name: "submit_verdict",
  description: "Submit your review: a verdict, a summary and findings. Each finding names a target and a checkable fix criterion. This ends the review.",
  parameters: VERDICT_SCHEMA,
  check: async (x) => validateVerdict(x, targets),
});

/** Polls between the child's events (D27: the API has no idle event), the verify gate's interval. */
const POLL_MS = 2000;
export const REVIEW_TYPE = "task-router/review";
type Settled<T> = { kind: "ok"; value: T } | { kind: "timeout" | "error" | "invalid" | "aborted" };

export function createOverseer(d: OverseerDeps) {
  let n = 0;
  /** One overseer child: spawn with a ticket, await its submit tool, kill it. */
  async function attempt<T>(a: SubagentsApiV1 & Required<Pick<SubagentsApiV1, "spawn" | "kill">>, r: RunArgs<T>,
    member: string, model: string, effort: ThinkingLevel, reviewId: string): Promise<Settled<T>> {
    const s = d.settings.overseer, name = `ovs-${r.role}-${++n}`;
    let settled: Settled<T> | undefined, wake!: () => void;
    const done = new Promise<void>((res) => { wake = res; });
    const finish = (o: Settled<T>): void => { if (!settled) { settled = o; wake(); } };
    let invalid = 0;
    const tool: ChildTool = {
      name: r.submit.name, description: r.submit.description, parameters: r.submit.parameters,
      async execute(x) {
        if (settled) return { text: "review closed", isError: true, terminate: true };
        const c = await r.submit.check(x);
        if (c.ok) { finish({ kind: "ok", value: c.value }); return { text: "recorded", terminate: true }; }
        const why = `invalid: ${c.reasons.join("; ")}`;
        if (++invalid <= s.resubmits) return { text: `${why}; resubmit`, isError: true };
        finish({ kind: "invalid" });
        return { text: `${why}; no resubmits left`, isError: true, terminate: true };
      },
    };
    const ticket = d.tickets.issue({ role: r.role, reviewId, member, model, effort, cwd: r.cwd, tools: s.tools, childTools: [tool],
      toolGuard: overseerGuard([...s.tools, tool.name]) });
    const sp = await a.spawn({ name, systemPrompt: PROMPT[r.role], message: r.input, task: { ticket } }, { by: "main", quiet: true })
      .catch((err: Error) => ({ ok: false as const, reason: err.message }));
    if (!sp.ok) { d.tickets.forget(name); return { kind: "error" }; }
    while (!settled) await Promise.race([done, d.sleep(POLL_MS)]);
    await a.kill([name]).catch(() => []);
    d.tickets.forget(name);
    return settled;
  }
  return {
    async run<T>(r: RunArgs<T>): Promise<RunResult<T>> {
      const a = d.api();
      if (!a || !hasSpawnApi(a)) return { ok: false, outcome: "error" };
      const s = d.settings.overseer, member = s.member, model = d.settings.models[member]?.model;
      if (!model) return { ok: false, outcome: "error" };
      const reviewId = `rv-${d.hex(4)}`;
      const o = await attempt(a, r, member, model, s.effort, reviewId);
      if (o.kind !== "ok") return { ok: false, outcome: o.kind };
      d.append(REVIEW_TYPE, { reviewId, role: r.role, member, ...(r.commit && { commit: r.commit }), verdict: o.value,
        ...(r.submit.name === "submit_verdict" && { approved: approve((o.value as Verdict).findings) }), ts: d.now() });
      return { ok: true, value: o.value, reviewId, member, model };
    },
  };
}
