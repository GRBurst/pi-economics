// The add-on framework (redesign §7.4, M5b.2): read-back, the registry, the cache-lifecycle add-ons.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRegistry, readBack, sessionLevers } from "../addons/registry.ts";
import type { Lever, LeverState, Observed } from "../addons/types.ts";
import type { Level } from "../core/design.ts";
import { V4_FACTORS } from "../core/settings.ts";
import { CACHE_LIFECYCLE } from "../addons/cache-lifecycle.ts";

/**
 * The §5.3 invariants of a lever state, as token-meter's leverViolations (core/levers.ts, their one definition: its
 * writer refuses a line that breaks one) states them; a copy here because a package test reads only its own package.
 */
function violations(x: LeverState): string[] {
  const out: string[] = [];
  const has = x.a !== undefined;
  const value = (v: unknown) => typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(v));
  if (!["pe", "ext", "fixed"].includes(x.s)) out.push("source");
  if (!value(x.v)) out.push("v");
  if (has && !value(x.a)) out.push("a");
  if (has !== (x.rb !== undefined)) out.push("a ⇔ rb");
  if (x.s === "pe" && !(has && (x.rb === "confirmed" || x.rb === "unverified"))) out.push("pe needs a and rb confirmed|unverified");
  if (x.rb === "confirmed" && x.v !== x.a) out.push("confirmed ⇒ v = a");
  if (x.rb === "refused" && (x.v === x.a || x.s === "pe")) out.push("refused ⇒ v ≠ a, s ∈ {ext, fixed}");
  if (x.rb === "unverified" && x.v !== x.a) out.push("unverified ⇒ v = a");
  return out;
}

const LEVELS: Level[] = ["off", "on", "5m", 1, true];
const FEASIBLE: Array<readonly Level[] | undefined> = [undefined, [], ...LEVELS.map((l) => [l]), ["off", "on"]];
const OBSERVED: Array<Observed<Level> | "no-observer"> = [
  "no-observer", undefined,
  ...LEVELS.flatMap((v) => (["pe", "ext", "fixed"] as const).map((s) => ({ v, s }))),
];

test("T5b2.1 property: ∀ (a, feasible, observed) the read-back state, when recorded, keeps every §5.3 invariant", () => {
  let recorded = 0;
  for (const a of [undefined, ...LEVELS]) {
    for (const feasible of FEASIBLE) {
      for (const obs of OBSERVED) {
        const st = readBack(a, feasible, obs);
        if (st === undefined) continue;
        recorded++;
        assert.deepEqual(violations(st), [], `readBack(${JSON.stringify(a)}, ${JSON.stringify(feasible)}, ${JSON.stringify(obs)}) = ${JSON.stringify(st)}`);
      }
    }
  }
  assert.ok(recorded > 100);
});

test("T5b2.1 readBack: confirmed, unverified (no observer or nothing observed yet), refused with the observed source", () => {
  assert.deepEqual(readBack("1h", undefined, { v: "1h", s: "fixed" }), { v: "1h", s: "pe", a: "1h", rb: "confirmed" });
  assert.deepEqual(readBack("1h", ["5m", "1h"], "no-observer"), { v: "1h", s: "pe", a: "1h", rb: "unverified" });
  assert.deepEqual(readBack("1h", ["5m", "1h"], undefined), { v: "1h", s: "pe", a: "1h", rb: "unverified" });
  assert.deepEqual(readBack("1h", ["5m", "1h"], { v: "5m", s: "fixed" }), { v: "5m", s: "fixed", a: "1h", rb: "refused" });
  assert.deepEqual(readBack("1h", undefined, { v: "5m", s: "pe" }), { v: "5m", s: "ext", a: "1h", rb: "refused" });
});

test("T5b2.1 readBack: an infeasible level is refused up front; without a differing observation it is not recorded as assigned", () => {
  assert.deepEqual(readBack("1h", [], { v: "5m", s: "fixed" }), { v: "5m", s: "fixed", a: "1h", rb: "refused" });
  assert.deepEqual(readBack("1h", ["5m"], { v: "5m", s: "ext" }), { v: "5m", s: "ext", a: "1h", rb: "refused" });
  assert.equal(readBack("1h", [], "no-observer"), undefined);
  assert.equal(readBack("1h", [], undefined), undefined);
  assert.deepEqual(readBack("1h", [], { v: "1h", s: "fixed" }), { v: "1h", s: "fixed" });
});

