import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, design, designFor, designId } from "../core/design.ts";
import { V4_FACTORS, defaults, loadSettings, parseStrata, readPlans, type StratumSpec } from "../core/settings.ts";
import type { Billing, Plans } from "../../token-meter/core/plans.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "experiments-"));

// The v1 engine's ONLINE_FACTORS (design v4), removed in M5b.1, kept here as the oracle of V4_FACTORS.
const V4_ORACLE = [
    { name: "warmPolicy", values: ["native", "orchestrator-aware"] as [string, string] },
    { name: "mainCacheTtl", values: ["5m", "1h"] as [string, string] },
    { name: "maskOnCold", values: ["off", "on"] as [string, string] },
];

test("missing file → defaults", () => {
  assert.deepEqual(loadSettings("/nonexistent/settings.json"), defaults());
});

// M5b.1: the v1 engine's factors, maxArms and baseline are gone (ONLINE_FACTORS with them); designs come from `strata`.
test("defaults: explore, a 0.1 floor, the kill-switch guards, the correction regex; no strata (the defaults of parseStrata apply)", () => {
  assert.deepEqual(defaults(), { mode: "explore", minExplore: 0.1, guards: { minSessions: 10, threshold: 0.2, peekThreshold: 1, correctionThreshold: 1, ratingThreshold: 0.5 }, correctionRegex: String.raw`\b(no|wrong|revert|undo|that's not)\b` });
});

test("known keys override defaults; unknown keys (the v1 engine's factors, maxArms, baseline among them) and wrong types are ignored", () => {
  const f = join(tmp(), "settings.json");
  writeFileSync(f, JSON.stringify({ mode: "exploit", minExplore: 0.2, maxArms: 8, baseline: "b", factors: [{ name: "x", values: ["a", "b"] }], extra: 1 }));
  // review m3: the v1 engine's keys are named (the shell warns once), never applied
  assert.deepEqual(loadSettings(f), { ...defaults(), mode: "exploit", minExplore: 0.2, legacy: ["maxArms", "baseline", "factors"] });
  writeFileSync(f, JSON.stringify({ mode: "exploit" }));
  assert.deepEqual(loadSettings(f), { ...defaults(), mode: "exploit" });
});

test("strata: passed through as written (any JSON value); parseStrata validates it and says why it drops one", () => {
  const f = join(tmp(), "settings.json");
  const strata = { opus: { match: { models: ["anthropic/claude-opus-*"] }, factors: [] }, bad: { match: 1 } };
  writeFileSync(f, JSON.stringify({ strata }));
  assert.deepEqual(loadSettings(f), { ...defaults(), strata });
  writeFileSync(f, JSON.stringify({ strata: 3 }));
  assert.equal(loadSettings(f).strata, 3);
});

test("readPlans: the billing classes of token-meter's `plans` setting (its settings file); anything else is no plan", () => {
  const dir = tmp();
  const f = join(dir, "settings.json");
  assert.deepEqual(readPlans(f), {}, "no file");
  writeFileSync(f, JSON.stringify({ plans: { claude: { billing: "subscription", windows: ["5h", "1y"] }, llama: { billing: "local" }, odd: { billing: "barter" }, nil: null } }));
  assert.deepEqual(readPlans(f), { claude: { billing: "subscription", windows: ["5h"] }, llama: { billing: "local", windows: [] } });
  for (const bad of ["{", "[]", JSON.stringify({ plans: [] }), JSON.stringify({ plans: "x" })]) {
    writeFileSync(f, bad);
    assert.deepEqual(readPlans(f), {}, bad);
  }
});

test("mode outside {off, explore, exploit} is ignored", () => {
  const f = join(tmp(), "settings.json");
  writeFileSync(f, JSON.stringify({ mode: "uniform" }));
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
  const v4 = V4_ORACLE;
  const d = designFor("cloud", { factors: V4_FACTORS });
  const sets = (xs: Record<string, unknown>[]) => xs.map((x) => canonical(x)).sort();
  assert.equal(d.arms.length, 8);
  assert.deepEqual(sets(d.arms.map((a) => a.levels)), sets(design(v4, 16).map((a) => a.flags)));
  assert.deepEqual(V4_FACTORS.map((f) => f.lever), v4.map((f) => `cache-lifecycle.${f.name}`));
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
      local: { match: { billing: ["local"] }, objective: "localCost", factors: [{ name: "nudge", lever: "infinite-context.nudgeAtTokens", levels: [0.25, 0.75] }] },
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
    equalLevels: [{ match: {}, factors: [f("a", "x.a", ["a", "a"])] }, "factor 1 has two equal levels"],
    unknownKey: [{ match: {}, factor: [f("a")] }, "unknown key factor"],
    unknownMatchKey: [{ match: { model: ["a/*"] } }, "unknown key match.model"],
    unknownFactorKey: [{ match: {}, factors: [{ ...f("a"), level: 1 }] }, "factor 1: unknown key level"],
  };
  const raw = { ok, ...Object.fromEntries(Object.entries(bad).map(([n, [s]]) => [n, s])) };
  const got = parseStrata(raw, PLANS, V4_FACTORS);
  assert.deepEqual(got.strata, { ok: { ...ok, objective: "apiUsd" } });
  assert.deepEqual(got.warnings, Object.entries(bad).map(([n, [, why]]) => `experiments stratum ${n} dropped: ${why}`));
});

