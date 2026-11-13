import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveSettings, LEVER_IDS } from "../core/effective-settings.ts";
import { leversLine, leverViolations } from "../core/levers.ts";
import type { LeverState } from "../core/levers.ts";

// pi 1.4 docs/settings.md defaults (design §8.1); every lever s = "fixed" (configuration or pi default).
const DEFAULTS: Record<string, string | number | boolean> = {
  "pi.cacheWarming": "streaming",
  "pi.promptCache": "short",
  "pi.compaction.enabled": true,
  "pi.compaction.reserveTokens": 16384,
  "pi.compaction.keepRecentTokens": 20000,
  "pi.branchSummary.reserveTokens": 16384,
  "pi.branchSummary.skipPrompt": false,
  "pi.codemode.mode": "on",
  "pi.codemode.inlineBudget": 3000,
  "pi.transport": "auto",
  "pi.retry.enabled": true,
  "pi.retry.maxRetries": 3,
  "pi.retry.baseDelayMs": 2000,
  "pi.retry.maxAgentDelayMs": 60000,
  "pi.retry.provider.timeoutMs": 300000,
  "pi.retry.provider.maxRetries": 0,
  "pi.retry.provider.maxRetryDelayMs": 60000,
  "pi.images.autoResize": true,
  "pi.images.blockImages": false,
  "pi.thinkingBudgets.minimal": 1024,
  "pi.thinkingBudgets.low": 2048,
  "pi.thinkingBudgets.medium": 8192,
  "pi.thinkingBudgets.high": 16384,
  "pi.defaultThinkingLevel": "medium",
  "pi.defaultTools.read": true,
  "pi.defaultTools.bash": true,
  "pi.defaultTools.powershell": false,
  "pi.defaultTools.edit": true,
  "pi.defaultTools.write": true,
  "pi.defaultTools.grep": false,
  "pi.defaultTools.find": false,
  "pi.defaultTools.ls": false,
  "pi.defaultTools.codemode": false,
  "pi.defaultTools.tool_search": false,
};

const values = (r: Record<string, LeverState>) => Object.fromEntries(Object.entries(r).map(([k, x]) => [k, x.v]));
const tools = (r: Record<string, LeverState>) =>
  Object.entries(r).filter(([k, x]) => k.startsWith("pi.defaultTools.") && x.v === true).map(([k]) => k.slice(16)).sort();

test("effectiveSettings: no settings → pi's defaults, every lever fixed and valid", () => {
  const r = effectiveSettings({}, {});
  assert.deepEqual(values(r), DEFAULTS);
  assert.deepEqual(Object.keys(r), [...LEVER_IDS]);
  for (const [id, x] of Object.entries(r)) {
    assert.equal(x.s, "fixed", id);
    assert.deepEqual(leverViolations(x), [], id);
  }
  // not an object (missing or broken file) reads as no settings
  for (const g of [undefined, null, "x", [1], 3]) assert.deepEqual(values(effectiveSettings(g, g)), DEFAULTS);
});

test("effectiveSettings: global values, project overrides merged deeply (project wins per key)", () => {
  const g = { transport: "sse", retry: { maxRetries: 5, baseDelayMs: 1000, provider: { maxRetries: 2 } }, images: { blockImages: true },
    thinkingBudgets: { low: 4096 }, codemode: { mode: "only" }, httpIdleTimeoutMs: 120000 };
  const p = { transport: "websocket-cached", retry: { maxRetries: 1, provider: { timeoutMs: 9000 } }, branchSummary: { skipPrompt: true } };
  const r = values(effectiveSettings(g, p));
  assert.deepEqual(r, { ...DEFAULTS,
    "pi.transport": "websocket-cached", "pi.retry.maxRetries": 1, "pi.retry.baseDelayMs": 1000,
    "pi.retry.provider.maxRetries": 2, "pi.retry.provider.timeoutMs": 9000, "pi.images.blockImages": true,
    "pi.thinkingBudgets.low": 4096, "pi.codemode.mode": "only", "pi.branchSummary.skipPrompt": true });
  // retry.provider.timeoutMs defaults to httpIdleTimeoutMs
  assert.equal(values(effectiveSettings(g, {}))["pi.retry.provider.timeoutMs"], 120000);
});

test("effectiveSettings: cacheWarming is global only; an unknown mode is pi's streaming", () => {
  assert.equal(values(effectiveSettings({ cacheWarming: "idle" }, { cacheWarming: "off" }))["pi.cacheWarming"], "idle");
  assert.equal(values(effectiveSettings({}, { cacheWarming: "off" }))["pi.cacheWarming"], "streaming");
  assert.equal(values(effectiveSettings({ cacheWarming: "always" }, {}))["pi.cacheWarming"], "streaming");
});

