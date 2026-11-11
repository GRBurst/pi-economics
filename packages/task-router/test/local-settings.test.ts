// Local mode L1.T2–T3 (design §3.0.1, AC-R1): every local key is a setting with a default; invalid values are reported
// and replaced by their default.
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaults, parseSettings } from "../core/settings.ts";
import { LOCAL_COMPONENTS, componentOn } from "../core/local/mode.ts";

/** Design §3.0.1's JSON, verbatim (`plans.regression` = "milestone"; plan Q12 adds "off" as a third value). */
const DESIGN = JSON.parse(`{
  "mode": "default",
  "hints": {
    "enabled": "auto",
    "identicalCalls": 3, "noChangeWrites": 4, "alternations": 2,
    "repeatedErrors": 2, "errorSimilarity": 0.92,
    "churnEdits": 3, "churnTurns": 4,
    "checkFailures": 2,
    "contextPercent": 85, "stallTurns": 25, "contextSoftTokens": 32000,
    "cooldownCalls": 5, "persistTrips": 2, "steer": "on"
  },
  "overseer": {
    "member": "opus", "effort": "high",
    "fallbackMember": "sonnet", "fallbackEffort": "xhigh",
    "budget": 15, "steerBudget": 3,
    "timeoutSec": 900, "resubmits": 2,
    "tools": ["read", "grep", "find", "ls"]
  },
  "worktrees": { "enabled": "auto", "root": "../{repo}.worktrees", "branchPrefix": "lm/", "removeAfterMerge": true },
  "mergeGate": {
    "enabled": "auto", "mainBranches": ["main", "master"],
    "maxDiffLines": 150, "maxDiffFiles": 6, "extraChecks": [], "redRun": true,
    "rejectionsBeforeFixer": 2, "fixerMember": "sonnet", "fixerEffort": "high", "fixerRounds": 1,
    "push": false, "remote": "origin"
  },
  "plans": {
    "enabled": "auto", "dir": "docs/plans",
    "taskFiles": 2, "taskLines": 60, "splitFiles": 3, "splitLines": 100,
    "milestoneTasks": 5, "milestoneLines": 250, "taskTurns": 12,
    "rounds": 2, "regression": "milestone", "publicApiGlobs": []
  },
  "force": { "model": "", "thinkingLevel": "" }
}`);
const at = (o: any, path: string): unknown => path.split(".").reduce((x, k) => x?.[k], o);
const kept = (path: string, why: string) => `${path}: ${why}; default kept`;

// --- L1.T2: keys and enums ---------------------------------------------------------------------------------------------

test("AC-R1: mode local parses without problems", () => {
  const r = parseSettings({ mode: "local" });
  assert.equal(r.settings.mode, "local");
  assert.deepEqual(r.problems, []);
});

test("AC-R1: an unknown mode is reported and the default kept", () => {
  const r = parseSettings({ mode: "x" });
  assert.equal(r.settings.mode, "default");
  assert.deepEqual(r.problems, [kept("mode", 'must be "default" or "local"')]);
});

test("AC-R1: an unknown toggle is reported and the default kept", () => {
  const r = parseSettings({ hints: { enabled: "maybe" } });
  assert.equal(r.problems.length, 1);
  assert.ok(r.problems[0].startsWith("hints.enabled:"), r.problems[0]);
  assert.equal(r.settings.hints.enabled, "auto");
});

test("every component toggle: auto/on/off parse; componentOn = on, or auto in local mode", () => {
  for (const c of LOCAL_COMPONENTS) for (const v of ["auto", "on", "off"]) for (const mode of ["default", "local"]) {
    const r = parseSettings({ mode, [c]: { enabled: v } });
    assert.deepEqual(r.problems, [], `${c} ${v} ${mode}`);
    assert.equal(componentOn(r.settings, c), v === "on" || (v === "auto" && mode === "local"), `${c} ${v} ${mode}`);
  }
});

