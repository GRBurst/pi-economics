// units.ts is the one place that turns a meter line into dollars (redesign M0.S, T0.5): every $ the analyser reads goes
// through apiUsd(line), so a later price rule (M2a: 1 h cache writes) changes one function.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { allocate, apiUsd } from "../core/analyse/units.ts";
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

test("allocate: the token components of a line add up to apiUsd(line)", () => {
  for (const l of lines()) {
    const parts = allocate(l);
    assert.ok(Math.abs(Object.values(parts).reduce((s, x) => s + x, 0) - apiUsd(l)) < 1e-9);
  }
});

test("seam: no analyser module but units.ts reads a line's costUsd (every $ goes through apiUsd)", () => {
  const dir = new URL("../core/analyse/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  assert.ok(files.includes("units.ts") && files.includes("cost.ts") && files.includes("delegation.ts") && files.includes("quality.ts"), `analyser modules: ${files}`);
  for (const f of files.filter((f) => f !== "units.ts")) {
    const text = readFileSync(new URL(f, dir), "utf8");
    assert.ok(!/\bnum\(\w+\.costUsd\)/.test(text), `${f} reads a line's costUsd directly`);
  }
});
