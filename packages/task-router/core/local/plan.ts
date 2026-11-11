// Local mode L7 (design §3.2.4, §3.5.3; plan S29): the plan core. Pure; file facts come through an `fs` port.
// L7.T1: `submit_plan`'s skeleton schema and the deterministic validation the router adds to it.
import { posix } from "node:path";
import type { RouterSettings } from "../types.ts";
import { check, type Schema } from "./schema.ts";

export type Task = {
  id: string; goal: string; files: string[]; create?: string[]; forbidden: string[]; check: string;
  checkCounterexample?: string; dependsOn: string[]; vacuousCheck?: true;
};
export type Milestone = { id: string; goal: string; acceptance: string[]; branch: "milestone" | "task"; dependsOn: string[]; tasks: Task[] };
export type Skeleton = { invariants: string[]; milestones: Milestone[] };
export type PlanFs = { exists(p: string): boolean; isDir(p: string): boolean };

export const SKELETON_SCHEMA: Schema = {
  type: "object", additionalProperties: false, required: ["milestones", "invariants"],
  properties: {
    invariants: { type: "array", maxItems: 12, items: { type: "string", maxLength: 200 } },
    milestones: { type: "array", minItems: 1, maxItems: 8, items: {
      type: "object", additionalProperties: false,
      required: ["id", "goal", "acceptance", "branch", "dependsOn", "tasks"],
      properties: {
        id: { type: "string", pattern: "^M[0-9]{1,2}$" },
        goal: { type: "string", maxLength: 300 },
        acceptance: { type: "array", maxItems: 8, items: { type: "string", maxLength: 200 } },
        branch: { enum: ["milestone", "task"] },
        dependsOn: { type: "array", items: { type: "string" } },
        tasks: { type: "array", minItems: 1, items: {
          type: "object", additionalProperties: false,
          required: ["id", "goal", "files", "forbidden", "check", "dependsOn"],
          properties: {
            id: { type: "string", pattern: "^M[0-9]{1,2}\\.T[0-9]{1,2}$" },
            goal: { type: "string", maxLength: 300 },
            files: { type: "array", minItems: 1, items: { type: "string" } },
            create: { type: "array", items: { type: "string" } },
            forbidden: { type: "array", items: { type: "string", maxLength: 160 } },
            check: { type: "string", maxLength: 300 },
            checkCounterexample: { type: "string", maxLength: 200 },
            dependsOn: { type: "array", items: { type: "string" } },
          } } },
      } } },
  },
};

type Unit = { id: string; dependsOn: string[] };
/** The skeleton's units in dependency order: a milestone's tasks, then the milestone itself (it is done when they are). */
export const units = (sk: Skeleton): Unit[] => sk.milestones.flatMap((m): Unit[] => [...m.tasks, m]);

/** Ids that lie on a dependency cycle (edges to unknown ids are ignored). */
function cyclic(us: Unit[]): Set<string> {
  const deps = new Map(us.map((u) => [u.id, u.dependsOn]));
  const out = new Set<string>(), state = new Map<string, "open" | "done">(), path: string[] = [];
  const visit = (id: string): void => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "open") { for (const p of path.slice(path.indexOf(id))) out.add(p); return; }
    state.set(id, "open"); path.push(id);
    for (const d of deps.get(id) ?? []) if (deps.has(d)) visit(d);
    path.pop(); state.set(id, "done");
  };
  for (const u of us) visit(u.id);
  return out;
}

/** design §3.2.4: the schema, then ids, dependencies, file facts, task counts and checks. Every rule names itself. */
export function validateSkeleton(x: unknown, s: RouterSettings, fs: PlanFs): { ok: true; value: Skeleton } | { ok: false; reasons: string[] } {
  const schema = check(SKELETON_SCHEMA, x);
  if (schema.length) return { ok: false, reasons: schema };
  const sk = x as Skeleton, us = units(sk), out: string[] = [];
  const seen = new Set<string>(), position = new Map<string, number>();
  us.forEach((u, i) => {
    if (seen.has(u.id)) out.push(`${u.id}: duplicate id`);
    seen.add(u.id);
    if (!position.has(u.id)) position.set(u.id, i);
  });
  const loop = cyclic(us);
  us.forEach((u, i) => {
    for (const d of u.dependsOn) {
      const at = position.get(d);
      if (at === undefined) out.push(`${u.id}: dependsOn names unknown id ${d}`);
      else if (at >= i) out.push(`${u.id}: dependsOn names a later id ${d}`);
    }
    if (loop.has(u.id)) out.push(`${u.id}: dependsOn forms a cycle`);
  });
  const { splitFiles, milestoneTasks } = s.plans;
  for (const m of sk.milestones) {
    if (m.tasks.length > milestoneTasks) out.push(`${m.id}: ${m.tasks.length} tasks; at most ${milestoneTasks} (plans.milestoneTasks)`);
    for (const t of m.tasks) {
      const all = new Set([...t.files, ...(t.create ?? [])]);
      if (all.size > splitFiles) out.push(`${t.id}: files and create name ${all.size} paths; at most ${splitFiles} (plans.splitFiles)`);
      for (const f of t.files) if (!fs.exists(f)) out.push(`${t.id}: file ${f} does not exist`);
      for (const f of t.create ?? []) {
        if (fs.exists(f)) out.push(`${t.id}: create ${f} exists`);
        else if (!fs.isDir(posix.dirname(f))) out.push(`${t.id}: create ${f} has no parent directory`);
      }
      if (!t.check.trim()) out.push(`${t.id}: check is empty`);
    }
  }
  return out.length ? { ok: false, reasons: out } : { ok: true, value: sk };
}