test("the other enums: an invalid value is reported at its path and the default kept", () => {
  const cases: [string, unknown][] = [
    ["worktrees.enabled", "yes"], ["mergeGate.enabled", "1"], ["plans.enabled", "maybe"], ["hints.steer", "auto"],
    ["plans.regression", "task"], ["force.thinkingLevel", "ultra"], ["overseer.effort", "huge"],
    ["overseer.fallbackEffort", "x"], ["mergeGate.fixerEffort", ""],
  ];
  for (const [path, v] of cases) {
    const [top, key] = path.split(".");
    const r = parseSettings({ [top]: { [key]: v } });
    assert.equal(r.problems.length, 1, `${path}: ${r.problems.join(" | ")}`);
    assert.ok(r.problems[0].startsWith(`${path}: must be `) && r.problems[0].endsWith("; default kept"), r.problems[0]);
    assert.deepEqual(at(r.settings, path), at(defaults(), path), path);
  }
  for (const [path, v] of [["hints.steer", "off"], ["plans.regression", "off"], ["plans.regression", "plan"], ["force.thinkingLevel", "high"], ["overseer.effort", "xhigh"]] as const) {
    const [top, key] = path.split(".");
    const r = parseSettings({ [top]: { [key]: v } });
    assert.deepEqual(r.problems, [], `${path} ${v}`);
    assert.equal(at(r.settings, path), v);
  }
});

test("defaults() holds design §3.0.1's keys and values; {} parses to defaults()", () => {
  const d = defaults() as unknown as Record<string, unknown>;
  for (const k of Object.keys(DESIGN)) assert.deepEqual(d[k], DESIGN[k], k);
  assert.deepEqual(parseSettings({}).settings, defaults());
  assert.deepEqual(parseSettings({}).problems, []);
});

// --- L1.T3: counts, ranges, lists, member references ------------------------------------------------------------------

const RANGES = ["hints.errorSimilarity", "hints.contextPercent"];
/** Every number-valued leaf of the local sections except the two ranges (derived from defaults(), not a literal). */
const COUNTS = (["hints", "overseer", "mergeGate", "plans"] as const).flatMap((sec) =>
  Object.entries(defaults()[sec]).filter(([, v]) => typeof v === "number").map(([k]) => `${sec}.${k}`)).filter((p) => !RANGES.includes(p));
const one = (path: string, v: unknown): Record<string, unknown> => { const [top, key] = path.split("."); return { [top]: { [key]: v } }; };

/** The counts whose 0 means "none": Opus never used, no steering, no resubmits, no fixer (review F11) (they are non-negative;
 *  the others positive). */
const ZERO = ["overseer.budget", "overseer.steerBudget", "overseer.resubmits", "mergeGate.fixerRounds"];

test("COUNT: every count must be a positive integer, except the four that may be 0", () => {
  assert.ok(COUNTS.length >= 20, `${COUNTS.length} counts`);
  for (const p of ZERO) assert.ok(COUNTS.includes(p), p);
  for (const p of COUNTS) {
    const why = ZERO.includes(p) ? "must be a non-negative integer" : "must be a positive integer";
    for (const v of ZERO.includes(p) ? [-1, 1.5] : [0, -1, 1.5]) {
      const r = parseSettings(one(p, v));
      assert.deepEqual(r.problems, [kept(p, why)], `${p} = ${v}`);
      assert.equal(at(r.settings, p), at(defaults(), p));
    }
    if (ZERO.includes(p)) {
      const z = parseSettings(one(p, 0));
      assert.deepEqual([z.problems, at(z.settings, p)], [[], 0], `${p} = 0`);
    }
    const s = parseSettings(one(p, "7")); // merge() drops a value of the wrong type: no problem
    assert.deepEqual([s.problems, at(s.settings, p)], [[], at(defaults(), p)], `${p} = "7"`);
    for (const v of [1, 9]) {
      const r = parseSettings(one(p, v));
      assert.deepEqual([r.problems, at(r.settings, p)], [[], v], `${p} = ${v}`);
    }
  }
});

test("RANGE: errorSimilarity in (0, 1], contextPercent in (0, 100]", () => {
  for (const [p, bad, good, why] of [
    ["hints.errorSimilarity", [0, 1.2, -0.5], [1, 0.5], "must be a number in (0, 1]"],
    ["hints.contextPercent", [0, 101, -3], [100, 85, 0.5], "must be a number in (0, 100]"],
  ] as const) {
    for (const v of bad) {
      const r = parseSettings(one(p, v));
      assert.deepEqual(r.problems, [kept(p, why)], `${p} = ${v}`);
      assert.equal(at(r.settings, p), at(defaults(), p));
    }
    for (const v of good) assert.deepEqual(parseSettings(one(p, v)).problems, [], `${p} = ${v}`);
  }
});

