// The plan guard (design §3.5.6; plan L7.T10, G9): an `edit` or `write` of a plan file is computed in memory, and passes only
// when the new text differs from the current one in ticked task boxes alone (`tickOnly`). Pure but for the `read` port; the
// main session's `tool_call` and every routed child's toolGuard run it (core/local/install.ts). Bash is not parsed:
// `start_branch` and `request_merge` re-hash the skeleton.
import { resolve } from "node:path";
import { tickOnly } from "./plan.ts";

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
