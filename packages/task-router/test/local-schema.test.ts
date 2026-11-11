// Local mode L4.T5 (plan S17): the JSON-schema subset the submit tools validate with. A property over seeded random
// schemas: a generated valid value has no reason; each single mutation of it has exactly one, prefixed with its path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { check, type Schema } from "../core/local/schema.ts";

/** Seeded mulberry32: an integer in [0, n). */
const seeded = (seed: number) => (n: number): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296 * n) | 0;
};
type Rnd = (n: number) => number;
const pick = <T>(rnd: Rnd, xs: readonly T[]): T => xs[rnd(xs.length)]!;

/** Patterns the generator uses: a matching value, a miss (≤ 4 characters), and a matching value of length n if any. */
const PATTERNS: Record<string, { ok: (rnd: Rnd) => string; miss: string; long?: (n: number) => string }> = {
  "^F[0-9]{1,2}$": { ok: (rnd) => `F${rnd(100)}`, miss: "F100" },
  "^[a-z]+(-[a-z]+)*$": { ok: (rnd) => pick(rnd, ["a", "ab-cd", "x-y-z"]), miss: "A-", long: (n) => "a".repeat(n) },
};
const ENUMS: readonly (readonly string[])[] = [["APPROVE", "REVISE"], ["merge", "steer", "delta"]];

function randomSchema(rnd: Rnd, depth: number): Schema {
  const kind = pick(rnd, depth > 0 ? ["object", "object", "array", "string", "boolean", "number", "enum"] : ["string", "boolean", "number", "enum"]);
  const desc = rnd(3) === 0 ? { description: "d" } : {};
  switch (kind) {
    case "string": {
      const pattern = rnd(3) === 0 ? pick(rnd, Object.keys(PATTERNS)) : undefined;
      return { type: "string", ...(rnd(2) === 0 && { maxLength: 5 + rnd(10) }), ...(pattern && { pattern }), ...desc };
    }
    case "enum": return { ...(rnd(2) === 0 && { type: "string" as const }), enum: pick(rnd, ENUMS), ...desc };
    case "boolean": return { type: "boolean", ...desc };
    case "number": return { type: "number" };
    case "array": {
      const min = rnd(3);
      return { type: "array", items: randomSchema(rnd, depth - 1), ...(min > 0 && { minItems: min }), ...(rnd(2) === 0 && { maxItems: min + 1 + rnd(3) }) };
    }
    default: {
      const keys = Array.from({ length: 1 + rnd(4) }, (_, i) => `k${i}`);
      const properties = Object.fromEntries(keys.map((k) => [k, randomSchema(rnd, depth - 1)]));
      return { type: "object", properties, required: keys.filter(() => rnd(2) === 0), ...(rnd(2) === 0 && { additionalProperties: false as const }), ...desc };
    }
  }
}

function validValue(rnd: Rnd, s: Schema): unknown {
  if (s.enum) return pick(rnd, s.enum);
  switch (s.type) {
    case "string":
      if (s.pattern) return PATTERNS[s.pattern]!.ok(rnd);
      return Array.from({ length: rnd((s.maxLength ?? 10) + 1) }, () => pick(rnd, ["a", "b", " ", "é"])).join("");
    case "boolean": return rnd(2) === 0;
    case "number": return rnd(100) - 50 + 0.5;
    case "array": {
      const min = s.minItems ?? 0, max = s.maxItems ?? min + 3;
      return Array.from({ length: min + rnd(max - min + 1) }, () => validValue(rnd, s.items!));
    }
    default: {
      const req = new Set(s.required ?? []);
      return Object.fromEntries(Object.entries(s.properties ?? {}).filter(([k]) => req.has(k) || rnd(2) === 0).map(([k, p]) => [k, validValue(rnd, p)]));
    }
  }
}

type Path = (string | number)[];
const render = (p: Path) => "$" + p.map((k) => (typeof k === "number" ? `[${k}]` : `.${k}`)).join("");
type Mutation = { what: string; path: Path; apply: (root: unknown) => unknown };

/** Replace (or, with `undefined`, delete) the value at `path`; the root itself when the path is empty. */
const setAt = (root: unknown, path: Path, f: (v: unknown) => unknown): unknown => {
  if (path.length === 0) return f(root);
  const copy = structuredClone(root) as Record<string | number, unknown>;
  let o = copy;
  for (const k of path.slice(0, -1)) o = o[k] as Record<string | number, unknown>;
  const last = path[path.length - 1]!, v = f(o[last]);
  if (v === undefined) delete o[last];
  else o[last] = v;
  return copy;
};
const WRONG: Record<string, unknown> = { string: 7, number: "7", boolean: "true", array: {}, object: [] };

