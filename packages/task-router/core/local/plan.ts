// Local mode L7 (design §3.2.4, §3.5.3; plan S29): the plan core. Pure; file facts come through an `fs` port.
// L7.T1: `submit_plan`'s skeleton schema and the deterministic validation the router adds to it. L7.T2: canonical
// JSON, the skeleton hash, and the plan file's render and parse. L7.T3: the tick-only diff the plan guard allows.
import { createHash } from "node:crypto";
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

/** What a plan-bound branch may merge (design §3.5.5 `over-budget`; review L7 F4: the author's limits, the validation and the
 *  merge's size step read these): a task branch `splitLines`/`splitFiles`, a milestone branch (`branch: "milestone"`)
 *  `milestoneLines` and the gate's files; never above the merge gate's `maxDiffLines`/`maxDiffFiles`. `files`/`filesBy`: the
 *  setting that binds (a validation reason names it). */
export function planBudget(s: RouterSettings, branch: Milestone["branch"]): { lines: number; files: number; filesBy: string } {
  const g = s.mergeGate, p = s.plans;
  if (branch === "milestone") return { lines: Math.min(g.maxDiffLines, p.milestoneLines), files: g.maxDiffFiles, filesBy: "mergeGate.maxDiffFiles" };
  return { lines: Math.min(g.maxDiffLines, p.splitLines), files: Math.min(g.maxDiffFiles, p.splitFiles),
    filesBy: p.splitFiles <= g.maxDiffFiles ? "plans.splitFiles" : "mergeGate.maxDiffFiles" };
}

/** `p` is `dir` or a path inside it (both repository-relative, `/`-separated). */
const under = (p: string, dir: string): boolean => { const d = posix.normalize(dir).replace(/\/$/, ""); return p === d || p.startsWith(`${d}/`); };
/** design §3.2.4: the schema, then ids, dependencies, file facts, task counts and checks. Every rule names itself. A task names at
 *  most its branch budget's paths, a milestone branch's tasks together too (review L7 F4). */
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
  const { milestoneTasks } = s.plans, task = planBudget(s, "task"), whole = planBudget(s, "milestone");
  for (const m of sk.milestones) {
    if (m.tasks.length > milestoneTasks) out.push(`${m.id}: ${m.tasks.length} tasks; at most ${milestoneTasks} (plans.milestoneTasks)`);
    const paths = new Set(m.tasks.flatMap((t) => [...t.files, ...(t.create ?? [])]));
    if (m.branch === "milestone" && paths.size > whole.files) out.push(`${m.id}: a milestone branch names ${paths.size} paths; at most ${whole.files} (${whole.filesBy})`);
    for (const t of m.tasks) {
      const all = new Set([...t.files, ...(t.create ?? [])]);
      if (all.size > task.files) out.push(`${t.id}: files and create name ${all.size} paths; at most ${task.files} (${task.filesBy})`);
      // spot-check F7: a plan file changes only through amend_plan, so no task whitelists one (the merge would leave that plan plan-changed)
      for (const f of all) if (under(posix.normalize(f), s.plans.dir)) out.push(`${t.id}: ${f} is under plans.dir (${s.plans.dir}); a plan file changes only through amend_plan`);
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

// L7.T2 (design §3.5.3): the plan file. The JSON block is the source of truth; the text above it is for reading.
const sortKeys = (x: unknown): unknown =>
  Array.isArray(x) ? x.map(sortKeys)
  : typeof x === "object" && x !== null ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys((x as Record<string, unknown>)[k])]))
  : x;
export const canonical = (x: unknown): string => JSON.stringify(sortKeys(x), null, 2);
export const skeletonHash = (sk: Skeleton): string => createHash("sha256").update(canonical(sk)).digest("hex");

const SUMMARY = "<details><summary>skeleton</summary>";
/** Free text on one line: no line of the body but the router's own starts with a tick or the skeleton marker. */
const flat = (t: string) => t.replace(/\s+/g, " ").trim();
const list = (xs: readonly string[], sep = ", ") => (xs.length ? xs.map(flat).join(sep) : "—");

