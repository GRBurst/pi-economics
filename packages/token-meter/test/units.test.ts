// units.ts is the one place the core/analyse/* modules turn a meter line into dollars (redesign M0.S, T0.5): every $
// they read goes through apiUsd(line), so a price rule (M2a: 1 h cache writes) changes one function; so do the three core modules
// analyse/* calls (arms.ts, tasks.ts, ledger.ts), checked at the end of this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { allocate, apiUsd, PI_PRICES_1H } from "../core/analyse/units.ts";
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

// The only mentions of costUsd in analyse/* outside units.ts: the TaskCost field (tasks.ts's result, not a meter line) and prose.
const NOT_A_LINE = ["{ accepted: 0, judged: 0, costUsd: 0, perAccepted: NaN }", "usd: c?.costUsd ?? 0", "recovered from the lines' costUsd"];

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