function mutations(rnd: Rnd, s: Schema, v: unknown, path: Path): Mutation[] {
  const out: Mutation[] = [];
  const at = (what: string, p: Path, f: (x: unknown) => unknown) => out.push({ what, path: p, apply: (root) => setAt(root, p, f) });
  if (s.type) at(`wrong type (${s.type})`, path, () => WRONG[s.type!]);
  if (s.enum) at("enum miss", path, () => "zz-miss");
  if (s.type === "string" && s.pattern) at("pattern miss", path, () => PATTERNS[s.pattern!]!.miss);
  if (s.type === "string" && s.maxLength !== undefined && (!s.pattern || PATTERNS[s.pattern]!.long))
    at("over maxLength", path, () => (s.pattern ? PATTERNS[s.pattern]!.long!(s.maxLength! + 1) : "é".repeat(s.maxLength! + 1)));
  if (s.type === "array") {
    const xs = v as unknown[];
    if (s.maxItems !== undefined) at("over maxItems", path, () => [...xs, ...Array.from({ length: s.maxItems! + 1 - xs.length }, () => validValue(rnd, s.items!))]);
    if (s.minItems) at("under minItems", path, () => xs.slice(0, s.minItems! - 1));
    xs.forEach((x, i) => out.push(...mutations(rnd, s.items!, x, [...path, i])));
  }
  if (s.type === "object") {
    const o = v as Record<string, unknown>;
    for (const k of s.required ?? []) at("drop required", [...path, k], () => undefined);
    if (s.additionalProperties === false) out.push({ what: "extra key", path: [...path, "zz"], apply: (root) => setAt(root, path, (x) => ({ ...(x as object), zz: 1 })) });
    for (const [k, p] of Object.entries(s.properties ?? {})) if (k in o) out.push(...mutations(rnd, p, o[k], [...path, k]));
  }
  return out;
}

test("schema: a generated valid value has no reason (property, 300 random schemas)", () => {
  const rnd = seeded(20260517);
  for (let i = 0; i < 300; i++) {
    const s = randomSchema(rnd, 3), v = validValue(rnd, s);
    assert.deepEqual(check(s, v), [], JSON.stringify({ s, v }));
  }
});

test("schema: each single mutation has exactly one reason, prefixed with the mutated path (property)", () => {
  const rnd = seeded(4242);
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const s = randomSchema(rnd, 3), v = validValue(rnd, s);
    for (const m of mutations(rnd, s, v, [])) {
      seen.add(m.what);
      const r = check(s, m.apply(v));
      const ctx = JSON.stringify({ what: m.what, path: render(m.path), s, v });
      assert.equal(r.length, 1, `${ctx} → ${JSON.stringify(r)}`);
      assert.ok(r[0]!.startsWith(`${render(m.path)}: `), `${ctx} → ${r[0]}`);
    }
  }
  // Every mutation kind came up.
  assert.deepEqual([...seen].map((w) => w.replace(/ \(.*\)$/, "")).filter((w, i, a) => a.indexOf(w) === i).sort(),
    ["drop required", "enum miss", "extra key", "over maxItems", "over maxLength", "pattern miss", "under minItems", "wrong type"]);
});

test("schema: reasons pinned (path syntax, texts), `description` ignored, `at` is the prefix", () => {
  const s: Schema = {
    type: "object", additionalProperties: false, required: ["id", "n"],
    properties: { id: { type: "string", pattern: "^F[0-9]{1,2}$", description: "x" }, n: { type: "array", maxItems: 1, items: { enum: ["a"] } } },
  };
  assert.deepEqual(check(s, { id: "G1", n: ["a", "b"], q: 1 }), [
    "$.id: must match ^F[0-9]{1,2}$",
    "$.n: must have at most 1 items",
    "$.n[1]: must be one of a",
    "$.q: is not allowed",
  ]);
  assert.deepEqual(check(s, {}), ["$.id: is required", "$.n: is required"]);
  assert.deepEqual(check(s, null), ["$: must be object"]);
  assert.deepEqual(check({ type: "string", maxLength: 2 }, "abc", "$.x"), ["$.x: must be at most 2 characters"]);
  assert.deepEqual(check({ type: "array", minItems: 2, items: { type: "boolean" } }, [1]), ["$: must have at least 2 items", "$[0]: must be boolean"]);
  assert.deepEqual(check({ type: "number" }, Number.NaN), ["$: must be number"]);
});
