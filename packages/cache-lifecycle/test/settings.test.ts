import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaults, loadSettings } from "../core/settings.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "cache-lifecycle-"));

test("missing file → defaults", () => {
  assert.deepEqual(loadSettings("/nonexistent/settings.json"), defaults());
});

test("known keys override defaults, unknown keys and wrong types are ignored", () => {
  const f = join(tmp(), "settings.json");
  writeFileSync(f, JSON.stringify({ maskOnCold: "tools", mainCacheTtl: "2h", protectedTailTokens: "big", extra: 1 }));
  assert.deepEqual(loadSettings(f), { ...defaults(), maskOnCold: "tools" });
});

test("invalid JSON → defaults (never partly applied)", () => {
  const f = join(tmp(), "settings.json");
  writeFileSync(f, "{ not json");
  assert.deepEqual(loadSettings(f), defaults());
});

test("defaults: orchestrator-aware warming, 5m TTL, masking off, 20000-token protected tail", () => {
  assert.deepEqual(defaults(), { warmPolicy: "orchestrator-aware", mainCacheTtl: "5m", maskOnCold: "off", protectedTailTokens: 20000, identityShim: true });
});

test("identityShim is a boolean: false is honoured, a string is ignored", () => {
  const f = join(tmp(), "settings.json");
  writeFileSync(f, JSON.stringify({ identityShim: false }));
  assert.deepEqual(loadSettings(f), { ...defaults(), identityShim: false });
  writeFileSync(f, JSON.stringify({ identityShim: "no" }));
  assert.deepEqual(loadSettings(f), defaults());
});

test("warmPolicy: native is honoured, anything else is ignored", () => {
  const f = join(tmp(), "settings.json");
  writeFileSync(f, JSON.stringify({ warmPolicy: "native" }));
  assert.equal(loadSettings(f).warmPolicy, "native");
  writeFileSync(f, JSON.stringify({ warmPolicy: "always" }));
  assert.equal(loadSettings(f).warmPolicy, "orchestrator-aware");
});
