// Local mode L4.T6 (design §3.2.3, plan S18): `submit_verdict`'s schema and the harness rules. Pure.
// V1: a fence, a repeated id, or a target outside the reviewed diff or plan sends the verdict back for resubmission.
// V2: the findings decide (`approve`); the `verdict` field is advisory, a mismatch is `inconsistent`.
// V3: the local model reads one line per finding (`findingLine`).
import { check, type Schema } from "./schema.ts";

export const CATEGORIES = ["correctness", "check", "scope", "plan", "interface", "security", "concurrency",
  "data-loss", "performance", "maintainability", "approach"] as const;
export type Finding = { id: string; category: (typeof CATEGORIES)[number]; target: string; defect: string; evidence: string; fix: string; blocking: boolean };
export type Verdict = { verdict: "APPROVE" | "REVISE"; summary: string; findings: Finding[] };

export const VERDICT_SCHEMA: Schema = {
  type: "object", additionalProperties: false,
  required: ["verdict", "summary", "findings"],
  properties: {
    verdict: { enum: ["APPROVE", "REVISE"] },
    summary: { type: "string", maxLength: 500 },
    findings: { type: "array", maxItems: 20, items: {
      type: "object", additionalProperties: false,
      required: ["id", "category", "target", "defect", "evidence", "fix", "blocking"],
      properties: {
        id: { type: "string", pattern: "^F[0-9]{1,2}$" },
        category: { enum: CATEGORIES },
        target: { type: "string", maxLength: 200, description: "path[:line] or plan task id" },
        defect: { type: "string", maxLength: 400 },
        evidence: { type: "string", maxLength: 400 },
        fix: { type: "string", maxLength: 300, description: "required-fix criterion: a checkable condition, not code" },
        blocking: { type: "boolean" },
      } } },
  },
};

const TASK_ID = /^M[0-9]{1,2}(\.T[0-9]{1,2})?$/;
const FENCE = "```";
/** A target's path: `path[:line[-line]]` without the line part. */
export const targetPath = (t: string) => t.replace(/:\d+(-\d+)?$/, "");

/** Paths of the strings in `v` that contain a code fence. */
const fences = (v: unknown, at: string): string[] =>
  typeof v === "string" ? (v.includes(FENCE) ? [at] : [])
  : Array.isArray(v) ? v.flatMap((x, i) => fences(x, `${at}[${i}]`))
  : typeof v === "object" && v !== null ? Object.entries(v).flatMap(([k, x]) => fences(x, `${at}.${k}`))
  : [];

/** `targets`: the paths of the reviewed diff or plan; absent or empty → targets are not checked. */
export function validateVerdict(x: unknown, targets?: ReadonlySet<string>): { ok: true; value: Verdict } | { ok: false; reasons: string[] } {
  const reasons = [...check(VERDICT_SCHEMA, x), ...fences(x, "$").map((p) => `${p}: contains a code fence`)];
  const fs = (x as { findings?: unknown } | null)?.findings;
  const items = Array.isArray(fs) ? fs.filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null) : [];
  const ids = new Set<unknown>();
  for (const f of items) {
    if (typeof f.id === "string" && ids.has(f.id)) reasons.push(`duplicate id ${f.id}`);
    ids.add(f.id);
    const t = f.target;
    if (targets?.size && typeof t === "string" && !targets.has(targetPath(t)) && !TASK_ID.test(t)) reasons.push(`target ${t} is not in the diff or plan`);
  }
  return reasons.length ? { ok: false, reasons } : { ok: true, value: x as Verdict };
}

export const approve = (fs: readonly Finding[]): boolean => fs.every((f) => !f.blocking);
export const inconsistent = (v: Verdict): boolean => (v.verdict === "APPROVE") !== approve(v.findings);

const trim = (s: string) => s.replace(/[.\s]+$/, "");
export const findingLine = (f: Finding): string =>
  `${f.id} [${f.blocking ? "blocking" : "non-blocking"}] ${f.category} ${f.target}: ${trim(f.defect)}. Evidence: ${trim(f.evidence)}. Fix when: ${trim(f.fix)}`;
