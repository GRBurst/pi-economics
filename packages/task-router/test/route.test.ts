import { test } from "node:test";
import assert from "node:assert/strict";
import { TODAY, acceptExplicit, baseRoute, planFor, profileOf, tierRank } from "./tier-plan.ts";
import { effortRank } from "../core/members.ts";
import { profileFor } from "../core/profile.ts";
import { T0_KEYS } from "../core/card.ts";
import type { Base, TierLeg as Leg, TierPlan as Plan } from "./tier-plan.ts";
import type { Card, Importance, Profile, T0, T2, ThinkingLevel } from "../core/types.ts";
import type { Verified } from "../core/verify.ts";

const S = TODAY;
const scout = (): Profile => { const r = profileFor("scout", S); assert.ok(r.ok); return r.value; };
const ALL: T0 = { bounded: true, specified: true, verifiable: true, lowRisk: true, small: true, linear: true };
const prof = (k: string): Profile => {
  const r = profileFor(k, S);
  if (!r.ok) throw new Error(r.errors.join());
  return r.value;
};
const card = (o: Partial<Card> = {}): Card => ({ kind: "implement", files: [], acceptance: [], t0: { ...ALL }, t2: [], ...o });
const ver = (t0: Partial<T0> = {}, forceT2 = false): Verified => ({ t0: { ...ALL, ...t0 }, forceT2, reasons: [] });
const route = (c: Card, v: Verified, p = prof(c.kind)) => baseRoute(c, v, p);
const IMPS: Importance[] = ["normal", "high", "critical"];
const BASES: Base[] = ["qwen", "qwen-draft", "T1", "T2"];
const EFFORTS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const leg = (tier: Leg["tier"], effort: ThinkingLevel): Leg => ({ tier, effort });

// --- baseRoute -------------------------------------------------------------

test("all six true → qwen; implement profile, no reasons of failure", () => {
  assert.equal(route(card(), ver()).base, "qwen");
});

test("exactly one soft miss (bounded or small) → qwen-draft", () => {
  assert.equal(route(card(), ver({ bounded: false })).base, "qwen-draft");
  assert.equal(route(card(), ver({ small: false })).base, "qwen-draft");
});

test("two misses, or any hard miss → T1", () => {
  assert.equal(route(card(), ver({ bounded: false, small: false })).base, "T1");
  for (const k of ["specified", "verifiable", "lowRisk", "linear"] as const) assert.equal(route(card(), ver({ [k]: false })).base, "T1", k);
  assert.equal(route(card(), ver({ small: false, linear: false })).base, "T1");
});

test("t2 trigger or forceT2 → T2, with a reason", () => {
  const a = route(card({ t2: ["security"] }), ver());
  assert.equal(a.base, "T2");
  assert.ok(a.reasons.some((r) => r.includes("security")));
  const b = route(card(), ver({}, true));
  assert.equal(b.base, "T2");
  assert.ok(b.reasons.some((r) => /force/i.test(r)));
});

test("profile tier pins the route (reason profile=<kind>) whatever the flags say", () => {
  const pinned: Profile = profileOf("scout", { scout: { tier: "qwen", tools: "read-only", skills: [], report: "answer" } });
  const r = route(card({ kind: "scout", t2: ["security"] }), ver({ linear: false }, true), pinned);
  assert.equal(r.base, "qwen");
  assert.ok(r.reasons.includes("profile=scout"));
  assert.equal(route(card({ kind: "plan" }), ver()).base, "T2");
  assert.ok(route(card({ kind: "plan" }), ver()).reasons.includes("profile=plan"));
});

test("profile minTier raises, never lowers", () => {
  assert.equal(route(card({ kind: "debug-design" }), ver()).base, "T1");
  assert.equal(route(card({ kind: "review" }), ver({ bounded: false })).base, "T1");
  assert.equal(route(card({ kind: "debug-design", t2: ["repo-wide"] }), ver()).base, "T2");
  const t2min: Profile = profileOf("implement", { implement: { minTier: "T2", tools: "all", skills: [], report: "default" } });
  assert.equal(route(card(), ver(), t2min).base, "T2");
  const r = route(card({ kind: "review" }), ver());
  assert.ok(r.reasons.some((x) => x.includes("minLevel"))); // T2.10a: the floor's reason names minLevel (requirementOf)
});

// --- planFor: spec §5.2.5 table -------------------------------------------------

