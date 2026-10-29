// P.6 (spec §8.3): fixtures and defaults name no machine. A neutral host is localhost, a reserved *.invalid name or one letter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { defaults } from "../core/settings.ts";

const urls = (v: unknown): string[] =>
  typeof v === "string" ? (/^https?:\/\//.test(v) ? [v] : [])
  : Array.isArray(v) ? v.flatMap(urls)
  : v !== null && typeof v === "object" ? Object.values(v).flatMap(urls) : [];
const neutral = (u: string): boolean => {
  const h = new URL(u).hostname;
  return h === "localhost" || h.endsWith(".invalid") || h.length === 1;
};

test("fixtures and defaults: every URL's host is localhost, *.invalid or one letter", () => {
  const dir = new URL("./fixtures/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 2, `fixtures: ${files.join()}`);
  const bad = files.flatMap((f) => urls(JSON.parse(readFileSync(new URL(f, dir), "utf8"))).filter((u) => !neutral(u)).map((u) => `${f}: ${u}`));
  bad.push(...urls(defaults()).filter((u) => !neutral(u)).map((u) => `defaults(): ${u}`));
  assert.deepEqual(bad, []);
});
