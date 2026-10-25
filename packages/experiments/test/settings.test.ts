import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { design } from "../core/design.ts";
import { defaults, loadSettings } from "../core/settings.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "experiments-"));

test("missing file → defaults", () => {
  assert.deepEqual(loadSettings("/nonexistent/settings.json"), defaults());
});

test("defaults: explore, the six online factors (values[0] = today's behaviour), 16-arm cap, 0.1 floor", () => {
  const d = defaults();
  assert.deepEqual(d.factors, [
    { name: "warmPolicy", values: ["native", "orchestrator-aware"] },
    { name: "mainCacheTtl", values: ["5m", "1h"] },
    { name: "foldHint", values: ["fixed", "cache-aware"] },
    { name: "maskOnCold", values: ["off", "on"] },
    { name: "freshOnCold", values: ["off", "advise"] },
    { name: "delegationRule", values: ["off", "on"] },
  ]);
  assert.deepEqual({ ...d, factors: [], baseline: "" }, { mode: "explore", factors: [], maxArms: 16, minExplore: 0.1, baseline: "", guards: { minSessions: 10, threshold: 0.2, peekThreshold: 1, correctionThreshold: 1, ratingThreshold: 0.5 }, correctionRegex: String.raw`\b(no|wrong|revert|undo|that's not)\b` });
});

test("default baseline is the all-low arm of the default design (review note 1)", () => {
  const d = defaults();
  const arms = design(d.factors, d.maxArms);
  assert.equal(arms.length, 16, "2^(6-2)");
  assert.equal(d.baseline, "------");
  const base = arms.find((a) => a.id === d.baseline);
  assert.ok(base, `baseline ${d.baseline} is not an arm`);
  assert.ok(Object.entries(base.flags).every(([n, v]) => v === d.factors.find((f) => f.name === n)!.values[0]));
});

test("known keys override defaults, unknown keys and wrong types are ignored", () => {
  const f = join(tmp(), "settings.json");
  writeFileSync(f, JSON.stringify({ mode: "exploit", maxArms: 8, minExplore: 0.2, baseline: "b", extra: 1 }));
  assert.deepEqual(loadSettings(f), { ...defaults(), mode: "exploit", maxArms: 8, minExplore: 0.2, baseline: "b" });
});

test("mode outside {off, explore, exploit} is ignored", () => {
  const f = join(tmp(), "settings.json");
  writeFileSync(f, JSON.stringify({ mode: "uniform" }));
  assert.deepEqual(loadSettings(f), defaults());
});

test("factors: a valid array is honoured, malformed entries are not", () => {
  const good = [{ name: "warmPolicy", values: ["native", "orchestrator-aware"] }, { name: "foldHint", values: ["fixed", "cache-aware"] }];
  const f = join(tmp(), "settings.json");
  writeFileSync(f, JSON.stringify({ factors: good }));
  assert.deepEqual(loadSettings(f), { ...defaults(), factors: good });
  writeFileSync(f, JSON.stringify({ factors: [{ name: "warmPolicy", values: ["only-one"] }] }));
  assert.deepEqual(loadSettings(f), defaults());
});

test("invalid JSON → defaults (never partly applied)", () => {
  const f = join(tmp(), "settings.json");
  writeFileSync(f, "{ not json");
  assert.deepEqual(loadSettings(f), defaults());
});

test("guards: defaults for the kill switch (read by meter-report); a valid object is honoured, a malformed one is not", () => {
  assert.deepEqual(defaults().guards, { minSessions: 10, threshold: 0.2, peekThreshold: 1, correctionThreshold: 1, ratingThreshold: 0.5 });
  const f = join(tmp(), "settings.json");
  writeFileSync(f, JSON.stringify({ guards: { minSessions: 4, threshold: 0.1 } }));
  assert.deepEqual(loadSettings(f).guards, { ...defaults().guards, minSessions: 4, threshold: 0.1 });
  writeFileSync(f, JSON.stringify({ guards: { peekThreshold: 3, correctionThreshold: -1, ratingThreshold: "x" } })); // per key: valid ones override
  assert.deepEqual(loadSettings(f).guards, { ...defaults().guards, peekThreshold: 3 });
  writeFileSync(f, JSON.stringify({ guards: { minSessions: "4" } }));
  assert.deepEqual(loadSettings(f).guards, defaults().guards);
});

test("correctionRegex: a setting (source of a case-insensitive RegExp); an invalid pattern keeps the default", () => {
  const f = join(tmp(), "settings.json");
  writeFileSync(f, JSON.stringify({ correctionRegex: "\\bnope\\b" }));
  assert.equal(loadSettings(f).correctionRegex, "\\bnope\\b");
  writeFileSync(f, JSON.stringify({ correctionRegex: "(" }));
  assert.equal(loadSettings(f).correctionRegex, defaults().correctionRegex);
});
