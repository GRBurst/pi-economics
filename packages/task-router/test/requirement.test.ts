import { test } from "node:test";
import assert from "node:assert/strict";
import { T0_KEYS } from "../core/card.ts";
import { profileFor } from "../core/profile.ts";
import { requirementLabel, requirementOf } from "../core/requirement.ts";
import { BUILTIN_PROFILES, defaults, parseSettings } from "../core/settings.ts";
import type { Card, Profile, T0, T2 } from "../core/types.ts";
import type { Verified } from "../core/verify.ts";

// Under the defaults (haiku blank): write levels 0 (qwen) 1 (T1) 2 (T2); read levels 0 (qwen) 2 (T1) 3 (T2).
const S = defaults();
const ALL: T0 = { bounded: true, specified: true, verifiable: true, lowRisk: true, small: true, linear: true };
const card = (o: Partial<Card> = {}): Card => ({ kind: "implement", files: [], acceptance: [], t0: { ...ALL }, t2: [], ...o });
const ver = (t0: Partial<T0> = {}, forceT2 = false): Verified => ({ t0: { ...ALL, ...t0 }, forceT2, reasons: [] });
const P = (o: Partial<Profile> = {}): Profile => ({ tools: "all", skills: [], report: "default", ...o });
const prof = (k: string, s = S): Profile => { const r = profileFor(k, s); if (!r.ok) throw new Error(r.errors.join()); return r.value; };
const req = (c: Card, v: Verified, p = prof(c.kind)) => requirementOf(c, v, p, S);
const lv = (r: ReturnType<typeof requirementOf>) => [r.level, r.draft, r.pinned];

test("write rule: all six → 0; one soft miss → 0 draft; bounded + small → 1; one hard miss → 1; t2 / forceT2 → top", () => {
  assert.deepEqual(lv(req(card(), ver())), [0, false, false]);
  assert.deepEqual(req(card(), ver()).reasons, ["all t0 criteria hold"]);
  for (const k of ["bounded", "small"] as const) {
    const r = req(card(), ver({ [k]: false }));
    assert.deepEqual(lv(r), [0, true, false]);
    assert.deepEqual(r.reasons, [`soft miss: ${k}`]);
  }
  assert.deepEqual(lv(req(card(), ver({ bounded: false, small: false }))), [1, false, false]);
  for (const k of ["specified", "verifiable", "lowRisk", "linear"] as const) {
    const r = req(card(), ver({ [k]: false }));
    assert.deepEqual(lv(r), [1, false, false]);
    assert.deepEqual(r.reasons, [`t0 misses: ${k}`]);
  }
  const t2 = req(card({ t2: ["security", "concurrency"] }), ver());
  assert.deepEqual(lv(t2), [2, false, false]);
  assert.deepEqual(t2.reasons, ["t2: security, concurrency"]);
  const f = req(card(), ver({}, true));
  assert.deepEqual(lv(f), [2, false, false]);
  assert.deepEqual(f.reasons, ["forced T2 by verification"]);
  assert.equal(req(card(), ver()).ability, "write");
});

test("floor rule: a non-write ability starts at its bottom; t0 is logged, not used", () => {
  const p = P({ ability: "read" });
  const none = Object.fromEntries(T0_KEYS.map((k) => [k, false])) as T0;
  for (const t0 of [ALL, none]) {
    const r = requirementOf(card({ kind: "x" }), ver(t0), p, S);
    assert.deepEqual([r.ability, ...lv(r)], ["read", 0, false, false]);
  }
  assert.deepEqual(requirementOf(card({ kind: "x" }), ver(none), p, S).reasons, [`t0 misses: ${T0_KEYS.join(", ")}`]);
  assert.deepEqual(lv(requirementOf(card({ kind: "x", t2: ["security"] }), ver(), p, S)), [3, false, false]);
});

test("minLevel raises the level and clears a draft", () => {
  const r = requirementOf(card(), ver({ bounded: false }), P({ minLevel: 1 }), S);
  assert.deepEqual(lv(r), [1, false, false]);
  assert.deepEqual(r.reasons, ["soft miss: bounded", "minLevel=1 raises write 0 draft"]);
  const scout = req(card({ kind: "scout" }), ver());
  assert.deepEqual([scout.ability, ...lv(scout)], ["read", 2, false, false]);
  assert.deepEqual(scout.reasons, ["all t0 criteria hold", "minLevel=2 raises read 0"]);
  assert.deepEqual(lv(requirementOf(card(), ver({}, true), P({ minLevel: 1 }), S)), [2, false, false]); // a floor never lowers
});

