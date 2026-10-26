import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { effortAt, enabled, firstMeeting } from "../core/members.ts";
import { TODAY_RAW, todayWith } from "./harness.ts";
import { planFor as legacyPlanFor } from "./oracle/legacy-plan.ts";
import { BUILTIN_PROFILES, defaults, loadSettings, loadSettingsReport, parseSettings } from "../core/settings.ts";
import { capToTable } from "../core/table.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "task-router-"));
const write = (obj: unknown) => {
  const f = join(tmp(), "settings.json");
  writeFileSync(f, typeof obj === "string" ? obj : JSON.stringify(obj));
  return f;
};

test("missing file → defaults", () => {
  assert.deepEqual(loadSettings("/nonexistent/settings.json"), defaults());
});

test("defaults pin the pilot (T0.3) t0Limits", () => {
  const d = defaults();
  assert.deepEqual(d.t0Limits, { files: 10, tokens: 150000 });
  assert.equal(d.models["qwen-local"].model, "llama/qwen3.8");
  assert.equal(d.models["qwen-cloud"].model, ""); // D3 (T5.4): the free cloud slot is empty by default
  assert.equal(d.models.sonnet.model, "anthropic/claude-sonnet-5-5");
  assert.equal(d.models.opus.model, "anthropic/claude-opus-5-5");
  assert.equal(d.models["qwen-local"].health, "http://earth:11545");
  assert.equal(d.models["qwen-cloud"].dailyCap, 950);
  assert.equal(d.queueMaxSec, 120);
  assert.deepEqual(d.runaway, { requests: 150, usd: 10 });
  assert.deepEqual(Object.values(d.models).map((m) => m.contextWindow), [262144, 262144, 1000000, 1000000, 1000000]);
  assert.deepEqual(d.profiles, {});
  assert.deepEqual(d.pathRules, []);
});

test("nested keys deep-merge over defaults; wrong types and unknown keys are ignored", () => {
  const s = loadSettings(write({ t0Limits: { files: 5, tokens: "many" }, cloudDailyCap: "x", extra: 1, models: { sonnet: { model: "m" } } }));
  const d = defaults();
  assert.deepEqual(s, { ...d, t0Limits: { files: 5, tokens: 150000 }, models: { ...d.models, sonnet: { ...d.models.sonnet, model: "m" } } });
});

test("profiles and pathRules are taken as given (open keys)", () => {
  const p = { tier: "T1", tools: "all", skills: [], report: "default" };
  const f = write({ profiles: { spike: p }, pathRules: [{ glob: "**/x/**", level: "high" }] });
  const s = loadSettings(f);
  assert.deepEqual(s.profiles, { spike: { level: 1, tools: "all", skills: [], report: "default" } }); // legacy profile keys are mapped (spec §5.4 row 7)
  assert.deepEqual(loadSettingsReport(f).problems, ["legacy key profiles.spike.tier mapped to profiles.spike.level"]);
  assert.deepEqual(s.pathRules, [{ glob: "**/x/**", level: "high" }]);
});

test("invalid JSON → defaults", () => {
  assert.deepEqual(loadSettings(write("{ nope")), defaults());
});

test("loadSettingsReport: missing file → defaults, no problem", () => {
  assert.deepEqual(loadSettingsReport("/nonexistent/settings.json"), { settings: defaults(), problems: [] });
});

test("loadSettingsReport: invalid JSON → defaults and one problem naming the file", () => {
  const f = write("{ nope");
  const r = loadSettingsReport(f);
  assert.deepEqual(r.settings, defaults());
  assert.equal(r.problems.length, 1);
  assert.ok(r.problems[0].startsWith(`${f}: invalid JSON`), r.problems[0]);
});

test("parseSettings: not an object → defaults and a problem; undefined → defaults without one", () => {
  for (const raw of [[], "x", 3, null]) {
    const r = parseSettings(raw);
    assert.deepEqual(r.settings, defaults());
    assert.deepEqual(r.problems, ["settings: not a JSON object; defaults used"]);
  }
  assert.deepEqual(parseSettings(undefined), { settings: defaults(), problems: [] });
});

