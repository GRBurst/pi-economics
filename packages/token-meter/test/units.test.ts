// units.ts is the one place the core/analyse/* modules turn a meter line into dollars (redesign M0.S, T0.5): every $
// they read goes through apiUsd(line), so a price rule (M2a: 1 h cache writes) changes one function; so do the three core modules
// analyse/* calls (arms.ts, tasks.ts, ledger.ts), checked at the end of this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { allocate, apiUsd, cacheWrite1hOf, pIn, PI_PRICES_1H, WEIGHT } from "../core/analyse/units.ts";
import { world } from "./world.ts";

const lines = (): any[] => world().meter;

test("apiUsd: every line of the world fixture is worth its costUsd (pi prices 1 h writes itself, PI_PRICES_1H)", () => {
  const ls = lines().filter((l) => typeof l.costUsd === "number");
  assert.ok(ls.length >= 30, "the fixture has lines with a cost");
  for (const l of ls) assert.equal(apiUsd(l), l.costUsd);
});

test("apiUsd: a line without a finite costUsd is worth 0", () => {
  for (const costUsd of [undefined, null, "1", NaN, Infinity]) assert.equal(apiUsd({ costUsd }), 0);
  assert.equal(apiUsd({}), 0);
});

test("PI_PRICES_1H (T2a.0): pi's costUsd already charges 1 h cache writes at 2 × input, so a line with cacheWrite1h is worth its costUsd, not more", () => {
  assert.equal(PI_PRICES_1H, true);
  const l = { input: 2, cacheRead: 1000, cacheWrite: 500, cacheWrite1h: 500, output: 10, costUsd: 0.123 };
  assert.equal(apiUsd(l), 0.123);
});

test("allocate: the token components of a line add up to apiUsd(line)", () => {
  for (const l of lines()) {
    const parts = allocate(l);
    assert.ok(Math.abs(Object.values(parts).reduce((s, x) => s + x, 0) - apiUsd(l)) < 1e-9);
  }
});

// The mentions of costUsd in analyse/* outside units.ts that are no read of a meter line (none since B5: the $/accepted result is `usd`).
const NOT_A_LINE: string[] = [];

test("seam: no analyse/* module but units.ts mentions costUsd (a read as num(), Number(), ??, [\"costUsd\"] … goes through apiUsd)", () => {
  const dir = new URL("../core/analyse/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  assert.ok(files.includes("units.ts") && files.includes("cost.ts") && files.includes("delegation.ts") && files.includes("quality.ts"), `analyse modules: ${files}`);
  const texts = files.filter((f) => f !== "units.ts").map((f) => [f, readFileSync(new URL(f, dir), "utf8")] as const);
  for (const [f, text] of texts) {
    const rest = NOT_A_LINE.reduce((t, ok) => t.split(ok).join(""), text);
    assert.ok(!rest.includes("costUsd"), `${f} reads a line's costUsd directly: ${rest.split("\n").find((l) => l.includes("costUsd"))?.trim().slice(0, 100)}`);
  }
  for (const ok of NOT_A_LINE) assert.ok(texts.some(([, text]) => text.includes(ok)), `the allowance ${JSON.stringify(ok)} matches nothing: drop it`);
});

// M2a carries the seam to the three core modules the analyser calls (decisions "M0.S review carry-over"): the per-arm $/h and cold-resume
// and fold windows (arms.ts), the quota attribution (arms.ts attributeQuota) and $/accepted (tasks.ts) must reprice with apiUsd, and the
// ledger's prices (ledger.ts) too. What stays are names, not reads of a line: result fields, a column header, prose.
const CORE_NOT_A_LINE: Record<string, string[]> = {
  "arms.ts": ["export type ArmStat = { arm: string; units: number; costUsd: number;", "proportional to their costUsd there", "costUsd: a.cost,", "[\"costUsd\", (s) => f2(s.costUsd)]"],
  "tasks.ts": ["export type TaskCost = { accepted: number; judged: number; costUsd: number; perAccepted: number };", "{ accepted: 0, judged: 0, costUsd: 0, perAccepted: NaN }", "o.costUsd += t.cost;", "o.costUsd / o.accepted"],
  "ledger.ts": [],
};

test("seam: arms.ts, tasks.ts and ledger.ts read no line's costUsd but through apiUsd", () => {
  const dir = new URL("../core/", import.meta.url);
  for (const [f, allowed] of Object.entries(CORE_NOT_A_LINE)) {
    const text = readFileSync(new URL(f, dir), "utf8");
    const rest = allowed.reduce((t, ok) => t.split(ok).join(""), text);
    assert.ok(!rest.includes("costUsd"), `core/${f} reads a line's costUsd directly: ${rest.split("\n").find((l) => l.includes("costUsd"))?.trim().slice(0, 100)}`);
    assert.ok(text.includes("apiUsd"), `core/${f} does not use apiUsd`);
    for (const ok of allowed) assert.ok(text.includes(ok), `the allowance ${JSON.stringify(ok)} matches nothing in core/${f}: drop it`);
  }
});

// ---- B13: 1 h cache writes weigh 2.0 × input, 5-minute writes 1.25 ----

const P = 1e-6; // $ per input token
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 1e-12 + 1e-9 * Math.abs(b), `${a} ≈ ${b}`);
/** A line costed the way pi 1.4 does: input 1, read 0.1, 5-minute write 1.25, 1 h write 2.0, output 5 × P. */
const priced = (tokens: { input: number; cacheRead: number; cacheWrite: number; output: number }, cw1h: number, extra: Record<string, unknown> = {}) => ({
  ...tokens, ...extra,
  costUsd: P * (tokens.input + 0.1 * tokens.cacheRead + 1.25 * (tokens.cacheWrite - cw1h) + 2.0 * cw1h + 5 * tokens.output),
});

