import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLine, monthFile, serialize } from "../core/line.ts";
import type { LineInput, MeterLine } from "../core/line.ts";
import type { Billing } from "../core/plans.ts";

const BILLINGS: Billing[] = ["subscription", "api", "free", "local"];

const P = "anthropic-ratelimit-";

function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const K_ALLOWED = new Set([
  "v", "ts", "sessionId", "parentSessionId", "arm", "provider", "model", "effort", "kind",
  "input", "cacheRead", "cacheWrite", "output", "reasoning", "costUsd", "status", "retries", "retryWaitMs",
  "q5h", "q5hReset", "q7d", "q7dReset", "overage", "claim", "fallback", "errorClass", "rawRatelimit",
  // v2 (design §5.2)
  "design", "billing", "cacheWrite1h", "durationMs", "ttftMs", "errorKind",
]);

const now = new Date("2026-10-02T12:34:56.789Z");
const base: LineInput = { now, sessionId: "s1", provider: "anthropic", model: "m", kind: "turn",
  status: 200, retries: 0, retryWaitMs: 0 };

// v: 1 → 2 (M3a): the writer emits meter line v2 (design §5.2).
test("buildLine: minimal input", () => {
  assert.deepEqual(buildLine(base), { v: 2, ts: now.toISOString(), sessionId: "s1", provider: "anthropic",
    model: "m", kind: "turn", status: 200, retries: 0, retryWaitMs: 0 });
});

test("buildLine: usage, quota and raw headers are flattened in", () => {
  const l = buildLine({ ...base, effort: "high", arm: "a1", parentSessionId: "p",
    usage: { input: 1, cacheRead: 2, cacheWrite: 3, output: 4, reasoning: 5, costUsd: 0.5 },
    snap: { status: 200, at: 1, headers: { [P + "unified-5h-utilization"]: "0.09", "request-id": "r" } } });
  assert.equal(l.input, 1); assert.equal(l.cacheRead, 2); assert.equal(l.cacheWrite, 3);
  assert.equal(l.output, 4); assert.equal(l.reasoning, 5); assert.equal(l.costUsd, 0.5);
  assert.equal(l.q5h, 9); assert.equal(l.effort, "high"); assert.equal(l.arm, "a1");
  assert.equal(l.parentSessionId, "p");
  assert.deepEqual(l.rawRatelimit, { [P + "unified-5h-utilization"]: "0.09" });
  assert.equal("raw" in l, false);
});

test("buildLine: error line has errorClass from leading HTTP code, no usage, no message text", () => {
  const l = buildLine({ ...base, status: "error", errorMessage: "429: rate limited, secret text" });
  assert.equal(l.errorClass, "429");
  assert.equal(JSON.stringify(l).includes("secret"), false);
  assert.equal(buildLine({ ...base, status: "error", errorMessage: "boom" }).errorClass, "error");
  assert.equal(buildLine({ ...base, status: "error" }).errorClass, "error");
  assert.equal("errorClass" in buildLine(base), false);
});

test("buildLine: an error line has errorKind from its status and message; others have none", () => {
  assert.equal(buildLine({ ...base, status: "error", errorMessage: "400 prompt is too long: 9 tokens > 8 maximum" }).errorKind, "context_overflow");
  assert.equal(buildLine({ ...base, status: "error", errorMessage: "429: secret" }).errorKind, "rate_limit");
  assert.equal(buildLine({ ...base, status: "error" }).errorKind, "other");
  assert.equal("errorKind" in buildLine(base), false);
  assert.equal("errorKind" in buildLine({ ...base, status: 429 }), false, "a status line is no error line");
});

test("serialize: one line ending in \\n, round-trips", () => {
  const l = buildLine(base);
  const s = serialize(l);
  assert.ok(s.endsWith("\n"));
  assert.equal(s.indexOf("\n"), s.length - 1);
  assert.deepEqual(JSON.parse(s), l);
});