test("parseSettings merges a partial file over the defaults and drops unknown keys, without a problem", () => {
  const r = parseSettings({ t0Limits: { files: 5 }, extra: 1 });
  assert.equal(r.settings.t0Limits.files, 5);
  assert.equal(r.settings.t0Limits.tokens, defaults().t0Limits.tokens);
  assert.equal("extra" in r.settings, false);
  assert.deepEqual(r.problems, []);
});

test("defaults: five members, Haiku enabled (OD2; RD1's blank lives in the fixture), the free cloud blank with order 1 (D3), local health", () => {
  const m = defaults().models;
  assert.deepEqual(Object.keys(m), ["qwen-local", "qwen-cloud", "haiku", "sonnet", "opus"]);
  assert.deepEqual(enabled(m).map((x) => x.name), ["qwen-local", "haiku", "sonnet", "opus"]);
  assert.equal(m.haiku.model, "anthropic/claude-haiku-5-5");
  assert.equal(m["qwen-cloud"].model, "");
  assert.equal(m["qwen-cloud"].order, 1);
  assert.deepEqual(m["qwen-local"].abilities, { write: 0, read: 0 });
  assert.deepEqual(m.sonnet.abilities, { write: 1, read: 2 });
  assert.deepEqual(m.opus.efforts, ["high", "xhigh"]);
  assert.equal(m["qwen-local"].slots, 1);
  assert.equal(m["qwen-cloud"].slots, 2);
});

test("a member the file does not mention stays; a mentioned one merges field by field", () => {
  const d = defaults().models;
  const m = parseSettings({ models: { sonnet: { model: "m" } } }).settings.models;
  assert.deepEqual(m.opus, d.opus);
  assert.deepEqual(m["qwen-local"], d["qwen-local"]);
  assert.deepEqual(m.sonnet, { ...d.sonnet, model: "m" });
});

test("a new member key is taken as given", () => {
  const extra = { model: "x/y", tier: "x", route: "T1", abilities: { write: 1 }, efforts: ["high"], contextWindow: 5, cost: 2 };
  const m = parseSettings({ models: { extra } }).settings.models;
  assert.deepEqual(m.extra, extra);
  assert.equal(Object.keys(m).length, 6);
});

test('"model": "" blanks a default member: it is not enabled', () => {
  const m = parseSettings({ models: { "qwen-cloud": { model: "" } } }).settings.models;
  assert.equal(m["qwen-cloud"].model, "");
  assert.ok(!enabled(m).some((x) => x.name === "qwen-cloud"));
});

// --- legacy model keys (spec §5.4 rows 1–6) ------------------------------------------------

const LEGACY_ROWS: [string, unknown, string, (m: Record<string, any>) => unknown, unknown][] = [
  ["models.qwenLocal", { models: { qwenLocal: "l/x" } }, "models.qwen-local.model", (m) => m["qwen-local"].model, "l/x"],
  ["models.qwenCloud", { models: { qwenCloud: "c/x" } }, "models.qwen-cloud.model", (m) => m["qwen-cloud"].model, "c/x"],
  ["models.T1", { models: { T1: "s/x" } }, "models.sonnet.model", (m) => m.sonnet.model, "s/x"],
  ["models.T2", { models: { T2: "o/x" } }, "models.opus.model", (m) => m.opus.model, "o/x"],
  ["localHealthUrl", { localHealthUrl: "http://h:1" }, "models.qwen-local.health", (m) => m["qwen-local"].health, "http://h:1"],
  ["cloudDailyCap", { cloudDailyCap: 7 }, "models.qwen-cloud.dailyCap", (m) => m["qwen-cloud"].dailyCap, 7],
  ["contextWindow.T1", { contextWindow: { T1: 123 } }, "models.sonnet.contextWindow", (m) => m.sonnet.contextWindow, 123],
  ["contextWindow.T2", { contextWindow: { T2: 124 } }, "models.opus.contextWindow", (m) => m.opus.contextWindow, 124],
];