const ROWS: [Base, Importance, Leg, Leg?][] = [
  ["qwen", "normal", leg("qwen", "xhigh")],
  ["qwen", "high", leg("qwen", "xhigh"), leg("T1", "high")],
  ["qwen", "critical", leg("T1", "high"), leg("T2", "high")],
  ["qwen-draft", "normal", leg("qwen", "xhigh"), leg("T1", "high")],
  ["qwen-draft", "high", leg("qwen", "xhigh"), leg("T1", "high")],
  ["qwen-draft", "critical", leg("T1", "high"), leg("T2", "high")],
  ["T1", "normal", leg("T1", "high")],
  ["T1", "high", leg("T1", "xhigh")],
  ["T1", "critical", leg("T2", "xhigh")],
  ["T2", "normal", leg("T2", "high")],
  ["T2", "high", leg("T2", "xhigh")],
  ["T2", "critical", leg("T2", "xhigh"), leg("T2", "xhigh")],
];

test("planFor table rows (spec §5.2.5)", () => {
  for (const [base, i, worker, review] of ROWS) {
    const p = planFor(base, i, "implement");
    assert.deepEqual(p.worker, worker, `${base}/${i} worker`);
    assert.deepEqual(p.review, review, `${base}/${i} review`);
    assert.equal(p.base, base);
    assert.equal(p.importance, i);
    assert.ok(p.reasons.length > 0);
  }
});

test("scouts never run on qwen by default (pilot: Qwen scouts partial; unsure → higher tier)", () => {
  const verdicts = [ver(), ver({ small: false }), ver({ linear: false, specified: false }), ver({}, true)];
  for (const v of verdicts) for (const i of IMPS) {
    const { base } = route(card({ kind: "scout" }), v, scout());
    assert.notEqual(planFor(base, i, "scout", scout()).worker.tier, "qwen", `${base}/${i}`); // P-scout
  }
});

test("scout behaviour comes from the profile only: settings profiles.scout.tier=T1 routes scouts to T1", () => {
  const prof = { ok: true, value: profileOf("scout", { scout: { tier: "T1" } }) };
  for (const i of IMPS) assert.equal(planFor("T1", i, "scout", prof.value).worker.tier, "T1", i);
  assert.equal(planFor("qwen", "normal", "scout", prof.value).worker.tier, "T1");
});

test("plan kind is always T2, effort ≥ high; critical adds the fresh review", () => {
  for (const b of BASES) for (const i of IMPS) {
    const p = planFor(b, i, "plan"); // P-plan
    assert.equal(p.worker.tier, "T2", `${b}/${i}`);
    assert.ok(effortRank(p.worker.effort) >= effortRank("high"));
  }
  assert.deepEqual(planFor("qwen", "critical", "plan").review, leg("T2", "xhigh"));
});

test("pinned profile tier is kept under importance raises (P-profile)", () => {
  const t1: Profile = profileOf("spike", { spike: { tier: "T1", tools: "all", skills: [], report: "default" } });
  for (const i of IMPS) assert.equal(planFor("T1", i, "spike", t1).worker.tier, "T1", i);
  assert.deepEqual(planFor("T1", "critical", "spike", t1).review, leg("T2", "high"));
  const q: Profile = profileOf("x", { x: { tier: "qwen", tools: "all", skills: [], report: "default" } });
  for (const i of IMPS) assert.equal(planFor("qwen", i, "x", q).worker.tier, "qwen", i);
});

// --- properties --------------------------------------------------------------------

const subsets = <T,>(xs: T[]): T[][] => xs.reduce<T[][]>((acc, x) => acc.flatMap((s) => [s, [...s, x]]), [[]]);
const wRank = (p: Plan) => tierRank(p.worker.tier);

function planOf(c: Card, v: Verified, i: Importance, p = prof(c.kind)): Plan {
  return planFor(baseRoute(c, v, p).base, i, c.kind, p);
}

test("P-mono: adding one t2 trigger or lowering one t0 flag never lowers the worker tier", () => {
  const T2S: T2[] = ["security", "repo-wide"];
  for (const kind of ["implement", "mechanical", "debug-design", "review"]) {
    for (const flags of subsets(T0_KEYS)) {
      const t0 = Object.fromEntries(T0_KEYS.map((k) => [k, !flags.includes(k)])) as T0;
      for (const t2 of subsets(T2S)) for (const i of IMPS) {
        const c = card({ kind, t0, t2 });
        const w = wRank(planOf(c, ver(t0), i));
        if (t2.length) assert.equal(planOf(c, ver(t0), i).worker.tier, "T2", `${kind} t2 ${i}`);
        for (const k of T0_KEYS.filter((k) => t0[k])) {
          const t0b = { ...t0, [k]: false };
          assert.ok(wRank(planOf(card({ kind, t0: t0b, t2 }), ver(t0b), i)) >= w, `${kind} ${k} ${i}`);
        }
        for (const x of T2S.filter((x) => !t2.includes(x))) {
          assert.ok(wRank(planOf(card({ kind, t0, t2: [...t2, x] }), ver(t0), i)) >= w, `${kind} +${x} ${i}`);
        }
      }
    }
  }
});