test("pins ignore t2 and minLevel; a scout override level 0 stays 0 (mi1)", () => {
  const r = requirementOf(card({ kind: "p", t2: ["security"] }), ver({}, true), P({ level: 0, minLevel: 2, ability: "read" }), S);
  assert.deepEqual([r.ability, ...lv(r)], ["read", 0, false, true]);
  assert.deepEqual(r.reasons, ["profile=p"]);
  const s = parseSettings({ profiles: { scout: { level: 0 } } }).settings;
  const sc = requirementOf(card({ kind: "scout", t2: ["security"] }), ver(), prof("scout", s), s);
  assert.deepEqual([sc.ability, ...lv(sc)], ["read", 0, false, true]);
});

test('level "top" = top(a); plan is pinned by its profile, not by its kind name (D10)', () => {
  assert.deepEqual(lv(req(card({ kind: "plan" }), ver())), [2, false, true]);
  assert.deepEqual(lv(requirementOf(card({ kind: "x" }), ver(), P({ level: "top", ability: "read" }), S)), [3, false, true]);
  const s1 = parseSettings({ profiles: { plan: { level: 1 } } }).settings;
  assert.deepEqual(lv(requirementOf(card({ kind: "plan" }), ver(), prof("plan", s1), s1)), [1, false, true]);
  const s2 = parseSettings({ profiles: { big: { level: "top" } } }).settings;
  const big = requirementOf(card({ kind: "big" }), ver(), prof("big", s2), s2);
  assert.deepEqual(lv(big), lv(req(card({ kind: "plan" }), ver())));
});

test("requirementLabel: the first member meeting the level, -draft suffixed (today defaults)", () => {
  const r = (ability: string, level: number, draft = false) => ({ ability, level, draft, pinned: false, reasons: [] });
  assert.equal(requirementLabel(S, r("write", 0)), "qwen");
  assert.equal(requirementLabel(S, r("write", 0, true)), "qwen-draft");
  assert.equal(requirementLabel(S, r("write", 1)), "T1");
  assert.equal(requirementLabel(S, r("write", 2)), "T2");
  assert.equal(requirementLabel(S, r("read", 2)), "T1");
  assert.equal(requirementLabel(S, r("read", 3)), "T2");
});

test("P-floor: unpinned level ≥ minLevel, pinned level = pin, over all profiles × 64 t0 × t2", () => {
  const custom: Record<string, Profile> = {
    f1: P({ minLevel: 1 }), f2: P({ minLevel: 2 }), r3: P({ ability: "read", minLevel: 3 }),
    p0: P({ level: 0, minLevel: 2 }), p1: P({ level: 1 }), pt: P({ level: "top", ability: "read", minLevel: 0 }),
  };
  const profiles: [string, Profile][] = [...Object.keys(BUILTIN_PROFILES).map((k) => [k, prof(k)] as [string, Profile]), ...Object.entries(custom)];
  const t2s: T2[][] = [[], ["security"]];
  let n = 0;
  for (const [kind, p] of profiles) for (let bits = 0; bits < 64; bits++) for (const t2 of t2s) for (const force of [false, true]) {
    const t0 = Object.fromEntries(T0_KEYS.map((k, i) => [k, Boolean(bits & (1 << i))])) as T0;
    const r = requirementOf(card({ kind, t2 }), ver(t0, force), p, S);
    const a = p.ability ?? "write";
    const pin = p.level === "top" ? (a === "write" ? 2 : 3) : p.level;
    if (pin !== undefined) assert.ok(r.pinned && r.level === pin && !r.draft, `${kind} ${bits} ${t2} ${force}`);
    else assert.ok(!r.pinned && r.level >= (p.minLevel ?? 0) && !(r.draft && r.level !== 0), `${kind} ${bits} ${t2} ${force}`);
    n++;
  }
  assert.equal(n, profiles.length * 64 * 4);
});
