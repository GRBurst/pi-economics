// Local mode L4.T6 (design §3.2.3, plan S18): the verdict schema and the harness rules V1–V3. Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { approve, CATEGORIES, type Finding, findingLine, inconsistent, targetPath, validateVerdict, type Verdict, VERDICT_SCHEMA } from "../core/local/verdict.ts";

const seeded = (seed: number) => (n: number): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296 * n) | 0;
};
type Rnd = (n: number) => number;
const pick = <T>(rnd: Rnd, xs: readonly T[]): T => xs[rnd(xs.length)]!;

const TARGETS = new Set(["src/a.ts", "src/b.ts", "docs/plan.md"]);
const finding = (rnd: Rnd, i: number): Finding => ({
  id: `F${i + 1}`, category: pick(rnd, CATEGORIES), target: pick(rnd, ["src/a.ts:42", "src/b.ts", "src/a.ts:3-9", "M1.T2", "M3"]),
  defect: "the loop skips the last element.", evidence: "a.ts:42 uses < n - 1", fix: "the test over n = 1 passes", blocking: rnd(2) === 0,
});
const verdict = (rnd: Rnd): Verdict => ({
  verdict: pick(rnd, ["APPROVE", "REVISE"] as const), summary: "two findings",
  findings: Array.from({ length: rnd(6) }, (_, i) => finding(rnd, i)),
});

test("VERDICT_SCHEMA is design §3.2.3, verbatim", () => {
  assert.deepEqual(VERDICT_SCHEMA, {
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
          category: { enum: ["correctness", "check", "scope", "plan", "interface", "security", "concurrency",
            "data-loss", "performance", "maintainability", "approach"] },
          target: { type: "string", maxLength: 200, description: "path[:line] or plan task id" },
          defect: { type: "string", maxLength: 400 },
          evidence: { type: "string", maxLength: 400 },
          fix: { type: "string", maxLength: 300, description: "required-fix criterion: a checkable condition, not code" },
          blocking: { type: "boolean" },
        } } },
    },
  });
});

test("AC-O2: approve ⇔ no blocking finding; inconsistent ⇔ (verdict = APPROVE) ≠ approve; the generated verdicts are valid (property)", () => {
  const rnd = seeded(31337);
  let both = 0;
  for (let i = 0; i < 500; i++) {
    const v = verdict(rnd);
    assert.deepEqual(validateVerdict(v, TARGETS), { ok: true, value: v });
    const a = approve(v.findings);
    assert.equal(a, !v.findings.some((f) => f.blocking));
    assert.equal(inconsistent(v), (v.verdict === "APPROVE") !== a);
    if (inconsistent(v) && a) both++;
  }
  assert.ok(both > 0);
});

test("V1: a code fence in any string → not ok, the reason names the path", () => {
  const v = verdict(seeded(5));
  const base: Verdict = { ...v, findings: [finding(seeded(6), 0), finding(seeded(7), 1)] };
  const at: [string, (x: Verdict) => void][] = [
    ["$.summary", (x) => { x.summary = "see ```ts x```"; }],
    ["$.findings[1].target", (x) => { x.findings[1]!.target = "```"; }],
    ["$.findings[0].defect", (x) => { x.findings[0]!.defect = "a ``` b"; }],
    ["$.findings[1].evidence", (x) => { x.findings[1]!.evidence = "```"; }],
    ["$.findings[0].fix", (x) => { x.findings[0]!.fix = "```js\nf()\n```"; }],
  ];
  for (const [path, f] of at) {
    const x = structuredClone(base);
    f(x);
    const r = validateVerdict(x);
    assert.equal(r.ok, false, path);
    if (!r.ok) assert.ok(r.reasons.includes(`${path}: contains a code fence`), JSON.stringify(r.reasons));
  }
});

test("V1: a repeated id → `duplicate id F<n>`; schema reasons pass through", () => {
  const f = finding(seeded(1), 0);
  const r = validateVerdict({ verdict: "REVISE", summary: "s", findings: [f, { ...f, target: "src/b.ts" }] });
  assert.deepEqual(r, { ok: false, reasons: ["duplicate id F1"] });
  const s = validateVerdict({ verdict: "MAYBE", summary: "s", findings: [] });
  assert.deepEqual(s, { ok: false, reasons: ["$.verdict: must be one of APPROVE, REVISE"] });
  assert.equal(validateVerdict("x").ok, false);
});

test("V1: a target outside `targets` (after targetPath) and not a task id → a reason; no targets → no target reason", () => {
  assert.equal(targetPath("src/a.ts:42"), "src/a.ts");
  assert.equal(targetPath("src/a.ts:3-9"), "src/a.ts");
  assert.equal(targetPath("src/a.ts"), "src/a.ts");
  const f = (target: string): Verdict => ({ verdict: "REVISE", summary: "s", findings: [{ ...finding(seeded(2), 0), target }] });
  assert.deepEqual(validateVerdict(f("src/c.ts:1"), TARGETS), { ok: false, reasons: ["target src/c.ts:1 is not in the diff or plan"] });
  assert.deepEqual(validateVerdict(f("M12.T3"), TARGETS), { ok: true, value: f("M12.T3") });
  assert.deepEqual(validateVerdict(f("M1.T"), TARGETS), { ok: false, reasons: ["target M1.T is not in the diff or plan"] });
  assert.equal(validateVerdict(f("src/c.ts:1")).ok, true);
  assert.equal(validateVerdict(f("src/c.ts:1"), new Set()).ok, true);
});

test("V3: one line per finding (trailing dots trimmed), pinned", () => {
  const b: Finding = { id: "F1", category: "correctness", target: "src/a.ts:42", defect: "off by one...", evidence: "the loop ends at n - 1. ", fix: "the n = 1 test passes.", blocking: true };
  const n: Finding = { id: "F2", category: "maintainability", target: "M1.T2", defect: "name unclear", evidence: "x", fix: "renamed", blocking: false };
  assert.equal(findingLine(b), "F1 [blocking] correctness src/a.ts:42: off by one. Evidence: the loop ends at n - 1. Fix when: the n = 1 test passes");
  assert.equal(findingLine(n), "F2 [non-blocking] maintainability M1.T2: name unclear. Evidence: x. Fix when: renamed");
});