test("effectiveSettings: promptCache from PI_CACHE_RETENTION", () => {
  assert.equal(values(effectiveSettings({}, {}, { cacheRetention: "long" }))["pi.promptCache"], "long");
  assert.equal(values(effectiveSettings({}, {}, { cacheRetention: "short" }))["pi.promptCache"], "short");
  assert.equal(values(effectiveSettings({}, {}, { cacheRetention: "forever" }))["pi.promptCache"], "short");
});

test("effectiveSettings: compaction tokens: model override, then ordinary, then default; objects merge before lookup", () => {
  const g = { compaction: { reserveTokens: 30000, modelOverrides: { "anthropic/claude-x": { keepRecentTokens: 5000 } } } };
  const p = { compaction: { enabled: false, modelOverrides: { "anthropic/claude-x": { reserveTokens: 7000 } } } };
  const on = values(effectiveSettings(g, p, { model: "anthropic/claude-x" }));
  assert.deepEqual([on["pi.compaction.enabled"], on["pi.compaction.reserveTokens"], on["pi.compaction.keepRecentTokens"]], [false, 7000, 5000]);
  const other = values(effectiveSettings(g, p, { model: "openai/gpt-y" }));
  assert.deepEqual([other["pi.compaction.reserveTokens"], other["pi.compaction.keepRecentTokens"]], [30000, 20000]);
  assert.equal(values(effectiveSettings(g, p))["pi.compaction.reserveTokens"], 30000);
});

test("effectiveSettings: thinking level: per-model level, then defaultThinkingLevel, then medium", () => {
  const g = { defaultThinkingLevel: "low", modelThinkingLevels: { "anthropic/claude-x": "xhigh" } };
  assert.equal(values(effectiveSettings(g, {}, { model: "anthropic/claude-x" }))["pi.defaultThinkingLevel"], "xhigh");
  assert.equal(values(effectiveSettings(g, {}, { model: "openai/gpt-y" }))["pi.defaultThinkingLevel"], "low");
  assert.equal(values(effectiveSettings(g, { defaultThinkingLevel: "off" }))["pi.defaultThinkingLevel"], "off");
});

test("effectiveSettings: defaultTools: plain names replace, +/- modify the inherited selection", () => {
  const t = (g: unknown, p: unknown) => tools(effectiveSettings(g, p));
  assert.deepEqual(t({ defaultTools: ["+codemode"] }, {}), ["bash", "codemode", "edit", "read", "write"]);
  assert.deepEqual(t({ defaultTools: ["read"] }, { defaultTools: ["+grep"] }), ["grep", "read"]);
  assert.deepEqual(t({ defaultTools: ["+grep"] }, { defaultTools: ["-bash", "+powershell"] }), ["edit", "grep", "powershell", "read", "write"]);
  assert.deepEqual(t({ defaultTools: ["read", "grep"] }, { defaultTools: ["ls"] }), ["ls"]);
  assert.deepEqual(t({ defaultTools: [] }, {}), []);
  assert.deepEqual(t({}, { defaultTools: ["read", "-read", "+ls"] }), ["ls"]);
  // an extension's own tool is not a lever (bounded line size)
  assert.equal(effectiveSettings({ defaultTools: ["+my_tool"] }, {})["pi.defaultTools.my_tool"], undefined);
});

test("effectiveSettings: an invalid value leaves its lever out (unknown), never guesses", () => {
  const cases: Array<[unknown, string]> = [
    [{ compaction: { reserveTokens: -1 } }, "pi.compaction.reserveTokens"],
    [{ compaction: { keepRecentTokens: "x" } }, "pi.compaction.keepRecentTokens"],
    [{ compaction: { enabled: "no" } }, "pi.compaction.enabled"],
    [{ transport: "pigeon" }, "pi.transport"],
    [{ retry: { maxRetries: "3" } }, "pi.retry.maxRetries"],
    [{ retry: { baseDelayMs: 1.5 } }, "pi.retry.baseDelayMs"],
    [{ images: { autoResize: "yes" } }, "pi.images.autoResize"],
    [{ codemode: { mode: "sometimes" } }, "pi.codemode.mode"],
    [{ thinkingBudgets: { high: null } }, "pi.thinkingBudgets.high"],
    [{ defaultThinkingLevel: "extreme" }, "pi.defaultThinkingLevel"],
    [{ branchSummary: { reserveTokens: true } }, "pi.branchSummary.reserveTokens"],
  ];
  for (const [g, id] of cases) {
    const r = effectiveSettings(g, {});
    assert.equal(r[id], undefined, id);
    assert.equal(Object.keys(r).length, LEVER_IDS.length - 1, id);
  }
  const broken = effectiveSettings({ defaultTools: "read" }, {});
  assert.equal(Object.keys(broken).filter((k) => k.startsWith("pi.defaultTools.")).length, 0);
  // a broken model override: pi throws; the levers it decides are unknown
  const r = effectiveSettings({ compaction: { modelOverrides: { "a/m": 3 } } }, {}, { model: "a/m" });
  assert.equal(r["pi.compaction.reserveTokens"], undefined);
  assert.equal(r["pi.compaction.keepRecentTokens"], undefined);
});

