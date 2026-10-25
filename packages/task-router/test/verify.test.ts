import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyT0, type FsPort } from "../core/verify.ts";
import { globMatch } from "../core/glob.ts";
import { T0_KEYS, T2_VALUES } from "../core/card.ts";
import { defaults } from "../core/settings.ts";
import type { Card } from "../core/types.ts";

const t0 = { bounded: true, specified: true, verifiable: true, lowRisk: true, small: true, linear: true };
const card = (o: Partial<Card> = {}): Card => ({
  kind: "implement", files: ["src/a.ts"], check: "npm test", acceptance: ["works"], t0: { ...t0 }, t2: [], ...o,
});
const memfs = (files: Record<string, number>): FsPort => ({
  exists: (p) => p in files,
  size: (p) => files[p] ?? 0,
  isDir: (p) => Object.keys(files).some((f) => f.startsWith(p.replace(/\/$/, "") + "/")),
});
const S = defaults();
const CWD = "/w";
const FS = memfs({ "/w/src/a.ts": 1000, "/w/src/b.ts": 1000, "/w/src/c.ts": 1000, "/w/src/d.ts": 1000 });

test("honest card passes unchanged", () => {
  assert.deepEqual(verifyT0(card(), CWD, FS, S), { t0, forceT2: false, reasons: [] });
});

test("files resolve against cwd; absolute paths stay", () => {
  const fs = memfs({ "/w/src/a.ts": 1, "/abs/x.ts": 1 });
  assert.equal(verifyT0(card({ files: ["src/a.ts", "/abs/x.ts"] }), CWD, fs, S).t0.bounded, true);
});

test("file in a missing directory → bounded=false, reason names it", () => {
  const v = verifyT0(card({ files: ["src/a.ts", "gone/nope.ts"] }), CWD, FS, S);
  assert.equal(v.t0.bounded, false);
  assert.ok(v.reasons.some((r) => r.includes("gone/nope.ts")));
  assert.equal(v.forceT2, false);
});

test("new file in an existing directory counts as 0 bytes: bounded stays true, no reason", () => {
  const v = verifyT0(card({ files: ["src/a.ts", "src/new.ts"] }), CWD, FS, S);
  assert.equal(v.t0.bounded, true);
  assert.deepEqual(v.reasons, []);
});

test("new file whose parent directory is missing → bounded=false, reason names it", () => {
  const v = verifyT0(card({ files: ["src/a.ts", "nodir/new.ts"] }), CWD, FS, S);
  assert.equal(v.t0.bounded, false);
  assert.ok(v.reasons.some((r) => r.includes("nodir/new.ts")));
});

test("more files than t0Limits.files → small=false (count)", () => {
  const s = { ...S, t0Limits: { files: 3, tokens: S.t0Limits.tokens } };
  const four = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"];
  const v = verifyT0(card({ files: four }), CWD, FS, s);
  assert.equal(v.t0.small, false);
  assert.ok(v.reasons.some((r) => /files/.test(r)));
  assert.equal(verifyT0(card({ files: four.slice(0, 3) }), CWD, FS, s).t0.small, true);
});

test("Σ size / 3.6 > t0Limits.tokens → small=false; exactly at the limit is fine", () => {
  const s = { ...S, t0Limits: { files: 3, tokens: 1000 } };
  const at = memfs({ "/w/src/a.ts": 3600 });
  const over = memfs({ "/w/src/a.ts": 3601 });
  assert.equal(verifyT0(card(), CWD, at, s).t0.small, true);
  const v = verifyT0(card(), CWD, over, s);
  assert.equal(v.t0.small, false);
  assert.ok(v.reasons.some((r) => /tokens/.test(r)));
});

test("verifiable needs a non-blank check; specified needs ≥ 1 acceptance", () => {
  for (const check of [undefined, "", "   "]) {
    assert.equal(verifyT0(card({ check }), CWD, FS, S).t0.verifiable, false, JSON.stringify(check));
  }
  const v = verifyT0(card({ acceptance: [] }), CWD, FS, S);
  assert.equal(v.t0.specified, false);
  assert.ok(v.reasons.some((r) => r.includes("acceptance")));
});

test("risk glob on a file → lowRisk=false, no forced T2", () => {
  const fs = memfs({ "/w/src/auth/login.ts": 1, "/w/lib/crypt.ts": 1 });
  for (const f of ["src/auth/login.ts", "lib/crypt.ts"]) {
    const v = verifyT0(card({ files: [f] }), CWD, fs, S);
    assert.equal(v.t0.lowRisk, false, f);
    assert.equal(v.forceT2, false, f);
    assert.ok(v.reasons.some((r) => r.includes(f)));
  }
});

test("risk keyword in check or acceptance → lowRisk=false", () => {
  assert.equal(verifyT0(card({ acceptance: ["rotate the password hash"] }), CWD, FS, S).t0.lowRisk, false);
  assert.equal(verifyT0(card({ check: "node migrate.js" }), CWD, FS, S).t0.lowRisk, false);
});

test("T2-category keyword → forceT2 (and not lowRisk)", () => {
  const v = verifyT0(card({ acceptance: ["fix the race condition in the scheduler"] }), CWD, FS, S);
  assert.equal(v.forceT2, true);
  assert.equal(v.t0.lowRisk, false);
  assert.ok(v.reasons.some((r) => r.includes("concurrency")));
});

test("code only lowers: a false claim stays false even with perfect evidence", () => {
  for (const k of T0_KEYS) {
    const v = verifyT0(card({ t0: { ...t0, [k]: false } }), CWD, FS, S);
    assert.equal(v.t0[k], false, k);
  }
});

// P-verify: ∀ c: eff(c).t0[k] ⇒ c.t0[k], over generated cards (seeded LCG).
test("P-verify over generated cards", () => {
  let seed = 12345;
  const rnd = (n: number) => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % n);
  const pool = ["src/a.ts", "src/b.ts", "src/gone.ts", "src/auth/x.ts", "lib/crypt.ts"];
  const words = ["works", "password", "race condition", "ok", "migrate"];
  for (let i = 0; i < 500; i++) {
    const c = card({
      files: pool.filter(() => rnd(2) === 0),
      check: rnd(2) ? "npm test" : undefined,
      acceptance: words.filter(() => rnd(3) === 0),
      t0: Object.fromEntries(T0_KEYS.map((k) => [k, rnd(2) === 0])) as Card["t0"],
    });
    const fs = memfs({ "/w/src/a.ts": rnd(5000), "/w/src/b.ts": rnd(5000), "/w/src/auth/x.ts": 1, "/w/lib/crypt.ts": 1 });
    const v = verifyT0(c, CWD, fs, S);
    for (const k of T0_KEYS) assert.ok(!v.t0[k] || c.t0[k], `${k} raised: ${JSON.stringify(c)}`);
  }
});

test("globMatch: ** spans dirs, * stays in a segment, leading **/ is optional", () => {
  assert.ok(globMatch("**/auth/**", "auth/x.ts"));
  assert.ok(globMatch("**/auth/**", "a/b/auth/c/d.ts"));
  assert.ok(!globMatch("**/auth/**", "a/author/x.ts"));
  assert.ok(globMatch("**/*crypt*", "crypt.ts"));
  assert.ok(globMatch("**/*crypt*", "src/encrypted.ts"));
  assert.ok(globMatch("src/*.ts", "src/a.ts"));
  assert.ok(!globMatch("src/*.ts", "src/x/a.ts"));
  assert.ok(globMatch("a.b", "a.b") && !globMatch("a.b", "axb"));
});