for (const [from, raw, to, read, value] of LEGACY_ROWS) {
  test(`legacy key ${from} is mapped to ${to}`, () => {
    const r = parseSettings(raw);
    assert.equal(read(r.settings.models), value);
    assert.deepEqual(r.problems, [`legacy key ${from} mapped to ${to}`]);
    assert.equal((r.settings as any).localHealthUrl, undefined);
    assert.equal((r.settings as any).cloudDailyCap, undefined);
  });
}

test("legacy contextWindow.qwen sets both Qwen members", () => {
  const r = parseSettings({ contextWindow: { qwen: 99 } });
  assert.equal(r.settings.models["qwen-local"].contextWindow, 99);
  assert.equal(r.settings.models["qwen-cloud"].contextWindow, 99);
  assert.deepEqual(r.problems, ["legacy key contextWindow.qwen mapped to models.qwen-local.contextWindow", "legacy key contextWindow.qwen mapped to models.qwen-cloud.contextWindow"]);
});

test("legacy and new key both set → the new one wins and the legacy one is reported ignored", () => {
  const r = parseSettings({ cloudDailyCap: 7, models: { "qwen-cloud": { dailyCap: 3 }, T1: "s/x", sonnet: { model: "n/x" } } });
  assert.equal(r.settings.models["qwen-cloud"].dailyCap, 3);
  assert.equal(r.settings.models.sonnet.model, "n/x");
  assert.deepEqual(r.problems.sort(), ["legacy key cloudDailyCap ignored: models.qwen-cloud.dailyCap is set", "legacy key models.T1 ignored: models.sonnet.model is set"]);
});

test("legacy keys of the wrong type are not mapped, each with a problem line; the input object is not changed", () => {
  const raw = { cloudDailyCap: "x", localHealthUrl: 5, models: { T1: 3, qwenLocal: null }, contextWindow: { qwen: "x", T2: [] } };
  const before = structuredClone(raw);
  const r = parseSettings(raw);
  assert.deepEqual(r.settings, defaults());
  assert.deepEqual(r.problems.sort(), [
    "legacy key cloudDailyCap ignored: expected a number, got a string",
    "legacy key contextWindow.T2 ignored: expected a number, got an array",
    "legacy key contextWindow.qwen ignored: expected a number, got a string",
    "legacy key localHealthUrl ignored: expected a string, got a number",
    "legacy key models.T1 ignored: expected a string, got a number",
    "legacy key models.qwenLocal ignored: expected a string, got null",
  ]);
  assert.deepEqual(raw, before);
});

test("legacy contextWindow that is not an object is ignored with a problem line", () => {
  const r = parseSettings({ contextWindow: 5 });
  assert.deepEqual(r.settings, defaults());
  assert.deepEqual(r.problems, ["legacy key contextWindow ignored: expected an object, got a number"]);
});

// --- importance tables, readOnlyReview, contextFit (spec §4.4, §5.1) -----------------------

const WRITE_BASE = ["qwen", "T1", "T2"]; // today's base per write level
test("defaults: the write table is today's TABLE per level (spec §4.4)", () => {
  const s = defaults();
  const at = (l: number, step: number) => { const m = firstMeeting(s.models, "write", l)!; return `${m.tier}/${effortAt(m, step)}`; };
  WRITE_BASE.forEach((base, level) => {
    for (const imp of ["normal", "high", "critical"] as const) {
      const want = legacyPlanFor(base as any, imp, "implement");
      const cell = s.importanceTable.write[String(level)][imp];
      assert.equal(at(cell.worker.level, cell.worker.step), `${want.worker.tier}/${want.worker.effort}`, `${base} ${imp} worker`);
      assert.equal(cell.review && at(cell.review.level, cell.review.step), want.review && `${want.review.tier}/${want.review.effort}`, `${base} ${imp} review`);
    }
  });
});

