import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, design, designFor } from "../core/design.ts";
import { V4_FACTORS, defaults, loadSettings, parseStrata, type StratumSpec } from "../core/settings.ts";
import type { Billing, Plans } from "../../token-meter/core/plans.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "experiments-"));

test("missing file → defaults", () => {
  assert.deepEqual(loadSettings("/nonexistent/settings.json"), defaults());
});

test("defaults: explore, the three online factors of design v4 (values[0] = today's behaviour), 16-arm cap, 0.1 floor", () => {
  const d = defaults();
  assert.deepEqual(d.factors, [
    { name: "warmPolicy", values: ["native", "orchestrator-aware"] },
    { name: "mainCacheTtl", values: ["5m", "1h"] },
    { name: "maskOnCold", values: ["off", "on"] },
  ]);
  assert.deepEqual({ ...d, factors: [], baseline: "" }, { mode: "explore", factors: [], maxArms: 16, minExplore: 0.1, baseline: "", guards: { minSessions: 10, threshold: 0.2, peekThreshold: 1, correctionThreshold: 1, ratingThreshold: 0.5 }, correctionRegex: String.raw`\b(no|wrong|revert|undo|that's not)\b` });
});

test("default baseline is the all-low arm of the default design (review note 1)", () => {
  const d = defaults();
  const arms = design(d.factors, d.maxArms);
  assert.equal(arms.length, 8, "the full 2^3");
  assert.equal(d.baseline, "---");
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
  const good = [{ name: "warmPolicy", values: ["native", "orchestrator-aware"] }, { name: "maskOnCold", values: ["off", "on"] }];
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

// The cloud stratum's default factors are M1's design v4 as a stratum (redesign §7.2, plan T5a.5): its design has the
// same 8 arms (level sets) as the v4 runtime's, over cache-lifecycle's levers.
test("V4_FACTORS: the stratum design has v4's 8 arms (the same level sets) over the levers cache-lifecycle.<factor>", () => {
  const v4 = defaults();
  const d = designFor("cloud", { factors: V4_FACTORS });
  const sets = (xs: Record<string, unknown>[]) => xs.map((x) => canonical(x)).sort();
  assert.equal(d.arms.length, 8);
  assert.deepEqual(sets(d.arms.map((a) => a.levels)), sets(design(v4.factors, v4.maxArms).map((a) => a.flags)));
  assert.deepEqual(V4_FACTORS.map((f) => f.lever), v4.factors.map((f) => `cache-lifecycle.${f.name}`));
});

// (redesign M5a T5a.4) The strata setting (§7.2, §7.3) and its defaults (plan P12).
const PLANS: Plans = {
  claude: { billing: "subscription", windows: ["5h", "7d"] },
  llama: { billing: "local", windows: [], rate: { amount: 0.13, currency: "EUR", per: "hour" } },
  zen: { billing: "free", windows: [] },
};
const cloud = (billing: Billing): StratumSpec => ({ match: { billing: [billing] }, objective: "apiUsd", factors: [...V4_FACTORS] });

test("strata absent: one stratum per billing class of the plans, and api (a provider without a plan bills as api)", () => {
  assert.deepEqual(parseStrata(undefined, PLANS, V4_FACTORS), {
    strata: {
      subscription: cloud("subscription"),
      api: cloud("api"),
      free: cloud("free"),
      local: { match: { billing: ["local"] }, objective: "localCost", factors: [] },
    },
    warnings: [],
  });
  assert.deepEqual(Object.keys(parseStrata(undefined, PLANS, V4_FACTORS).strata), ["subscription", "api", "free", "local"]);
  assert.deepEqual(parseStrata(null, {}, V4_FACTORS), { strata: { api: cloud("api") }, warnings: [] });
});

test("strata given: honoured in key order; objective absent → localCost for a local-only match, apiUsd otherwise", () => {
  const nudge = { name: "nudge", lever: "infinite-context.nudgeAtTokens", levels: [0.25, 0.75] };
  const raw = {
    local: { match: { billing: ["local"] }, factors: [nudge] },
    cloud: { match: { billing: ["subscription", "api", "free"] }, objective: "cashUsd",
             factors: [{ name: "ttl", lever: "cache-lifecycle.mainCacheTtl", levels: ["5m", "1h"] }, nudge] },
    glob: { match: { models: ["llama/*"] } },
    any: { match: {}, objective: "wallMs", factors: [{ name: "b", lever: "x.flag", levels: [false, true] }] },
  };
  const got = parseStrata(raw, PLANS, V4_FACTORS);
  assert.deepEqual(got, {
    strata: {
      local: { match: { billing: ["local"] }, objective: "localCost", factors: [nudge] },
      cloud: raw.cloud,
      glob: { match: { models: ["llama/*"] }, objective: "apiUsd", factors: [] },
      any: raw.any,
    },
    warnings: [],
  });
  assert.deepEqual(Object.keys(got.strata), ["local", "cloud", "glob", "any"]);
  assert.deepEqual(parseStrata({}, PLANS, V4_FACTORS), { strata: {}, warnings: [] }, "{} = no strata (an explicit opt-out)");
});

test("strata: a malformed stratum is dropped whole, never repaired, and each drop says why", () => {
  const f = (name: string, lever = `x.${name}`, levels: unknown = ["a", "b"]) => ({ name, lever, levels });
  const ok = { match: { billing: ["api"] }, factors: [f("a")] };
  const bad: Record<string, [unknown, string]> = {
    notObject: [["api"], "not an object"],
    noMatch: [{ factors: [] }, "match is not an object"],
    unknownBilling: [{ match: { billing: ["api", "cloud"] } }, "match.billing is not a non-empty list of billing classes"],
    emptyBilling: [{ match: { billing: [] } }, "match.billing is not a non-empty list of billing classes"],
    badModels: [{ match: { models: ["a/*", 1] } }, "match.models is not a non-empty list of strings"],
    badObjective: [{ match: {}, objective: "usd" }, "objective usd is not one of apiUsd, cashUsd, localCost, wallMs, points5h, points7d"],
    factorsNotList: [{ match: {}, factors: {} }, "factors is not a list"],
    noName: [{ match: {}, factors: [{ lever: "x.y", levels: ["a", "b"] }] }, "factor 1 needs a name, a lever and two levels"],
    threeLevels: [{ match: {}, factors: [f("a", "x.a", ["a", "b", "c"])] }, "factor 1 needs a name, a lever and two levels"],
    objectLevel: [{ match: {}, factors: [f("a"), f("b", "x.b", ["a", {}])] }, "factor 2 needs a name, a lever and two levels"],
    seven: [{ match: {}, factors: ["a", "b", "c", "d", "e", "f", "g"].map((n) => f(n)) }, "7 factors, at most 6"],
    sameName: [{ match: {}, factors: [f("a", "x.a"), f("a", "x.b")] }, "factor name a repeated"],
    sameLever: [{ match: {}, factors: [f("a", "x.a"), f("b", "x.a")] }, "lever x.a repeated"],
  };
  const raw = { ok, ...Object.fromEntries(Object.entries(bad).map(([n, [s]]) => [n, s])) };
  const got = parseStrata(raw, PLANS, V4_FACTORS);
  assert.deepEqual(got.strata, { ok: { ...ok, objective: "apiUsd" } });
  assert.deepEqual(got.warnings, Object.entries(bad).map(([n, [, why]]) => `experiments stratum ${n} dropped: ${why}`));
});

test("strata of a wrong type are ignored with a warning: the defaults apply", () => {
  for (const raw of [[], "cloud", 1, true]) {
    const got = parseStrata(raw, {}, V4_FACTORS);
    assert.deepEqual(got.strata, { api: cloud("api") });
    assert.deepEqual(got.warnings, ["experiments strata is not an object; the default strata apply"]);
  }
});

test("the default cloud stratum's design has v4's 8 arms (P5a.4)", () => {
  const v4 = defaults();
  const sets = (xs: Record<string, unknown>[]) => xs.map((x) => canonical(x)).sort();
  for (const [name, s] of Object.entries(parseStrata(undefined, PLANS, V4_FACTORS).strata)) {
    if (name === "local") continue;
    assert.deepEqual(sets(designFor(name, s).arms.map((a) => a.levels)), sets(design(v4.factors, v4.maxArms).map((a) => a.flags)));
  }
});
