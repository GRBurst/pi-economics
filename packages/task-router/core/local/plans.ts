// Local mode L7.T4 (design §3.0.2, §3.5.5; plan S29, D53): the router's plans, one record per slug, kept in memory and
// appended to the session as `task-router/plan` entries at every change (the triggers included), rebuilt at
// `session_start`; and the units of a plan its branches have merged.
import type { BranchRecord } from "./branches.ts";
import { type PlanRecord, type Skeleton, type Trigger, type TriggerKind, TRIGGERS } from "./plan.ts";

export const PLAN_TYPE = "task-router/plan";
export type PlanStore = {
  all(): PlanRecord[];
  get(slug: string): PlanRecord | undefined;
  /** Memory, then one `task-router/plan` entry. */
  put(r: PlanRecord): void;
  /** The open trigger of this kind for this task, else a new one (`t<n>`, appended); undefined without that plan. */
  open(slug: string, kind: TriggerKind, task?: string): string | undefined;
  close(slug: string, id: string): void;
  /** One more rejected amendment for the trigger (design §3.5.4 step 5); the count, 0 without that trigger. */
  reject(slug: string, id: string): number;
  openTriggers(slug: string): Trigger[];
  /** Replaces everything with what the session entries (in order) say; entries that are not well-formed are ignored. */
  rebuild(entries: readonly unknown[]): void;
};

const isStr = (x: unknown): x is string => typeof x === "string";
const readTrigger = (x: unknown): boolean => {
  const t = x as Record<string, unknown> | null;
  return !!t && typeof t === "object" && isStr(t.id) && TRIGGERS.includes(t.kind as TriggerKind)
    && (t.task === undefined || isStr(t.task)) && typeof t.open === "boolean" && (t.rejected === undefined || Number.isInteger(t.rejected));
};
/** A record as stored, or undefined when a field is missing or of the wrong type. */
export function readPlan(x: unknown): PlanRecord | undefined {
  const r = x as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || !["slug", "repo", "file", "skeletonHash", "approvedBy"].every((k) => isStr(r[k]))) return undefined;
  if (!Array.isArray(r.triggers) || !r.triggers.every(readTrigger)) return undefined;
  return structuredClone(r) as PlanRecord;
}

export function createPlanStore(append: (customType: string, data: unknown) => void): PlanStore {
  const plans = new Map<string, PlanRecord>();
  const put = (r: PlanRecord): void => { plans.set(r.slug, structuredClone(r)); append(PLAN_TYPE, structuredClone(r)); };
  return {
    all: () => [...plans.values()].map((r) => structuredClone(r)),
    get: (slug) => { const r = plans.get(slug); return r && structuredClone(r); },
    put,
    open(slug, kind, task) {
      const r = plans.get(slug);
      if (!r) return undefined;
      const same = r.triggers.find((t) => t.open && t.kind === kind && t.task === task);
      if (same) return same.id;
      const id = `t${r.triggers.length + 1}`;
      put({ ...r, triggers: [...r.triggers, { id, kind, ...(task !== undefined && { task }), open: true }] });
      return id;
    },
    close(slug, id) {
      const r = plans.get(slug);
      if (r?.triggers.some((t) => t.id === id && t.open)) put({ ...r, triggers: r.triggers.map((t) => (t.id === id ? { ...t, open: false } : t)) });
    },
    reject(slug, id) {
      const r = plans.get(slug), t = r?.triggers.find((x) => x.id === id);
      if (!r || !t) return 0;
      const n = (t.rejected ?? 0) + 1;
      put({ ...r, triggers: r.triggers.map((x) => (x.id === id ? { ...x, rejected: n } : x)) });
      return n;
    },
    openTriggers: (slug) => structuredClone(plans.get(slug)?.triggers.filter((t) => t.open) ?? []),
    rebuild(entries) {
      plans.clear();
      for (const e of entries) {
        const x = e as { customType?: unknown; data?: unknown } | null;
        if (!x || x.customType !== PLAN_TYPE) continue;
        const r = readPlan(x.data);
        if (r) plans.set(r.slug, r);
      }
    },
  };
}

/** The plan's units its merged branches finished: a task branch its task; a milestone branch the milestone and its tasks;
 *  a milestone whose tasks all merged. */
export function mergedUnits(sk: Skeleton, slug: string, branches: readonly BranchRecord[]): Set<string> {
  const out = new Set<string>();
  for (const b of branches) if (b.state === "merged" && b.plan?.slug === slug) out.add(b.plan.id);
  for (const m of sk.milestones) {
    if (out.has(m.id)) for (const t of m.tasks) out.add(t.id);
    else if (m.tasks.every((t) => out.has(t.id))) out.add(m.id);
  }
  return out;
}
