// The plan guard (design §3.5.6; plan L7.T10, G9): an `edit` or `write` of a plan file is computed in memory, and passes only
// when the new text differs from the current one in ticked task boxes alone (`tickOnly`). Pure but for the `read` port; the
// main session's `tool_call` and every routed child's toolGuard run it (core/local/install.ts). Bash is not parsed:
// `start_branch` and `request_merge` re-hash the skeleton.
import { posix, relative, resolve } from "node:path";
import type { BranchRecord } from "./branches.ts";
import { tickOnly } from "./plan.ts";
import { inside } from "./worktree.ts";

export const PLAN_REASON = "change the plan with amend_plan";
/** pi's line endings for an edit (its `normalizeToLF`). */
const lf = (s: string): string => s.replace(/\r\n?/g, "\n");
type Edit = { oldText: string; newText: string };
/** pi 1.4's `edits[]`, and the legacy top-level `oldText`/`newText` (pi folds it into `edits[]`; G9: which shape the
 *  `tool_call` event sees is unpinned, so both count). undefined: no edit, or one that is no pair of strings. */
function editsOf(input: unknown): Edit[] | undefined {
  const i = input as Record<string, unknown> | null;
  if (!i || typeof i !== "object") return undefined;
  const legacy = i.oldText !== undefined || i.newText !== undefined ? [{ oldText: i.oldText, newText: i.newText }] : [];
  const raw = [...(Array.isArray(i.edits) ? i.edits : []), ...legacy] as Array<Record<string, unknown> | null>;
  if (!raw.length || !raw.every((e) => !!e && typeof e.oldText === "string" && typeof e.newText === "string")) return undefined;
  return raw.map((e) => ({ oldText: lf(e!.oldText as string), newText: lf(e!.newText as string) }));
}
/** The text an `edit` makes of `before`, as pi applies it but with exact matching only (pi also matches fuzzily; such an edit
 *  is refused here and passes once its text is exact): every `oldText` occurs once in the original, the edits do not overlap,
 *  and they apply to the original. undefined when it cannot apply. */
export function applyEdit(before: string, input: unknown): string | undefined {
  const es = editsOf(input);
  if (!es) return undefined;
  const text = lf(before);
  const at: Array<{ i: number; n: number; t: string }> = [];
  for (const e of es) {
    const i = text.indexOf(e.oldText);
    if (e.oldText === "" || i < 0 || text.indexOf(e.oldText, i + 1) >= 0) return undefined;
    at.push({ i, n: e.oldText.length, t: e.newText });
  }
  at.sort((a, b) => a.i - b.i);
  let out = "", pos = 0;
  for (const a of at) {
    if (a.i < pos) return undefined;
    out += text.slice(pos, a.i) + a.t;
    pos = a.i + a.n;
  }
  return out + text.slice(pos);
}
/** `files`: the absolute paths of every plan file in every checkout of its repository. A write to one is allowed only when
 *  the result ticks task boxes and changes nothing else; an unreadable plan file, an edit that cannot apply or a `write`
 *  without content is blocked. Every other call passes. Total. */
export function planGuard(x: { tool: string; input: unknown; cwd: string; files: readonly string[]; read(abs: string): string | undefined }): string | undefined {
  if (x.tool !== "edit" && x.tool !== "write") return undefined;
  const i = x.input as { path?: unknown; content?: unknown } | null | undefined;
  if (typeof i?.path !== "string") return undefined;
  const p = resolve(x.cwd, i.path);
  if (!x.files.includes(p)) return undefined;
  const before = x.read(p);
  if (before === undefined) return PLAN_REASON;
  const after = x.tool === "edit" ? applyEdit(before, i) : typeof i.content === "string" ? i.content : undefined;
  return after !== undefined && tickOnly(lf(before), lf(after)).ok ? undefined : PLAN_REASON;
}

// ── the whitelist guard (design §3.5.5, AC-P7; plan L7.T11) ──
export const outsideText = (path: string, trigger: string): string =>
  `${path} is outside the task's files; finish within them or call amend_plan (trigger ${trigger} is open)`;
/** The states whose worktree is still worked in. */
const LIVE: readonly string[] = ["active", "fixer", "blocked"];
/** An `edit` or `write` inside the worktree of a live plan-bound branch must name one of its unit's `files` (files ∪ create,
 *  recorded by `start_branch`) or the plan file (the plan guard's); else `non-whitelisted` opens for the unit (`open`: the
 *  trigger's id, the same while it stays open) and the write is blocked naming it. Every other call passes. Total. */
export function whitelistGuard(x: { tool: string; input: unknown; cwd: string; branches: readonly BranchRecord[];
  planFile(slug: string): string | undefined; open(slug: string, task: string): string | undefined }): string | undefined {
  if (x.tool !== "edit" && x.tool !== "write") return undefined;
  const raw = (x.input as { path?: unknown } | null | undefined)?.path;
  if (typeof raw !== "string") return undefined;
  const p = resolve(x.cwd, raw);
  const rec = x.branches.filter((r) => r.plan && r.files && LIVE.includes(r.state) && inside(p, r.worktree))
    .sort((a, b) => b.worktree.length - a.worktree.length)[0];
  if (!rec?.plan || !rec.files) return undefined;
  const rel = relative(rec.worktree, p);
  const allowed = new Set([...rec.files, x.planFile(rec.plan.slug)].filter((f): f is string => f !== undefined).map((f) => posix.normalize(f)));
  if (allowed.has(rel)) return undefined;
  const id = x.open(rec.plan.slug, rec.plan.id);
  return id === undefined ? `${rel} is outside the task's files; finish within them` : outsideText(rel, id);
}

/** D54 (OQ20): a main call counts its turn toward `plans.taskTurns` when its `path` is under the worktree or its bash `command`
 *  names the worktree's path. */
export function touches(input: unknown, cwd: string, worktree: string): boolean {
  const i = input as { path?: unknown; command?: unknown } | null;
  if (typeof i?.path === "string" && inside(resolve(cwd, i.path), worktree)) return true;
  return typeof i?.command === "string" && i.command.includes(worktree);
}
