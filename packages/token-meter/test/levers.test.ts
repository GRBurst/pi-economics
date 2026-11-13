import { test } from "node:test";
import assert from "node:assert/strict";
import { leverViolations, leversLine, serializeLevers } from "../core/levers.ts";
import type { LeverState } from "../core/levers.ts";

// Design §5.3: the invariants of a lever state, as the spec states them (the oracle of the property below).
const SOURCES = ["pe", "ext", "fixed"] as const;
const READBACKS = [undefined, "confirmed", "refused", "unverified"] as const;
const TIERS = [undefined, "seed", "control", "replace", "shadow"] as const;
const VALUES: Array<string | number | boolean> = ["medium", "high", 0, 16384, true, false];

function specValid(x: LeverState): boolean {
  const has = x.a !== undefined;
  return has === (x.rb !== undefined)
    && (x.s !== "pe" || (has && (x.rb === "confirmed" || x.rb === "unverified")))
    && (x.rb !== "confirmed" || x.v === x.a)
    && (x.rb !== "refused" || ((x.s === "ext" || x.s === "fixed") && x.v !== x.a))
    && (x.rb !== "unverified" || x.v === x.a);
}

function* states(): Generator<LeverState> {
  for (const s of SOURCES)
    for (const rb of READBACKS)
      for (const tier of TIERS)
        for (const v of VALUES)
          for (const a of [undefined, ...VALUES]) {
            const st: LeverState = { v, s };
            if (a !== undefined) st.a = a;
            if (rb !== undefined) st.rb = rb;
            if (tier !== undefined) st.tier = tier;
            yield st;
          }
}

test("leverViolations: [] exactly for the states the §5.3 invariants allow (every source × rb × tier × v × a)", () => {
  let ok = 0, bad = 0;
  for (const st of states()) {
    const v = leverViolations(st);
    assert.equal(v.length === 0, specValid(st), JSON.stringify(st) + " → " + JSON.stringify(v));
    if (v.length === 0) ok++; else bad++;
  }
  // both sides are populated: the generator reaches every rule
  assert.ok(ok > 100 && bad > 1000, `${ok} valid, ${bad} invalid`);
});

test("leverViolations names each broken rule", () => {
  const cases: Array<[LeverState, RegExp]> = [
    [{ v: 1, s: "fixed", rb: "confirmed" }, /read-back without an assigned value/],
    [{ v: 1, s: "fixed", a: 1 }, /assigned value without read-back/],
    [{ v: 1, s: "pe" }, /source pe without an assigned value/],
    [{ v: 2, s: "pe", a: 1, rb: "refused" }, /source pe/],
    [{ v: 2, s: "fixed", a: 1, rb: "confirmed" }, /confirmed but v ≠ a/],
    [{ v: 1, s: "ext", a: 1, rb: "refused" }, /refused but v = a/],
    [{ v: 2, s: "ext", a: 1, rb: "unverified" }, /unverified but v ≠ a/],
  ];
  for (const [st, re] of cases) assert.match(leverViolations(st).join("; "), re, JSON.stringify(st));
});

test("leverViolations: no text values — v and a are level names, finite numbers or booleans", () => {
  for (const v of ["medium", "xhigh", "streaming", "short", "auto", 0, 1.5, 16384, true, false])
    assert.deepEqual(leverViolations({ v, s: "fixed" }), [], String(v));
  for (const v of ["", "two words", "/home/u/x", "Medium!", "x".repeat(40), NaN, Infinity, null, {}, []]) {
    assert.match(leverViolations({ v, s: "fixed" } as unknown as LeverState).join(";"), /v is not a level name, number or boolean/, String(v));
    assert.match(leverViolations({ v: 1, s: "ext", a: v, rb: "refused" } as unknown as LeverState).join(";"),
      /a is not a level name, number or boolean/, String(v));
  }
  assert.match(leverViolations({ v: 1, s: "nope" } as unknown as LeverState).join(";"), /source/);
  assert.match(leverViolations({ v: 1, s: "fixed", tier: "x" } as unknown as LeverState).join(";"), /tier/);
});

const BASE = { ts: "2026-10-02T12:00:00.000Z", sessionId: "s1", eligible: false };

test("leversLine: accepts exactly the states leverViolations accepts, naming the lever in the error", () => {
  for (const st of states()) {
    const bad = leverViolations(st).length > 0;
    let threw: unknown;
    try {
      const l = leversLine({ ...BASE, levers: { "pi.x": st } });
      assert.deepEqual(l, { v: 2, kind: "levers", ...BASE, levers: { "pi.x": st } });
    } catch (e) { threw = e; }
    assert.equal(threw !== undefined, bad, JSON.stringify(st));
    if (bad) assert.match(String(threw), /^Error: levers: pi\.x: /);
  }
});

test("leversLine: optional keys only when given; serializeLevers is one JSON line", () => {
  const l = leversLine({ ...BASE, parentSessionId: "p", arm: "B", design: "d1", stratum: "s", eligible: true, levers: {} });
  assert.deepEqual(Object.keys(l), ["v", "ts", "sessionId", "parentSessionId", "kind", "arm", "design", "eligible", "stratum", "levers"]);
  const plain = leversLine({ ...BASE, parentSessionId: undefined, arm: undefined, levers: {} });
  assert.deepEqual(Object.keys(plain), ["v", "ts", "sessionId", "kind", "eligible", "levers"]);
  const text = serializeLevers(l);
  assert.ok(text.endsWith("}\n") && !text.slice(0, -1).includes("\n"));
  assert.deepEqual(JSON.parse(text), l);
});

test("leversLine: a line over 4096 bytes is refused, never truncated", () => {
  const levers: Record<string, LeverState> = {};
  for (let i = 0; i < 200; i++) levers[`pi.lever${i}`] = { v: 16384, s: "fixed" };
  assert.throws(() => leversLine({ ...BASE, levers }), /^Error: levers: line of \d+ bytes exceeds 4096/);
});

test("T5b2.6 a level name may start with a digit: the experiment levels 5m and 1h (cache-lifecycle.mainCacheTtl) are values", () => {
  for (const v of ["5m", "1h", "2x"]) assert.deepEqual(leverViolations({ v, s: "pe", a: v, rb: "confirmed", tier: "replace" }), [], v);
  for (const v of ["-x", "_x", "5 m"]) assert.match(leverViolations({ v, s: "fixed" } as LeverState).join(";"), /v is not a level name/, v);
});