test("T5b2.1 readBack: nothing assigned → the observation as the target's own (never pe), or not recorded", () => {
  assert.equal(readBack(undefined, undefined, "no-observer"), undefined);
  assert.equal(readBack(undefined, undefined, undefined), undefined);
  assert.deepEqual(readBack(undefined, undefined, { v: "5m", s: "fixed" }), { v: "5m", s: "fixed" });
  assert.deepEqual(readBack(undefined, undefined, { v: "5m", s: "pe" }), { v: "5m", s: "ext" });
});

/** A lever double: records apply calls; `seen` is what its observer reports (absent: no observer). */
function fakeLever(id: string, target: string, o: { feasible?: readonly Level[]; seen?: () => Observed; at?: "before_agent_start" | "message_end" } = {}) {
  const applied: Array<[string, Level]> = [];
  const lever: Lever = {
    id, target, scope: "session", tier: "replace", readBackAt: o.at ?? "before_agent_start",
    feasible: (_env, levels) => o.feasible ?? levels,
    apply: (ctx, level) => void applied.push([ctx.sessionId, level]),
    ...(o.seen ? { observe: () => o.seen!() } : {}),
  };
  return { lever, applied };
}
const assignedTo = (factors: Record<string, [string, Level]>) => ({
  sessionId: "s1", factors: Object.fromEntries(Object.entries(factors).map(([n, [lever, assigned]]) => [n, { lever, assigned }])),
});

test("T5b2.2 registry: a lever whose target is not loaded is inert (never applied, not recorded) until the target loads", () => {
  const x = fakeLever("x.a", "x");
  const reg = createRegistry([x.lever]);
  const s = sessionLevers(reg, assignedTo({ a: ["x.a", "on"] }), { child: false }, () => ["off", "on"]);
  assert.equal(s.refresh(), false);
  assert.deepEqual(s.states(), {});
  assert.deepEqual(x.applied, []);
  assert.equal(reg.load("x"), true);
  assert.equal(reg.load("x"), false);
  assert.equal(s.refresh(), true);
  assert.deepEqual(x.applied, [["s1", "on"]]);
  assert.deepEqual(s.states(), { "x.a": { v: "on", s: "pe", a: "on", rb: "unverified", tier: "replace" } });
  assert.equal(s.refresh(), false); // applied once
  assert.deepEqual(x.applied, [["s1", "on"]]);
});

test("T5b2.2 registry: pi is always loaded; a factor without an add-on is not recorded; an infeasible level is never applied", () => {
  const p = fakeLever("pi.b", "pi");
  const y = fakeLever("y.c", "y", { feasible: [] });
  const reg = createRegistry([p.lever, y.lever]);
  reg.load("y");
  const s = sessionLevers(reg, assignedTo({ b: ["pi.b", 1], c: ["y.c", "on"], d: ["z.d", true] }), { child: false }, (n) => ({ b: [0, 1], c: ["off", "on"], d: [false, true] })[n] ?? []);
  s.refresh();
  assert.deepEqual(p.applied, [["s1", 1]]);
  assert.deepEqual(y.applied, []);
  assert.deepEqual(s.states(), { "pi.b": { v: 1, s: "pe", a: 1, rb: "unverified", tier: "replace" } });
});

test("T5b2.2 registry: observation at the lever's readBackAt only; the last defined observation counts", () => {
  let seen: Observed = undefined;
  const m = fakeLever("x.ttl", "x", { at: "message_end", seen: () => seen });
  const reg = createRegistry([m.lever]);
  reg.load("x");
  const s = sessionLevers(reg, assignedTo({ ttl: ["x.ttl", "1h"] }), { child: false }, () => ["5m", "1h"]);
  s.refresh();
  seen = { v: "1h", s: "fixed" };
  assert.equal(s.observe("before_agent_start", { sessionId: "s1" }), false);
  assert.equal(s.states()["x.ttl"].rb, "unverified");
  assert.equal(s.observe("message_end", { sessionId: "s1" }), true);
  assert.deepEqual(s.states()["x.ttl"], { v: "1h", s: "pe", a: "1h", rb: "confirmed", tier: "replace" });
  seen = undefined;
  assert.equal(s.observe("message_end", { sessionId: "s1" }), false);
  assert.equal(s.states()["x.ttl"].rb, "confirmed");
  seen = { v: "5m", s: "fixed" };
  assert.equal(s.observe("message_end", { sessionId: "s1" }), true);
  assert.deepEqual(s.states()["x.ttl"], { v: "5m", s: "fixed", a: "1h", rb: "refused", tier: "replace" });
});