// M5b.2 review m2, carried to M7c: a lever's level reaches a levers line as `a` and `v`, and token-meter's writer drops a state whose
// value is no level name, number or boolean; a data-only kind (session-entry) takes any levels, so the stratum is refused up front.
test("T7c.4 a factor level that is no level name (the levers line's rule) drops the stratum with the level named; names, numbers and booleans pass", () => {
  const stratum = (levels: unknown[]) => ({ match: {}, factors: [{ name: "a", lever: "x.a", levels }] });
  for (const levels of [["5m", "1h"], ["a_b-c", "x"], ["x".repeat(32), "y"], ["0", "9"], [0.25, 0.75], [false, true], ["1", 2], [-1, 1e21]]) {
    const got = parseStrata({ s: stratum(levels) }, PLANS, V4_FACTORS);
    assert.deepEqual([Object.keys(got.strata), got.warnings], [["s"], []], JSON.stringify(levels));
  }
  for (const bad of ["1H", "", " a", "a b", "a\n", "-a", "_a", "x".repeat(33), "é", "a.b", "Medium"]) {
    const got = parseStrata({ s: stratum(["ok", bad]) }, PLANS, V4_FACTORS);
    assert.deepEqual(got.strata, {}, JSON.stringify(bad));
    assert.deepEqual(got.warnings, [`experiments stratum s dropped: factor 1 has a level that is not a level name: ${JSON.stringify(bad)}`]);
  }
});

// Review F1b: a session-entry factor names the extension whose tool or command shows it is loaded (the read-back gate).
test("F1b a factor may carry a `target` (a non-empty string), kept on its spec; any other value drops the stratum", () => {
  const stratum = (target: unknown) => ({ match: {}, factors: [{ name: "a", lever: "session-entry(t,f)", levels: ["a", "b"], target }] });
  const ok = parseStrata({ s: stratum("entry-ext") }, PLANS, V4_FACTORS);
  assert.deepEqual(ok.warnings, []);
  assert.deepEqual(ok.strata.s.factors, [{ name: "a", lever: "session-entry(t,f)", levels: ["a", "b"], target: "entry-ext" }]);
  const none = parseStrata({ s: { match: {}, factors: [{ name: "a", lever: "x.a", levels: ["a", "b"] }] } }, PLANS, V4_FACTORS);
  assert.deepEqual(Object.keys(none.strata.s.factors[0]), ["name", "lever", "levels"], "no target key when none is given");
  for (const bad of ["", 3, true, null, ["a"], {}]) {
    const got = parseStrata({ s: stratum(bad) }, PLANS, V4_FACTORS);
    assert.deepEqual(got.strata, {}, JSON.stringify(bad));
    assert.deepEqual(got.warnings, ["experiments stratum s dropped: factor 1: target is not a non-empty string"], JSON.stringify(bad));
  }
});

test("strata: a stratum named __proto__ is an own key like any other (review NIT)", () => {
  const got = parseStrata(JSON.parse('{"__proto__": {"match": {"billing": ["api"]}}}'), {}, V4_FACTORS);
  assert.equal(Object.getPrototypeOf(got.strata), Object.prototype);
  assert.deepEqual(Object.keys(got.strata), ["__proto__"]);
  assert.deepEqual(Object.getOwnPropertyDescriptor(got.strata, "__proto__")?.value, { match: { billing: ["api"] }, objective: "apiUsd", factors: [] });
  assert.deepEqual(got.warnings, []);
});

test("strata of a wrong type are ignored with a warning: the defaults apply", () => {
  for (const raw of [[], "cloud", 1, true]) {
    const got = parseStrata(raw, {}, V4_FACTORS);
    assert.deepEqual(got.strata, { api: cloud("api") });
    assert.deepEqual(got.warnings, ["experiments strata is not an object; the default strata apply"]);
  }
});

test("pinned: the default cloud stratum's design id (stored with every unit; a new formula would pool nothing)", () => {
  assert.equal(designId(V4_FACTORS, []), "b4d458675108");
  assert.equal(designFor("api", parseStrata(undefined, {}, V4_FACTORS).strata.api).id, "b4d458675108");
});

test("the default cloud stratum's design has v4's 8 arms (P5a.4)", () => {
  const sets = (xs: Record<string, unknown>[]) => xs.map((x) => canonical(x)).sort();
  for (const [name, s] of Object.entries(parseStrata(undefined, PLANS, V4_FACTORS).strata)) {
    if (name === "local") continue;
    assert.deepEqual(sets(designFor(name, s).arms.map((a) => a.levels)), sets(design(V4_ORACLE, 16).map((a) => a.flags)));
  }
});