test("defaults: read row 2 critical = W2·1 (D12, OD13); the review table = the read table except row 2 critical, which stays W3·1; readOnlyReview effort-step (D1, RD4); contextFit 1 (D6, OD17)", () => {
  const s = defaults();
  assert.deepEqual(s.importanceTable.read["2"].critical, { worker: { level: 2, step: 1 } });
  assert.deepEqual(s.importanceTable.review["2"].critical, { worker: { level: 3, step: 1 } });
  const { "2": readRow2, ...readRest } = s.importanceTable.read, { "2": reviewRow2, ...reviewRest } = s.importanceTable.review;
  assert.deepEqual(reviewRest, readRest);
  assert.deepEqual({ ...reviewRow2, critical: undefined }, { ...readRow2, critical: undefined });
  assert.deepEqual(Object.keys(s.importanceTable.read), ["0", "1", "2", "3"]);
  assert.equal(s.readOnlyReview, "effort-step");
  assert.equal(s.contextFit, 1);
});

test("a given cell replaces the default cell whole (a cell without review has none); a row merges per importance", () => {
  const given = { worker: { level: 1, step: 0 } };
  const t = parseSettings({ importanceTable: { write: { "0": { high: given } } } }).settings.importanceTable;
  const d = defaults().importanceTable;
  assert.deepEqual(t.write["0"].high, given);
  assert.deepEqual(t.write["0"].normal, d.write["0"].normal);
  assert.deepEqual(t.write["0"].critical, d.write["0"].critical);
  assert.deepEqual(t.write["1"], d.write["1"]);
  assert.deepEqual(t.read, d.read);
});

test("a new table is taken as given", () => {
  const rows = { "0": { normal: { worker: { level: 0, step: 0 } }, high: { worker: { level: 0, step: 0 } }, critical: { worker: { level: 0, step: 0 } } } };
  const t = parseSettings({ importanceTable: { scan: rows } }).settings.importanceTable;
  assert.deepEqual(t.scan, rows);
  assert.deepEqual(t.write, defaults().importanceTable.write);
});

// --- member validation (spec §5.4 rule 1) ----------------------------------------------------

const BAD: [string, Record<string, unknown>, string][] = [
  ["an empty ladder", { efforts: [] }, "efforts must be a non-empty, strictly ascending ladder without max"],
  ["a descending ladder", { efforts: ["xhigh", "high"] }, "efforts must be a non-empty, strictly ascending ladder without max"],
  ["max in the ladder", { efforts: ["high", "max"] }, "efforts must be a non-empty, strictly ascending ladder without max"],
  ["a negative level", { abilities: { write: -1 } }, "abilities must be non-negative integers"],
  ["a fractional level", { abilities: { write: 1.5 } }, "abilities must be non-negative integers"],
  ["a window of 0", { contextWindow: 0 }, "contextWindow must be > 0"],
  ["a cost of −1", { cost: -1 }, "cost must be ≥ 0"],
  ["0 slots", { slots: 0 }, "slots must be a positive integer"],
  ["a cap of 1.5", { dailyCap: 1.5 }, "dailyCap must be a non-negative integer (0 = never selected)"],
  ["a cap of −1", { dailyCap: -1 }, "dailyCap must be a non-negative integer (0 = never selected)"],
  ["a health url of 3", { health: 3 }, "health must be a string"],
];
for (const [what, patch, why] of BAD) {
  test(`member validation: ${what} → the default member is kept and the problem named`, () => {
    const d = defaults().models;
    const r = parseSettings({ models: { sonnet: patch } });
    assert.deepEqual(r.settings.models.sonnet, d.sonnet);
    assert.deepEqual(r.problems, [`models.sonnet: ${why}; default kept`]);
  });
  test(`member validation: ${what} → a new member is dropped and the problem named`, () => {
    const r = parseSettings({ models: { extra: { model: "x/y", tier: "x", route: "x", abilities: { write: 1 }, efforts: ["high"], contextWindow: 5, cost: 2, ...patch } } });
    assert.equal("extra" in r.settings.models, false);
    assert.deepEqual(r.problems, [`models.extra: ${why}; dropped`]);
  });
}

test("member validation: a blank member is not validated; a new member without tier is dropped", () => {
  const r = parseSettings({ models: { haiku: { model: "", efforts: [], cost: -1 }, extra: { model: "x/y" } } });
  assert.equal(r.settings.models.haiku.model, "");
  assert.deepEqual(r.problems, ["models.extra: tier and route must be non-empty strings; dropped"]);
});

