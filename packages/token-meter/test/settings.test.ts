import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaults, loadSettings } from "../core/settings.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "token-meter-"));

test("missing file → defaults", () => {
  assert.deepEqual(loadSettings("/nonexistent/settings.json"), defaults());
});

test("known keys override defaults, unknown keys and wrong types are ignored", () => {
  const f = join(tmp(), "settings.json");
  writeFileSync(f, JSON.stringify({ dir: "m2", enabled: "yes", extra: 1 }));
  assert.deepEqual(loadSettings(f), { ...defaults(), dir: "m2" });
});

test("plans: read through parsePlans (malformed plans dropped); default none", () => {
  assert.deepEqual(defaults().plans, {});
  const f = join(tmp(), "settings.json");
  writeFileSync(f, JSON.stringify({ plans: { "p-local": { billing: "local" }, bad: { billing: 1 } } }));
  assert.deepEqual(loadSettings(f), { ...defaults(), plans: { "p-local": { billing: "local", windows: [] } } });
  writeFileSync(f, JSON.stringify({ plans: [{ billing: "local" }] }));
  assert.deepEqual(loadSettings(f), defaults());
});

test("invalid JSON → defaults (never partly applied)", () => {
  const f = join(tmp(), "settings.json");
  writeFileSync(f, "{ not json");
  assert.deepEqual(loadSettings(f), defaults());
});

test("M8 currency.rates: positive numbers under keys FROM/TO (three capitals each) are kept, anything else is dropped; default none", () => {
  assert.deepEqual(defaults().currency, { rates: {} });
  const f = join(tmp(), "settings.json");
  writeFileSync(f, JSON.stringify({ currency: { rates: { "USD/EUR": 0.92, "EUR/USD": 0, "usd/eur": 1, "USD/EURO": 1, "GBP/USD": "1.2", "CHF/EUR": -1 } } }));
  assert.deepEqual(loadSettings(f).currency, { rates: { "USD/EUR": 0.92 } });
  writeFileSync(f, JSON.stringify({ currency: [1], plans: {} }));
  assert.deepEqual(loadSettings(f).currency, { rates: {} });
});
