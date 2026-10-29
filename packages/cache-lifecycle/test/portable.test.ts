// Portability contract: the package can be copied into its
// own repository unchanged. Generic: the same file is used by every package.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defaults, loadSettings } from "../core/settings.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === "node_modules" || n.startsWith(".")) return [];
    if (statSync(p).isDirectory()) return tsFiles(p);
    return n.endsWith(".ts") ? [p] : [];
  });
}

const importRe =
  /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm;

function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(importRe)].map((m) => m[1] ?? m[2] ?? m[3]);
}

test("every import stays inside the package, node:* or pi's peer packages", () => {
  const bad: string[] = [];
  for (const f of tsFiles(root)) {
    for (const s of importsOf(f)) {
      const ok =
        s.startsWith("node:") ||
        s.startsWith("@earendil-works/") ||
        ((s.startsWith("./") || s.startsWith("../")) &&
          (resolve(dirname(f), s) + sep).startsWith(root + sep));
      if (!ok) bad.push(`${relative(root, f)}: ${s}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("no machine-specific absolute paths in non-test sources", () => {
  // Built from parts so this file does not match itself.
  const forbidden = new RegExp(["/ho" + "me/", "/ni" + "x/store/", "~/" + "\\.pi"].join("|"));
  const hits = tsFiles(root)
    .filter((f) => !relative(root, f).startsWith("test" + sep))
    .filter((f) => forbidden.test(readFileSync(f, "utf8")))
    .map((f) => relative(root, f));
  assert.deepEqual(hits, []);
});

test("runs without a settings file: loadSettings(missing) = defaults()", () => {
  assert.deepEqual(loadSettings(join(root, "does-not-exist", "settings.json")), defaults());
});