test("member validation: the defaults pass without a problem", () => {
  assert.deepEqual(parseSettings({}).problems, []);
});

// --- the today fixture (spec §5.3, RD1): the owner's rollback ------------------------------

/** The leaf paths where the fixture's settings and the defaults differ: the settings view of M5 (spec §5.2 vs §5.3). */
const FLIPPED: string[] = ["importanceTable.read.2.critical.worker.level", "readOnlyReview", "models.qwen-cloud.model", "models.qwen-cloud.order", "models.haiku.model", "contextFit"];
const isPlain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const leaves = (v: unknown, path = ""): Record<string, string> =>
  isPlain(v) ? Object.assign({}, ...Object.entries(v).map(([k, x]) => leaves(x, path ? `${path}.${k}` : k))) : { [path]: JSON.stringify(v) };

test("today fixture vs defaults: the differing leaf paths are FLIPPED, and the fixture parses without problems", () => {
  const r = parseSettings(TODAY_RAW);
  assert.deepEqual(r.problems, []);
  const a = leaves(r.settings), b = leaves(defaults());
  const differ = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((p) => a[p] !== b[p]).sort();
  assert.deepEqual(differ, [...FLIPPED].sort());
});

test("today fixture: haiku is blanked with exactly {model: \"\"}, no profiles key", () => {
  assert.deepEqual(TODAY_RAW.models.haiku, { model: "" });
  assert.equal("profiles" in TODAY_RAW, false);
  assert.deepEqual(Object.keys(TODAY_RAW.models), ["qwen-local", "qwen-cloud", "haiku", "sonnet", "opus"]);
});

// F5.2 (plan router-g3-g7, D14): models are configured through programs.piEconomics.taskRouter.settings; the module-eval
// case task-router-models writes this same file and reads it back (P-models).
const MODELS_EXAMPLE = fileURLToPath(new URL("./fixtures/models-example.json", import.meta.url));
test("models example: every member as written, 0 problems", () => {
  const x = JSON.parse(readFileSync(MODELS_EXAMPLE, "utf8"));
  const r = loadSettingsReport(MODELS_EXAMPLE);
  assert.deepEqual(r.problems, []);
  for (const [m, given] of Object.entries(x.models as Record<string, { model: string }>)) assert.equal(r.settings.models[m].model, given.model, m);
  assert.equal(r.settings.queueMaxSec, 60);
  assert.ok(!enabled(r.settings.models).some((m) => m.name === "qwen-cloud"));
});

// --- review fixes (G0/G1 review, 2026-10-25) -------------------------------------------------

test("m1: legacy cloudDailyCap: 0 keeps its meaning: the member stays, with a cap of 0 (never selected)", () => {
  const r = parseSettings({ cloudDailyCap: 0 });
  assert.deepEqual(r.problems, ["legacy key cloudDailyCap mapped to models.qwen-cloud.dailyCap"]);
  assert.deepEqual(r.settings.models["qwen-cloud"], { ...defaults().models["qwen-cloud"], dailyCap: 0 });
  assert.deepEqual(parseSettings({ models: { "qwen-cloud": { dailyCap: 0 } } }).problems, []);
});

// T3.4 (HP m2, m3): the selection skips a blank member (MP2) and routes by member, so blanking a member is no problem and
// route and tier are labels like any other field.
test("blanking any member is no problem: the selection skips it (MP2)", () => {
  for (const key of ["qwen-local", "qwen-cloud", "haiku", "sonnet", "opus"]) {
    const r = parseSettings({ models: { [key]: { model: "" } } });
    assert.deepEqual(r.problems.filter((l) => !l.startsWith("importanceTable.")), [], key); // opus: the default tables (M1) only
  }
  assert.deepEqual(parseSettings({ models: { qwenCloud: "" } }).problems, ["legacy key models.qwenCloud mapped to models.qwen-cloud.model"]);
});

