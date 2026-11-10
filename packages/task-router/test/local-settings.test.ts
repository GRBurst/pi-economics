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
