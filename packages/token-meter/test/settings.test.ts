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

test("invalid JSON → defaults (never partly applied)", () => {
  const f = join(tmp(), "settings.json");
  writeFileSync(f, "{ not json");
  assert.deepEqual(loadSettings(f), defaults());
});