test("route and tier of a default member are labels: an override is kept, without a problem", () => {
  const d = defaults().models;
  const r = parseSettings({ models: { sonnet: { route: "x", tier: "y", cost: 9 } } });
  assert.deepEqual(r.settings.models.sonnet, { ...d.sonnet, route: "x", tier: "y", cost: 9 });
  assert.deepEqual(r.problems, []);
});

test("m4: readOnlyReview and contextFit are checked; a bad value keeps the default and names itself", () => {
  const d = defaults();
  for (const [raw, key, def] of [
    ["bogus", "readOnlyReview", d.readOnlyReview], [3, "readOnlyReview", d.readOnlyReview],
  ] as const) {
    const r = parseSettings({ [key]: raw });
    assert.equal(r.settings.readOnlyReview, def);
    assert.deepEqual(r.problems, ['readOnlyReview: must be "effort-step" or "review"; default kept']);
  }
  for (const raw of [-3, 1.5, "x", null]) {
    const r = parseSettings({ contextFit: raw });
    assert.equal(r.settings.contextFit, d.contextFit);
    assert.deepEqual(r.problems, ["contextFit: must be a number from 0 to 1; default kept"]);
  }
  assert.deepEqual(parseSettings({ readOnlyReview: "effort-step", contextFit: 0.8 }).problems, []);
  assert.equal(parseSettings({ readOnlyReview: "effort-step", contextFit: 0.8 }).settings.contextFit, 0.8);
});

// --- legacy profile keys (spec §5.4 row 7; T2.1) -------------------------------------------

test("legacy profile tier/minTier → level/minLevel on the profile's ability (lowest level of the enabled members with that tier)", () => {
  const r = parseSettings({ profiles: { scout: { tier: "qwen" }, review: { tier: "T1" }, "debug-design": { minTier: "T2" }, x: { tier: "T1" } } });
  const p = r.settings.profiles as Record<string, any>;
  assert.equal(p.scout.level, 0); // read: qwen members read 0
  assert.equal(p.review.level, 2); // read: sonnet read 2
  assert.equal(p["debug-design"].minLevel, 2); // write: opus write 2
  assert.equal(p.x.level, 1); // custom kind: write; sonnet write 1
  assert.ok(Object.values(p).every((q) => !("tier" in q) && !("minTier" in q)), "legacy fields are deleted after mapping");
  assert.deepEqual(r.problems, [
    "legacy key profiles.scout.tier mapped to profiles.scout.level",
    "legacy key profiles.review.tier mapped to profiles.review.level",
    "legacy key profiles.debug-design.minTier mapped to profiles.debug-design.minLevel",
    "legacy key profiles.x.tier mapped to profiles.x.level",
  ]);
});

test("legacy profile tier and level both set → level wins, the legacy key is reported ignored", () => {
  const r = parseSettings({ profiles: { x: { tier: "T2", level: 1 } } });
  assert.equal((r.settings.profiles.x as any).level, 1);
  assert.equal("tier" in r.settings.profiles.x, false);
  assert.deepEqual(r.problems, ["legacy key profiles.x.tier ignored: profiles.x.level is set"]);
});

test("legacy profile tier that no enabled member carries is dropped with a problem; the profile keeps its other fields", () => {
  const r = parseSettings({ models: { sonnet: { model: "" } }, profiles: { x: { tier: "T1", tools: "read-only" } } });
  assert.equal((r.settings.profiles.x as any).level, undefined);
  assert.equal("tier" in r.settings.profiles.x, false);
  assert.equal(r.settings.profiles.x.tools, "read-only");
  assert.ok(r.problems.includes("legacy key profiles.x.tier dropped: no enabled member has tier T1"), r.problems.join("\n"));
});

test("a profile entry that is not an object is ignored with a problem", () => {
  const r = parseSettings({ profiles: { x: 3 } });
  assert.deepEqual(r.settings.profiles, {});
  assert.deepEqual(r.problems, ["profiles.x: not an object; ignored"]);
});

// --- validation: cap, tables, profiles (spec §5.4 rules 2–4, mi6; T2.11) ----------------------

const BIG = { model: "x/big", tier: "T3", route: "T2", abilities: { write: 3, read: 3 }, efforts: ["high"], contextWindow: 1000000, cost: 9 };