test("P-imp: higher importance never lowers the worker, never drops a review", () => {
  for (const kind of ["implement", "scout", "plan", "debug-design"]) for (const b of BASES) {
    for (let a = 0; a < IMPS.length; a++) for (let z = a; z < IMPS.length; z++) {
      const lo = planFor(b, IMPS[a], kind), hi = planFor(b, IMPS[z], kind);
      assert.ok(tierRank(lo.worker.tier) <= tierRank(hi.worker.tier), `${kind} ${b} ${IMPS[a]}<=${IMPS[z]}`);
      if (lo.review) assert.ok(hi.review, `${kind} ${b} ${IMPS[a]}<=${IMPS[z]} review`);
    }
  }
});

test("P-nomax: no leg is ever max", () => {
  for (const kind of ["implement", "scout", "plan"]) for (const b of BASES) for (const i of IMPS) {
    const p = planFor(b, i, kind);
    assert.notEqual(p.worker.effort, "max");
    assert.notEqual(p.review?.effort, "max");
  }
});

test("P-profile: minTier floors the worker tier", () => {
  for (const kind of ["debug-design", "review"]) for (const flags of subsets(T0_KEYS)) for (const i of IMPS) {
    const t0 = Object.fromEntries(T0_KEYS.map((k) => [k, !flags.includes(k)])) as T0;
    assert.ok(wRank(planOf(card({ kind, t0 }), ver(t0), i)) >= tierRank("T1"), `${kind} ${flags} ${i}`);
  }
});

// --- acceptExplicit ----------------------------------------------------------------

const MODEL = { qwen: S.models["qwen-local"].model, qwenCloud: S.models["qwen-cloud"].model, T1: S.models.sonnet.model, T2: S.models.opus.model };
const planW = (w: Leg): Plan => ({ worker: w, base: "T1", importance: "normal", reasons: [] });

test("P-explicit: accepted ⇔ rank(m) ≥ rank(W) ∧ (rank(m) > rank(W) ∨ erank(e) ≥ erank(W.effort))", () => {
  const ws = [leg("qwen", "xhigh"), leg("T1", "high"), leg("T1", "xhigh"), leg("T2", "high"), leg("T2", "xhigh")];
  const ms: (string | undefined)[] = [undefined, ...Object.values(MODEL)];
  const tierOf = (m: string) => (m === MODEL.T2 ? "T2" : m === MODEL.T1 ? "T1" : "qwen");
  for (const w of ws) for (const m of ms) for (const e of [undefined, ...EFFORTS]) {
    const mr = m ? tierRank(tierOf(m)) : tierRank(w.tier);
    const want = e !== "max" && mr >= tierRank(w.tier) && (mr > tierRank(w.tier) || e === undefined || effortRank(e) >= effortRank(w.effort));
    const got = acceptExplicit(planW(w), m, e, S);
    assert.equal(got.ok, want, `W=${w.tier}/${w.effort} m=${m} e=${e}`);
    if (got.ok) {
      assert.equal(got.value.tier, m ? tierOf(m) : w.tier);
      assert.equal(got.value.effort, e ?? w.effort);
      assert.notEqual(got.value.effort, "max");
    }
  }
});

test("acceptExplicit: rejections carry the reason; unknown model rejected", () => {
  const low = acceptExplicit(planW(leg("T1", "high")), MODEL.qwen, "xhigh", S);
  assert.ok(!low.ok && /below|lower/i.test(low.errors.join()) && low.errors.join().includes("T1"));
  const eff = acceptExplicit(planW(leg("T1", "high")), MODEL.T1, "medium", S);
  assert.ok(!eff.ok && /effort/i.test(eff.errors.join()));
  const unk = acceptExplicit(planW(leg("T1", "high")), "openai/gpt-9", undefined, S);
  assert.ok(!unk.ok && unk.errors.join().includes("openai/gpt-9"));
  const none = acceptExplicit(planW(leg("T1", "high")), undefined, undefined, S);
  assert.deepEqual(none, { ok: true, value: leg("T1", "high") });
});

test("acceptExplicit: the unknown-model message lists the enabled members' models in selection order, blank ones left out (M1: cloud before local)", () => {
  const msg = (s = S) => { const r = acceptExplicit(planW(leg("T1", "high")), "openai/gpt-9", undefined, s); return r.ok ? "" : r.errors.join(); };
  assert.equal(msg(), "model openai/gpt-9 is not in the routing table (openrouter/qwen/qwen3.8-27b:free, llama/qwen3.8, anthropic/claude-sonnet-5-5, anthropic/claude-opus-5-5)");
  const blanked = { ...S, models: { ...S.models, "qwen-cloud": { ...S.models["qwen-cloud"], model: "" } } };
  assert.equal(msg(blanked), "model openai/gpt-9 is not in the routing table (llama/qwen3.8, anthropic/claude-sonnet-5-5, anthropic/claude-opus-5-5)");
});