test("WEIGHT: Anthropic list ratios, a 1 h write costs 2.0 and a 5-minute write 1.25 × input", () => {
  assert.deepEqual(WEIGHT, { input: 1, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2.0, output: 5 });
});

test("cacheWrite1hOf: the v1 approximation (all writes of a main in a 1h arm) holds for Claude lines only (M2c)", () => {
  const l = { ...priced({ input: 10, cacheRead: 1000, cacheWrite: 1000, output: 5 }, 1000), provider: "llama", model: "qwen3" };
  assert.equal(cacheWrite1hOf(l, true, { mainCacheTtl: "1h" }), 0, "a non-Claude line has no explicit 1 h cache to infer");
  assert.equal(cacheWrite1hOf({ ...l, provider: "anthropic" }, true, { mainCacheTtl: "1h" }), 1000);
  assert.equal(cacheWrite1hOf({ ...l, cacheWrite1h: 200 }, true, { mainCacheTtl: "1h" }), 200, "a measured split still wins");
});

test("cacheWrite1hOf: the line's own cacheWrite1h; else (v1 approximation) all writes of a main session in a mainCacheTtl 1h arm; else 0", () => {
  const l = priced({ input: 10, cacheRead: 1000, cacheWrite: 1000, output: 5 }, 1000, { model: "claude-opus-5-5" });
  assert.equal(cacheWrite1hOf(l, true, { mainCacheTtl: "1h" }), 1000);
  assert.equal(cacheWrite1hOf(l, true, { mainCacheTtl: "5m" }), 0);
  assert.equal(cacheWrite1hOf(l, true, undefined), 0);
  assert.equal(cacheWrite1hOf(l, false, { mainCacheTtl: "1h" }), 0, "a child keeps the 5 minute TTL whatever the arm says");
  assert.equal(cacheWrite1hOf({ ...l, cacheWrite1h: 300 }, true, { mainCacheTtl: "5m" }), 300, "a measured split wins over the arm");
  assert.equal(cacheWrite1hOf({ ...l, cacheWrite1h: 0 }, true, { mainCacheTtl: "1h" }), 0, "a measured 0 is a measurement");
  assert.equal(cacheWrite1hOf({ ...l, cacheWrite1h: 5000 }, true, undefined), 1000, "never more than cacheWrite");
});

test("B13: a 1 h write is 2.0·pIn per token, not 1.25 (1h-arm main, 1000 write tokens)", () => {
  const l = priced({ input: 1000, cacheRead: 0, cacheWrite: 1000, output: 0 }, 1000, { model: "claude-opus-5-5" });
  const cw1h = cacheWrite1hOf(l, true, { mainCacheTtl: "1h" });
  close(pIn(l, cw1h), P);
  const parts = allocate(l, cw1h);
  close(parts.cacheWrite1h, 2.0 * P * 1000);
  close(parts.cacheWrite1h / 1000, 2.0 * pIn(l, cw1h));
  assert.equal(parts.cacheWrite5m, 0);
  close(parts.input, P * 1000);
  close(Object.values(parts).reduce((s, x) => s + x, 0), apiUsd(l));
  // the same tokens in a 5m arm: 1.25
  const m = priced({ input: 1000, cacheRead: 0, cacheWrite: 1000, output: 0 }, 0);
  const five = allocate(m, cacheWrite1hOf(m, true, { mainCacheTtl: "5m" }));
  close(five.cacheWrite5m, 1.25 * P * 1000);
  assert.equal(five.cacheWrite1h, 0);
});

test("B13: with a measured split a line holds both kinds of write; the parts add up to apiUsd", () => {
  const l = priced({ input: 20, cacheRead: 5000, cacheWrite: 800, output: 40 }, 300, { cacheWrite1h: 300 });
  const parts = allocate(l);
  close(parts.cacheWrite1h, 2.0 * P * 300);
  close(parts.cacheWrite5m, 1.25 * P * 500);
  close(parts.cacheRead, 0.1 * P * 5000);
  close(parts.output, 5 * P * 40);
  close(Object.values(parts).reduce((s, x) => s + x, 0), apiUsd(l));
});

test("B13: for a pi that does not price 1 h writes, apiUsd adds the missing 0.75 × pIn per 1 h-written token", () => {
  // that pi charged every write 1.25 × input
  const l = { input: 1000, cacheRead: 0, cacheWrite: 1000, output: 0, costUsd: P * (1000 + 1.25 * 1000) };
  close(apiUsd(l, { cacheWrite1h: 1000, pricesLongWrite: false }), P * (1000 + 2.0 * 1000));
  close(apiUsd(l, { cacheWrite1h: 400, pricesLongWrite: false }), P * (1000 + 1.25 * 1000 + 0.75 * 400));
  assert.equal(apiUsd(l, { cacheWrite1h: 0, pricesLongWrite: false }), l.costUsd, "nothing was written for 1 h: nothing to add");
  assert.equal(apiUsd(l, { cacheWrite1h: 1000 }), l.costUsd, "by default pi priced it: untouched");
});