test("T5b2.6 cache-lifecycle add-ons: the three v4 levers, tier replace, target cache-lifecycle; warmPolicy and maskOnCold have no observer", () => {
  assert.deepEqual(CACHE_LIFECYCLE.map((l) => [l.id, l.target, l.tier, l.readBackAt, typeof l.observe]), [
    ["cache-lifecycle.warmPolicy", "cache-lifecycle", "replace", "before_agent_start", "undefined"],
    ["cache-lifecycle.mainCacheTtl", "cache-lifecycle", "replace", "message_end", "function"],
    ["cache-lifecycle.maskOnCold", "cache-lifecycle", "replace", "before_agent_start", "undefined"],
  ]);
  assert.deepEqual(V4_FACTORS.map((f) => f.lever), CACHE_LIFECYCLE.map((l) => l.id));
});

test("T5b2.6 mainCacheTtl reads back from the response's cacheWrite1h: confirmed only with a write that shows the TTL", () => {
  const ttl = CACHE_LIFECYCLE.find((l) => l.id === "cache-lifecycle.mainCacheTtl")!;
  const end = (usage: unknown) => ({ sessionId: "s1", event: { message: { role: "assistant", usage } } });
  const state = (a: string, usage: unknown) => readBack(a, ttl.feasible({ child: false }, ["5m", "1h"]), ttl.observe!(end(usage)));
  assert.equal(state("1h", { cacheWrite: 900, cacheWrite1h: 900 })?.rb, "confirmed");
  assert.equal(state("5m", { cacheWrite: 900, cacheWrite1h: 0 })?.rb, "confirmed");
  assert.deepEqual(state("1h", { cacheWrite: 900, cacheWrite1h: 0 }), { v: "5m", s: "fixed", a: "1h", rb: "refused" });
  assert.deepEqual(state("5m", { cacheWrite: 900, cacheWrite1h: 300 }), { v: "1h", s: "fixed", a: "5m", rb: "refused" });
  for (const before of [{ cacheWrite: 0, cacheWrite1h: 0 }, { cacheWrite: 900 }, undefined, "x"]) assert.equal(state("1h", before)?.rb, "unverified");
  assert.equal(ttl.observe!({ sessionId: "s1" }), undefined);
});

test("T5b2.6 mainCacheTtl is a main session's lever: infeasible in a child (cache-lifecycle writes 5 m there)", () => {
  const ttl = CACHE_LIFECYCLE.find((l) => l.id === "cache-lifecycle.mainCacheTtl")!;
  assert.deepEqual(ttl.feasible({ child: true }, ["5m", "1h"]), []);
  assert.deepEqual(ttl.feasible({ child: false }, ["5m", "1h"]), ["5m", "1h"]);
  const all = ["native", "orchestrator-aware", "off", "on"];
  for (const l of CACHE_LIFECYCLE.filter((l) => l !== ttl)) {
    assert.equal(l.feasible({ child: true }, all).length, 2, l.id);
    assert.deepEqual(l.feasible({ child: true }, all), l.feasible({ child: false }, all), `${l.id}: the same in a child`);
  }
});

// Review m2: a lever is feasible only at the levels its target understands (§7.4); a stratum's other levels (a typo,
// "1H") are refused up front, so no state claims them.
test("review m2: the cache-lifecycle levers are feasible only at the levels cache-lifecycle understands", () => {
  const f = (name: string, levels: string[], child = false) => CACHE_LIFECYCLE.find((l) => l.id === `cache-lifecycle.${name}`)!.feasible({ child }, levels);
  assert.deepEqual(f("warmPolicy", ["native", "orchestrator-aware", "eager"]), ["native", "orchestrator-aware"]);
  assert.deepEqual(f("mainCacheTtl", ["5m", "1H", "1h"]), ["5m", "1h"]);
  assert.deepEqual(f("mainCacheTtl", ["5m", "1h"], true), []);
  assert.deepEqual(f("maskOnCold", ["off", "on", "tools+thinking"]), ["off", "on"]);
});