test("monthFile: UTC month, settings dir relative or absolute", () => {
  assert.equal(monthFile("/a", new Date("2026-10-31T23:59:59Z")), "/a/meter/2026-10.jsonl");
  assert.equal(monthFile("/a", new Date("2026-12-31T23:59:59-05:00")), "/a/meter/2027-01.jsonl");
  assert.equal(monthFile("/a", now, "m2"), "/a/m2/2026-10.jsonl");
  assert.equal(monthFile("/a", now, "/abs/dir"), "/abs/dir/2026-10.jsonl");
});

function genString(r: () => number): string {
  const n = r() < 0.2 ? 0 : Math.floor(r() * (r() < 0.5 ? 40 : 3000));
  const alpha = ["a", "Z", "é", "漢", "😀", "\n", "\u0000", '"', "\\"];
  let s = "";
  for (let i = 0; i < n; i++) s += alpha[Math.floor(r() * alpha.length)];
  return s;
}

function genInput(r: () => number): LineInput & { message: { content: string } } {
  const num = () => Math.floor(r() * 1e6);
  const opt = <T,>(f: () => T): T | undefined => (r() < 0.5 ? f() : undefined);
  const headers: Record<string, string> = {};
  for (let i = 0, c = r() < 0.5 ? 200 : Math.floor(r() * 10); i < c; i++)
    headers[(r() < 0.8 ? P : "x-") + "k" + i + genString(r).slice(0, 20)] = genString(r);
  return {
    now: new Date(Math.floor(r() * 4e12)),
    sessionId: genString(r), parentSessionId: opt(() => genString(r)), arm: opt(() => genString(r)),
    provider: genString(r), model: genString(r), effort: opt(() => genString(r)),
    design: opt(() => genString(r)), billing: opt(() => BILLINGS[Math.floor(r() * BILLINGS.length)]!),
    durationMs: opt(num), ttftMs: opt(num),
    kind: (["turn", "warming", "nested"] as const)[Math.floor(r() * 3)],
    usage: opt(() => ({ input: num(), cacheRead: num(), cacheWrite: num(), output: num(),
      reasoning: opt(num), costUsd: opt(() => r()), cacheWrite1h: opt(num) })),
    status: r() < 0.5 ? "error" : 200 + Math.floor(r() * 400),
    errorMessage: opt(() => genString(r)),
    retries: opt(() => Math.floor(r() * 5)), retryWaitMs: opt(num),
    snap: opt(() => ({ status: 200, at: num(), headers })),
    message: { content: "MESSAGE-BODY-" + genString(r) },
  };
}

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
}

test("P-keys: keys ⊆ K_allowed and strings ≤ 256 over 300 generated inputs (message text present)", () => {
  const r = prng(7);
  for (let n = 0; n < 300; n++) {
    const input = genInput(r);
    for (const l of [buildLine(input), JSON.parse(serialize(buildLine(input))) as MeterLine]) {
      for (const k of Object.keys(l)) assert.ok(K_ALLOWED.has(k), `unexpected key ${k}`);
      for (const s of strings(l.rawRatelimit ? { ...l, rawRatelimit: undefined } : l))
        assert.ok(s.length <= 256, `string of ${s.length}`);
      assert.equal(JSON.stringify(l).includes("MESSAGE-BODY-"), false);
    }
  }
});

test("P-size: serialize < 4096 bytes with 200 raw headers and over generated inputs", () => {
  const headers: Record<string, string> = {};
  for (let i = 0; i < 200; i++) headers[P + "h" + i] = "v".repeat(200);
  const l = buildLine({ ...base, snap: { status: 200, at: 1, headers } });
  assert.ok(Object.keys(l.rawRatelimit ?? {}).length === 200);
  const s = serialize(l);
  assert.ok(Buffer.byteLength(s) < 4096);
  assert.equal(JSON.parse(s).rawRatelimit, undefined);
  const r = prng(99);
  for (let n = 0; n < 300; n++) {
    const out = serialize(buildLine(genInput(r)));
    assert.ok(Buffer.byteLength(out) < 4096, `${Buffer.byteLength(out)} bytes`);
    assert.ok(out.endsWith("\n") && out.indexOf("\n") === out.length - 1);
    JSON.parse(out);
  }
});

