import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRatelimit } from "../core/ratelimit.ts";

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

test("known headers map to quota fields (fraction → percent, epoch s → ISO)", () => {
  const q = parseRatelimit({
    [P + "unified-5h-utilization"]: "0.09",
    [P + "unified-5h-reset"]: "1790000000",
    [P + "unified-7d-utilization"]: "0.41",
    [P + "unified-7d-reset"]: "1790500000",
    [P + "unified-overage-status"]: "rejected",
    [P + "unified-representative-claim"]: "five_hour",
    [P + "unified-fallback-percentage"]: "0.5",
  });
  assert.equal(q.q5h, 9);
  assert.equal(q.q5hReset, new Date(1790000000 * 1000).toISOString());
  assert.equal(q.q7d, 41);
  assert.equal(q.q7dReset, new Date(1790500000 * 1000).toISOString());
  assert.equal(q.overage, "rejected");
  assert.equal(q.claim, "five_hour");
  assert.equal(q.fallback, "0.5");
});

test("unknown anthropic-ratelimit-* keys stay in raw, known ones too", () => {
  const h = { [P + "unified-status"]: "allowed", [P + "unified-5h-utilization"]: "0.10" };
  assert.deepEqual(parseRatelimit(h).raw, h);
});

test("non-ratelimit headers are excluded; keys compared case-insensitively", () => {
  const q = parseRatelimit({
    "request-id": "req_1",
    "content-type": "x",
    "Anthropic-RateLimit-Unified-5h-Utilization": "0.25",
    "x-anthropic-ratelimit-foo": "1",
  });
  assert.deepEqual(q.raw, { [P + "unified-5h-utilization"]: "0.25" });
  assert.equal(q.q5h, 25);
});

test("malformed numbers → field absent", () => {
  const q = parseRatelimit({
    [P + "unified-5h-utilization"]: "abc",
    [P + "unified-5h-reset"]: "soon",
    [P + "unified-7d-utilization"]: "",
    [P + "unified-7d-reset"]: "1e999",
  });
  for (const k of ["q5h", "q5hReset", "q7d", "q7dReset"]) assert.equal(k in q, false, k);
});

test("empty input → only raw = {}", () => {
  assert.deepEqual(parseRatelimit({}), { raw: {} });
});

test("P-rl: total, and keys(raw) = ratelimit-prefixed keys, for 300 random inputs", () => {
  const r = prng(42);
  const pick = <T,>(a: T[]): T => a[Math.floor(r() * a.length)];
  const vals = ["0.09", "", "NaN", "-1", "1e999", "99999999999999999999", "x", "12", "0.5", "\u0000", "1790000000"];
  const names = ["unified-5h-utilization", "unified-5h-reset", "unified-7d-utilization", "unified-7d-reset",
    "unified-overage-status", "unified-representative-claim", "unified-fallback-percentage", "foo", ""];
  for (let n = 0; n < 300; n++) {
    const h: Record<string, string> = {};
    for (let i = 0, c = Math.floor(r() * 12); i < c; i++) {
      const base = r() < 0.6 ? P + pick(names) : pick(["request-id", "x-" + P + "a", "retry-after", "content-length"]);
      h[r() < 0.3 ? base.toUpperCase() : base] = pick(vals);
    }
    const q = parseRatelimit(h);
    const want = [...new Set(Object.keys(h).map((k) => k.toLowerCase()).filter((k) => k.startsWith(P)))].sort();
    assert.deepEqual(Object.keys(q.raw).sort(), want);
    for (const k of ["q5h", "q7d"] as const) if (q[k] !== undefined) assert.ok(Number.isFinite(q[k]));
    for (const k of ["q5hReset", "q7dReset"] as const)
      if (q[k] !== undefined) assert.ok(!Number.isNaN(Date.parse(q[k])));
  }
});
