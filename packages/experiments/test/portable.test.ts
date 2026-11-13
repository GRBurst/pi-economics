// Portability contract: the package can be copied into its
// own repository and run unchanged. Generic: the same file is used by every package,
// but for one allowance in this (experiments') copy, TYPE_IMPORTS (redesign plan P22):
// core/settings.ts imports the types Billing and Plans from token-meter's core/plans.ts,
// their one definition. `import type` is erased at runtime, so experiments still runs
// alone; a copy type-checks only with that file beside it.
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

// The declaration that ends a match (a match may start at "import" in a comment above it).
const typeDecl = /(?:^|[\s;])(?:import|export)\s+type\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s*['"][^'"]+['"]$/;
/** The files outside the package that may be imported, and only by `import type` / `export type`. */
const TYPE_IMPORTS = [resolve(root, "..", "token-meter", "core", "plans.ts")];

function importsOf(file: string): { spec: string; typeOnly: boolean }[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(importRe)].map((m) => ({ spec: m[1] ?? m[2] ?? m[3], typeOnly: m[1] !== undefined && typeDecl.test(m[0]) }));
}

test("every import stays inside the package, node:* or pi's peer packages; only TYPE_IMPORTS leave it, as types", () => {
  const bad: string[] = [];
  for (const f of tsFiles(root)) {
    for (const { spec: s, typeOnly } of importsOf(f)) {
      const relativeSpec = s.startsWith("./") || s.startsWith("../");
      const ok =
        s.startsWith("node:") ||
        s.startsWith("@earendil-works/") ||
        (relativeSpec &&
          ((resolve(dirname(f), s) + sep).startsWith(root + sep) || (typeOnly && TYPE_IMPORTS.includes(resolve(dirname(f), s)))));
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