// M3a T3a.11: the v2 fields fit the cap next to the v1 ones; only rawRatelimit goes, nothing is shrunk.
test("P-size v2: every field at its largest (256-character strings, the largest numbers, 200 raw headers) → < 4096 bytes, only rawRatelimit dropped", () => {
  const s = "x".repeat(300), big = Number.MAX_SAFE_INTEGER;
  const headers: Record<string, string> = { [P + "unified-5h-utilization"]: "0.99", [P + "unified-7d-utilization"]: "0.99",
    [P + "unified-5h-reset"]: "4102444800", [P + "unified-7d-reset"]: "4102444800", [P + "unified-overage-status"]: s,
    [P + "unified-representative-claim"]: s, [P + "unified-fallback-percentage"]: s };
  for (let i = 0; i < 200; i++) headers[P + "h" + i] = "v".repeat(200);
  const l = buildLine({ now, sessionId: s, parentSessionId: s, arm: s, design: s, provider: s, model: s, effort: s,
    kind: "warming", billing: "subscription", status: "error", errorMessage: "400 prompt is too long",
    usage: { input: big, cacheRead: big, cacheWrite: big, cacheWrite1h: big, output: big, reasoning: big, costUsd: Number.MAX_VALUE },
    retries: big, retryWaitMs: big, durationMs: big, ttftMs: big, snap: { status: 200, at: 1, headers } });
  for (const k of K_ALLOWED) assert.ok(k in l, `${k} missing from the largest line`);
  const out = serialize(l);
  assert.ok(Buffer.byteLength(out) < 4096, `${Buffer.byteLength(out)} bytes`);
  const { rawRatelimit, ...rest } = l;
  assert.deepEqual(JSON.parse(out), rest);
});

// Absent = unknown, never 0 (design §5.2): a v2 field is on the line iff its input carries a measurement, with its value.
test("P-absent: every v2 field is present iff given, numbers as given (0 included), over 300 generated inputs", () => {
  const r = prng(11);
  for (let n = 0; n < 300; n++) {
    const i = genInput(r);
    if (r() < 0.3) Object.assign(i, { durationMs: 0, ttftMs: 0 });
    const l = buildLine(i) as Record<string, unknown>;
    const given: Record<string, unknown> = { design: i.design, billing: i.billing, durationMs: i.durationMs, ttftMs: i.ttftMs,
      retries: i.retries, retryWaitMs: i.retryWaitMs,
      cacheWrite1h: i.usage?.cacheWrite1h };
    for (const [k, v] of Object.entries(given)) {
      assert.equal(k in l, v !== undefined, `${k}: given ${JSON.stringify(v)}, line ${JSON.stringify(l[k])}`);
      if (typeof v === "number" || k === "billing") assert.equal(l[k], v, k);
    }
  }
});

test("buildLine: billing and design as given", () => {
  const l = buildLine({ ...base, billing: "local", design: "v4", arm: "+-+" });
  assert.equal(l.billing, "local"); assert.equal(l.design, "v4");
});

test("serialize keeps small raw headers", () => {
  const l = buildLine({ ...base, snap: { status: 200, at: 1, headers: { [P + "a"]: "1" } } });
  assert.deepEqual(JSON.parse(serialize(l)).rawRatelimit, { [P + "a"]: "1" });
});

test("M8 buildLine: the llama.cpp timings are written iff given (promptMs, genMs, cacheN, promptN)", () => {
  assert.deepEqual(pickKeys(buildLine({ ...base, promptMs: 120, genMs: 3500, cacheN: 900, promptN: 100 }), ["promptMs", "genMs", "cacheN", "promptN"]), { promptMs: 120, genMs: 3500, cacheN: 900, promptN: 100 });
  for (const k of ["promptMs", "genMs", "cacheN", "promptN"]) assert.equal(k in buildLine(base), false, `pi-economics: no ${k} unless given`);
});
function pickKeys(l: Record<string, unknown>, ks: string[]): Record<string, unknown> { return Object.fromEntries(ks.filter((k) => k in l).map((k) => [k, l[k]])); }