export function renderPlan(meta: { slug: string; request: string }, sk: Skeleton, ticks: ReadonlySet<string>): string {
  const out = [`# Plan: ${meta.slug}`, "<!-- task-router plan v1. Edit only checkboxes; change the plan with amend_plan. -->",
    `Request: ${flat(meta.request)}`, sk.invariants.length ? "Invariants:" : "Invariants: —", ...sk.invariants.map((i) => `  - ${flat(i)}`)];
  for (const m of sk.milestones) {
    out.push("", `## ${m.id}: ${flat(m.goal)} (branch: ${m.branch}; depends: ${list(m.dependsOn)})`, `Acceptance: ${list(m.acceptance, "; ")}`);
    for (const t of m.tasks) {
      const files = [...t.files, ...(t.create ?? []).map((f) => `${f} (new)`)];
      out.push(`- [${ticks.has(t.id) ? "x" : " "}] ${t.id}: ${flat(t.goal)}`,
        `  files: ${list(files)} · forbidden: ${list(t.forbidden, "; ")} · check: \`${flat(t.check)}\` · depends: ${list(t.dependsOn)}`);
    }
  }
  out.push("", SUMMARY, "", "```json", canonical(sk), "```", "</details>", "");
  return out.join("\n");
}

/** The skeleton from the last JSON block and the ticked task ids above it; undefined without a readable block. */
export function parsePlan(text: string): { sk: Skeleton; ticks: Set<string> } | undefined {
  const lines = text.split("\n"), at = lines.lastIndexOf(SUMMARY);
  if (at < 0) return undefined;
  const open = lines.indexOf("```json", at), close = open < 0 ? -1 : lines.indexOf("```", open + 1);
  if (close < 0) return undefined;
  let sk: unknown;
  try { sk = JSON.parse(lines.slice(open + 1, close).join("\n")); } catch { return undefined; }
  if (typeof sk !== "object" || sk === null || !Array.isArray((sk as Skeleton).milestones)) return undefined;
  const ticks = new Set<string>();
  for (const l of lines.slice(0, at)) {
    const m = TICK.exec(l);
    if (m?.[1] === "x") ticks.add(m[2]!);
  }
  return { sk: sk as Skeleton, ticks };
}

export const TICK = /^- \[( |x)\] (M\d+\.T\d+):/;

/** L7.T3 (design §3.5.6): `after` differs from `before` only in `[ ]`→`[x]` on task lines; `flipped` in file order. */
export function tickOnly(before: string, after: string): { ok: true; flipped: string[] } | { ok: false } {
  const b = before.split("\n"), a = after.split("\n"), flipped: string[] = [];
  if (a.length !== b.length) return { ok: false };
  for (let i = 0; i < b.length; i++) {
    if (a[i] === b[i]) continue;
    const m = TICK.exec(b[i]!);
    if (m?.[1] !== " " || a[i] !== `- [x]${b[i]!.slice(5)}`) return { ok: false };
    flipped.push(m[2]!);
  }
  return { ok: true, flipped };
}

// L7.T4 (design §3.0.2, §3.5.5, D53): the replan triggers and the plan record the store keeps (core/local/plans.ts).
export const TRIGGERS = ["non-whitelisted", "interface-break", "regression", "over-budget", "remediation-failed"] as const;
export type TriggerKind = (typeof TRIGGERS)[number];
/** `id`: `t<n>`, per plan (D53); `task`: the plan task it was opened for. */
export type Trigger = { id: string; kind: TriggerKind; task?: string; open: boolean; /** Rejected amendments (L7.T15). */ rejected?: number };
/** `repo`: the repository's root (beyond design §3.0.2: a plan belongs to one repository); `file`: the plan file,
 *  relative to it; `approvedBy`: the approving review's id. */
export type PlanRecord = { slug: string; repo: string; file: string; skeletonHash: string; approvedBy: string; triggers: Trigger[] };
