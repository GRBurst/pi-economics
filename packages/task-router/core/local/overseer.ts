// Local mode L4 (design §3.2, plan S19–S20): the overseer. The router spawns it itself through the actor's spawn API
// (spawnPolicyApi ≥ 2) with a ticket in `task`; its own spawn policy answers a known ticket first, single use, with the
// ticket's model, cwd, read-only tools, the submit tool and a guard (D25). An unknown ticket falls through to card routing.
import type { ChildTool, PolicyResult, SubagentsApiV1 } from "../api.ts";
import type { Guard, SyncGuard } from "../toolguard.ts";
import type { ThinkingLevel } from "../types.ts";

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