// M3b review F2: pi 1.4 migrates each settings file on load (SettingsManager.migrateSettings) and parses httpIdleTimeoutMs
// (parseHttpIdleTimeoutMs: numeric strings, floored, "disabled" = 0 = no timeout, 2147483647 ms for the request).
test("effectiveSettings: pi's migrations per file (websockets → transport, retry.maxDelayMs → provider) and httpIdleTimeoutMs forms", () => {
  const probe = effectiveSettings({ websockets: true, retry: { maxDelayMs: 30000 }, httpIdleTimeoutMs: "disabled" }, {});
  assert.deepEqual([probe["pi.transport"]?.v, probe["pi.retry.provider.maxRetryDelayMs"]?.v, probe["pi.retry.provider.timeoutMs"]?.v], ["websocket", 30000, 2147483647]);
  const v = (g: unknown, p: unknown, id: string) => effectiveSettings(g, p)[id]?.v;
  assert.equal(v({ websockets: false }, {}, "pi.transport"), "sse");
  assert.equal(v({ transport: "auto", websockets: true }, {}, "pi.transport"), "auto", "transport set: websockets ignored");
  assert.equal(v({ transport: "sse" }, { websockets: true }, "pi.transport"), "websocket", "per file: the project's migrated transport wins");
  assert.equal(v({ websockets: "yes" }, {}, "pi.transport"), "auto", "not a boolean: no migration");
  assert.equal(v({ retry: { maxDelayMs: 30000, provider: { maxRetryDelayMs: 5000 } } }, {}, "pi.retry.provider.maxRetryDelayMs"), 5000);
  assert.equal(v({ retry: { maxDelayMs: 30000, provider: { maxRetryDelayMs: null } } }, {}, "pi.retry.provider.maxRetryDelayMs"), 30000);
  assert.equal(v({ retry: { provider: { maxRetryDelayMs: 7000 } } }, { retry: { maxDelayMs: 30000 } }, "pi.retry.provider.maxRetryDelayMs"), 30000, "per file");
  for (const [x, want] of [[" 120000.7 ", 120000], [90000.9, 90000], ["DISABLED", 2147483647], [0, 2147483647], ["", undefined], ["abc", undefined], [-5, undefined], [true, undefined]] as const)
    assert.equal(v({ httpIdleTimeoutMs: x }, {}, "pi.retry.provider.timeoutMs"), want, JSON.stringify(x));
  assert.equal(v({ httpIdleTimeoutMs: "disabled", retry: { provider: { timeoutMs: 1000 } } }, {}, "pi.retry.provider.timeoutMs"), 1000, "the provider timeout wins");
  const input = { websockets: true, retry: { maxDelayMs: 30000 } };
  effectiveSettings(input, {});
  assert.deepEqual(input, { websockets: true, retry: { maxDelayMs: 30000 } }, "the parsed file is not changed");
});

test("byte cap: a levers line holding every lever, each in its longest state, fits 4096 bytes", () => {
  const worst: LeverState = { v: 2147483647, s: "fixed", a: 2147483646, rb: "refused", tier: "control" };
  const levers = Object.fromEntries(LEVER_IDS.map((id) => [id, worst]));
  const uuid = "019a1b2c-3d4e-7f50-8a9b-0c1d2e3f4a5b";
  assert.doesNotThrow(() => leversLine({ ts: "2026-10-02T12:00:00.000Z", sessionId: uuid, parentSessionId: uuid,
    arm: "x".repeat(32), design: "x".repeat(32), eligible: true, stratum: "x".repeat(32), levers }));
});
