// units.ts is the one place the core/analyse/* modules turn a meter line into dollars (redesign M0.S, T0.5): every $
// they read goes through apiUsd(line), so a later price rule (M2a: 1 h cache writes) changes one function. arms.ts,
// tasks.ts and ledger.ts, which analyse/* calls, still read costUsd themselves until M2a routes them through here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { allocate, apiUsd, PI_PRICES_1H } from "../core/analyse/units.ts";
import { world } from "./world.ts";

const lines = (): any[] => world().meter;

test("apiUsd: every line of the world fixture is worth its costUsd (until M2a prices 1h writes)", () => {
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