test("cap (per table, M2 (b)): a write-3 member with no row 3 is capped to 2 at plan time with a problem; its own level stays", () => {
  const r = parseSettings({ models: { big: BIG } });
  assert.deepEqual(r.settings.models.big.abilities, { write: 3, read: 3 });
  assert.deepEqual(r.problems, ["models.big.abilities.write 3 capped to 2 for importanceTable.write (plan time, the profiles using it)"]);
  const view = capToTable(r.settings, { ability: "write", tools: "all", skills: [], report: "default" });
  const top = Math.max(...enabled(view.models).map((m) => m.abilities.write));
  assert.equal(top, 2);
  assert.ok(r.settings.importanceTable.write[String(top)]);
});

test("cap (per table, M2 (b)): a custom read table to row 2 caps read for the profiles using it only, never the members", () => {
  const rows = structuredClone(defaults().importanceTable.write); // rows 0..2, legs ≤ 2: a valid read table to row 2
  const r = parseSettings({ importanceTable: { mine: rows }, profiles: { x: { ability: "read", table: "mine" } } });
  assert.equal(r.settings.models.opus.abilities.read, 3);
  assert.deepEqual(r.problems, ["models.opus.abilities.read 3 capped to 2 for importanceTable.mine (plan time, the profiles using it)"]);
  const x = capToTable(r.settings, r.settings.profiles.x), scout = capToTable(r.settings, BUILTIN_PROFILES.scout);
  assert.deepEqual([x.models.opus.abilities.read, scout.models.opus.abilities.read], [2, 3]);
  assert.equal(scout, r.settings, "a table that caps nothing returns the settings themselves");
});

const PLAN_TIME = "at plan time a review leg above the top is lowered to it, a worker leg above it rejects its spawn";

test("M1: the default tables are validated against top(a) too; a leg above it is reported, not replaced (there is no other default)", () => {
  const r = parseSettings({ models: { opus: { model: "" } } });
  assert.deepEqual(r.problems, [
    `importanceTable.read (default): row 0.critical.review: level 3 above the top 2 of read; ${PLAN_TIME}`, // the profiles' order
    `importanceTable.write (default): row 0.critical.review: level 2 above the top 1 of write; ${PLAN_TIME}`,
    `importanceTable.review (default): row 0.critical.review: level 3 above the top 2 of read; ${PLAN_TIME}`,
  ]);
  assert.deepEqual(r.settings.importanceTable, defaults().importanceTable);
});

test("M1: a configured table replaced by its default is validated again as the default", () => {
  const r = parseSettings({ models: { opus: { model: "" } }, importanceTable: { write: defaults().importanceTable.write } });
  assert.deepEqual(r.problems.filter((l) => l.startsWith("importanceTable.write")), [
    "importanceTable.write: row 0.critical.review: level 2 above the top 1 of write; default used",
    `importanceTable.write (default): row 0.critical.review: level 2 above the top 1 of write; ${PLAN_TIME}`,
  ]);
});

test("M1: a built-in floor above top(a) is reported; its spawns are rejected (sonnet+opus blank: scout, debug-design, review)", () => {
  const r = parseSettings(todayWith({ models: { sonnet: { model: "" }, opus: { model: "" } } })); // T5.1: today (no Haiku: top read 0)
  assert.deepEqual(r.problems.filter((l) => l.startsWith("profiles.")), [
    "profiles.scout.minLevel: built-in 2 above the top 0 of read; its spawns are rejected",
    "profiles.debug-design.minLevel: built-in 1 above the top 0 of write; its spawns are rejected",
    "profiles.review.minLevel: built-in 2 above the top 0 of read; its spawns are rejected",
  ]);
  const s = parseSettings(todayWith({ models: { "qwen-local": { model: "" }, "qwen-cloud": { model: "" }, sonnet: { model: "" }, opus: { model: "" } } }));
  assert.ok(s.problems.includes("profiles.implement: no enabled member has ability write; its spawns are rejected"), s.problems.join("\n"));
});