test("LIST: mainBranches non-empty strings; tools non-empty; extraChecks and publicApiGlobs strings", () => {
  const cases: [string, unknown, string][] = [
    ["mergeGate.mainBranches", [], "must be a non-empty list of non-empty strings"],
    ["mergeGate.mainBranches", ["main", ""], "must be a non-empty list of non-empty strings"],
    ["mergeGate.mainBranches", [3], "must be a non-empty list of non-empty strings"],
    ["overseer.tools", [], "must be a non-empty list of strings"],
    ["overseer.tools", ["read", 1], "must be a non-empty list of strings"],
    ["mergeGate.extraChecks", [{}], "must be a list of strings"],
    ["plans.publicApiGlobs", [null], "must be a list of strings"],
  ];
  for (const [p, v, why] of cases) {
    const r = parseSettings(one(p, v));
    assert.deepEqual(r.problems, [kept(p, why)], `${p} = ${JSON.stringify(v)}`);
    assert.deepEqual(at(r.settings, p), at(defaults(), p));
  }
  for (const [p, v] of [["mergeGate.mainBranches", ["trunk"]], ["overseer.tools", ["read"]], ["mergeGate.extraChecks", ["make lint"]], ["plans.publicApiGlobs", ["src/api/**"]]] as const) {
    const r = parseSettings(one(p, v));
    assert.deepEqual([r.problems, at(r.settings, p)], [[], v], p);
  }
});

test("overseer.tools must not write (L4.T14): bash, edit or write is reported, its first one named, and the default kept", () => {
  for (const [v, t] of [[["read", "bash"], "bash"], [["edit"], "edit"], [["write", "edit"], "write"]] as const) {
    const r = parseSettings(one("overseer.tools", v));
    assert.deepEqual(r.problems, [kept("overseer.tools", `${t} can write`)], JSON.stringify(v));
    assert.deepEqual(r.settings.overseer.tools, defaults().overseer.tools);
  }
  const ok = parseSettings(one("overseer.tools", ["read", "search-ext"]));
  assert.deepEqual([ok.problems, ok.settings.overseer.tools], [[], ["read", "search-ext"]]);
});

test("MEMBER: in local mode the overseer and fixer name enabled members and efforts on their ladders", () => {
  const blank = parseSettings({ mode: "local", models: { opus: { model: "" } } });
  assert.deepEqual(blank.problems.filter((l) => l.startsWith("overseer.")), [kept("overseer.member", '"opus" is not an enabled member')]);
  assert.equal(blank.settings.overseer.member, "opus", "an invalid default is reported and kept");
  const low = parseSettings({ mode: "local", overseer: { effort: "low" } });
  assert.deepEqual(low.problems, [kept("overseer.effort", "low is not an effort of opus (high, xhigh)")]);
  assert.equal(low.settings.overseer.effort, "high");
  const fix = parseSettings({ mode: "local", mergeGate: { fixerMember: "nosuch", fixerEffort: "medium" }, overseer: { fallbackMember: "haiku", fallbackEffort: "xhigh" } });
  assert.deepEqual(fix.problems, [
    kept("overseer.fallbackEffort", "xhigh is not an effort of haiku (medium, high)"),
    kept("mergeGate.fixerMember", '"nosuch" is not an enabled member'),
    kept("mergeGate.fixerEffort", "medium is not an effort of sonnet (high, xhigh)"),
  ]);
  assert.deepEqual([fix.settings.mergeGate.fixerMember, fix.settings.mergeGate.fixerEffort, fix.settings.overseer.fallbackMember], ["sonnet", "high", "haiku"]);
});

test("MEMBER (D2): default mode does not check member references; a component switched on does", () => {
  for (const raw of [{ models: { opus: { model: "" } } }, { overseer: { effort: "low" } }])
    assert.deepEqual(parseSettings(raw).problems.filter((l) => l.startsWith("overseer.")), [], JSON.stringify(raw));
  const on = parseSettings({ hints: { enabled: "on" }, models: { opus: { model: "" } } });
  assert.deepEqual(on.problems.filter((l) => l.startsWith("overseer.")), [kept("overseer.member", '"opus" is not an enabled member')]);
});