test("tables: a configured table that breaks a rule → its default is used, with a problem", () => {
  const W = (level: number, step: number, review?: { level: number; step: number }) => ({ worker: { level, step }, ...(review ? { review } : {}) });
  const cases: [string, Record<string, unknown>, string][] = [
    ["a cell", { "1": { high: "x" } }, "row 1.high: cell missing"],
    ["a negative step", { "1": { high: W(1, -1) } }, "row 1.high.worker: level and step must be non-negative integers"],
    ["a worker below its row", { "2": { normal: W(1, 0) } }, "row 2.normal.worker: level 1 below its row"],
    ["a leg above the top", { "0": { critical: W(1, 0, { level: 3, step: 0 }) } }, "row 0.critical.review: level 3 above the top 2 of write"],
    ["a decreasing worker", { "1": { critical: W(1, 0) } }, "row 1: worker decreases from normal to critical"],
  ];
  for (const [name, rows, why] of cases) {
    const r = parseSettings({ importanceTable: { write: rows } });
    assert.deepEqual(r.problems, [`importanceTable.write: ${why}; default used`], name);
    assert.deepEqual(r.settings.importanceTable.write, defaults().importanceTable.write, name);
  }
});

test("tables: a new invalid table is dropped and the profile naming it loses its table", () => {
  const rows = structuredClone(defaults().importanceTable.write) as Record<string, unknown>;
  delete rows["1"];
  const r = parseSettings({ importanceTable: { mine: rows }, profiles: { x: { table: "mine", tools: "read-only" } } });
  assert.equal("mine" in r.settings.importanceTable, false);
  assert.deepEqual(r.settings.profiles.x, { tools: "read-only" });
  assert.deepEqual(r.problems, ["importanceTable.mine: row 1 missing; dropped", "profiles.x.table: no importanceTable.mine; dropped"]);
});

test("tables: a valid new table used by a profile is kept; an unused one is not checked", () => {
  const rows = structuredClone(defaults().importanceTable.write);
  const r = parseSettings({ importanceTable: { mine: rows, spare: { "0": "x" } }, profiles: { x: { table: "mine" } } });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.settings.importanceTable.mine, rows);
});

test("profiles: an unserved ability, a missing table, a level or minLevel off the scale are dropped; level top stays", () => {
  const r = parseSettings({ profiles: {
    x: { ability: "taste", tools: "read-only" }, y: { level: 9 }, scout: { minLevel: 4 }, z: { table: "nope" }, w: { level: "top" }, v: { minLevel: -1 },
  } });
  const p = r.settings.profiles as Record<string, Record<string, unknown>>;
  assert.deepEqual([p.x, p.y, p.scout, p.z, p.w, p.v], [{ tools: "read-only" }, {}, {}, {}, { level: "top" }, {}]);
  assert.deepEqual(r.problems, [
    "profiles.x.ability: no enabled member has ability taste; dropped",
    "profiles.y.level: 9 is not a level of write (0..2); dropped",
    "profiles.scout.minLevel: 4 is not a level of read (0..3); dropped",
    "profiles.z.table: no importanceTable.nope; dropped",
    "profiles.v.minLevel: -1 is not a level of write (0..2); dropped",
  ]);
});

test("profiles: a level is checked on the profile's ability after the cap (read pin 3 with the read top capped to 2)", () => {
  const rows = structuredClone(defaults().importanceTable.write); // rows 0..2, legs ≤ 2: a valid read table to row 2
  const r = parseSettings({ importanceTable: { mine: rows }, profiles: { x: { ability: "read", table: "mine", level: 3 } } });
  assert.equal("level" in r.settings.profiles.x, false);
  assert.equal(r.problems.at(-1), "profiles.x.level: 3 is not a level of read (0..2); dropped");
});

test("validation order: a member problem before a table problem before a profile problem", () => {
  const r = parseSettings({
    profiles: { x: { ability: "taste" } }, importanceTable: { write: { "1": { high: "x" } } }, models: { extra: { model: "x/y" } },
  });
  assert.deepEqual(r.problems.map((l) => l.split(/[.:]/)[0]), ["models", "importanceTable", "profiles"]);
});
