import { test } from "node:test";
import assert from "node:assert/strict";
import { effortAt, effortRank, enabled, firstMeeting } from "../core/members.ts";
import { planSpawn } from "../core/pipeline.ts";
import { profileFor } from "../core/profile.ts";
import { capToTable, planLegs } from "../core/table.ts";
import { defaults, parseSettings } from "../core/settings.ts";
import type { Card, Importance, Leg, Plan, Profile, Requirement, RouterSettings, T0 } from "../core/types.ts";

const S = defaults();
const IMPS: Importance[] = ["normal", "high", "critical"];
const P = (o: Partial<Profile> = {}): Profile => ({ tools: "all", skills: [], report: "default", ...o });
const R = (ability: string, level: number, o: Partial<Requirement> = {}): Requirement => ({ ability, level, draft: false, pinned: false, reasons: [], ...o });
/** A leg labelled like today's plan: the first member meeting the level, its effort at the step. */
const lab = (s: RouterSettings, a: string, l?: Leg) => {
  if (!l) return "";
  const m = firstMeeting(s.models, a, l.level)!;
  return `${m.tier} ${effortAt(m, l.step)}`;
};
const show = (r: ReturnType<typeof planLegs>, a: string, s = S) => [lab(s, a, r.worker), lab(s, a, r.review)];

// today's TABLE (core/plan.ts before T2.10), per write level
const TODAY: Record<number, Record<Importance, string[]>> = {
  0: { normal: ["qwen xhigh", ""], high: ["qwen xhigh", "T1 high"], critical: ["T1 high", "T2 high"] },
  1: { normal: ["T1 high", ""], high: ["T1 xhigh", ""], critical: ["T2 xhigh", ""] },
  2: { normal: ["T2 high", ""], high: ["T2 xhigh", ""], critical: ["T2 xhigh", "T2 xhigh"] },
};
const READ: Record<number, Record<Importance, string[]>> = {
  0: { normal: ["qwen xhigh", ""], high: ["qwen xhigh", "T1 high"], critical: ["T1 high", "T2 high"] },
  1: { normal: ["T1 high", ""], high: ["T1 xhigh", ""], critical: ["T1 high", "T2 high"] },
  2: { normal: ["T1 high", ""], high: ["T1 xhigh", ""], critical: ["T2 xhigh", ""] },
  3: { normal: ["T2 high", ""], high: ["T2 xhigh", ""], critical: ["T2 xhigh", "T2 xhigh"] },
};

test("every default cell of write (= today's TABLE) and read, labelled through firstMeeting + effortAt", () => {
  for (const [a, want] of [["write", TODAY], ["read", READ]] as const)
    for (const [l, row] of Object.entries(want)) for (const i of IMPS) {
      const r = planLegs(R(a, Number(l)), i, P({ ability: a }), S);
      assert.deepEqual(show(r, a), row[i], `${a} ${l} ${i}`);
      assert.deepEqual(r.reasons, [`importance=${i}`]);
    }
});

test("draft: normal gets a review one level up at step 0; high and critical keep the cell's review", () => {
  const d = (i: Importance) => show(planLegs(R("write", 0, { draft: true }), i, P(), S), "write");
  assert.deepEqual(d("normal"), ["qwen xhigh", "T1 high"]);
  assert.deepEqual(d("high"), ["qwen xhigh", "T1 high"]);
  assert.deepEqual(d("critical"), ["T1 high", "T2 high"]);
});

test("pin at the bottom: no review at every importance, reason 'stays on qwen'", () => {
  for (const a of ["write", "read"]) for (const i of IMPS) {
    const r = planLegs(R(a, 0, { pinned: true }), i, P({ ability: a }), S);
    assert.deepEqual(show(r, a), ["qwen xhigh", ""], `${a} ${i}`);
    assert.deepEqual(r.reasons, [`importance=${i}`, "stays on qwen"]);
  }
});

test("pin T1 at critical: worker lowered to the pin keeping its step, review one level up (W1·1 + R2·0, 'pinned tier T1')", () => {
  const w = planLegs(R("write", 1, { pinned: true }), "critical", P(), S);
  assert.deepEqual([w.worker, w.review], [{ level: 1, step: 1 }, { level: 2, step: 0 }]);
  assert.deepEqual(show(w, "write"), ["T1 xhigh", "T2 high"]);
  assert.deepEqual(w.reasons, ["importance=critical", "pinned tier T1"]);
  const r = planLegs(R("read", 2, { pinned: true }), "critical", P({ ability: "read" }), S);
  assert.deepEqual(show(r, "read"), ["T1 xhigh", "T2 high"]);
  for (const i of ["normal", "high"] as const) assert.deepEqual(show(planLegs(R("write", 1, { pinned: true }), i, P(), S), "write"), TODAY[1][i]);
});

test("plan (pin top) at critical keeps W2·1 + R2·1", () => {
  const r = planLegs(R("write", 2, { pinned: true }), "critical", P({ level: "top" }), S);
  assert.deepEqual([r.worker, r.review], [{ level: 2, step: 1 }, { level: 2, step: 1 }]);
  assert.deepEqual(r.reasons, ["importance=critical"]);
});

test("a profile's table is used instead of its ability's", () => {
  const s = parseSettings({ importanceTable: { read: { "2": { critical: { worker: { level: 2, step: 1 } } } } } }).settings;
  assert.deepEqual(show(planLegs(R("read", 2), "critical", P({ ability: "read" }), s), "read", s), ["T1 xhigh", ""]);
  assert.deepEqual(show(planLegs(R("read", 2), "critical", P({ ability: "read", table: "review" }), s), "read", s), ["T2 xhigh", ""]);
});

test("a step beyond a one-step ladder is clamped to its last effort", () => {
  const s = parseSettings({ importanceTable: { write: { "0": { normal: { worker: { level: 0, step: 1 } } } } } }).settings;
  assert.deepEqual(show(planLegs(R("write", 0), "normal", P(), s), "write", s), ["qwen xhigh", ""]);
});

test("P-nomax: every router-chosen effort is on the member's ladder and never max, over every cell, draft, pin and ladder", () => {
  const ladders = [undefined, ["low"], ["medium", "high", "xhigh"], ["minimal", "low", "medium", "high", "xhigh"]];
  let n = 0;
  for (const lad of ladders) {
    const s = lad ? parseSettings({ models: { sonnet: { efforts: lad }, opus: { efforts: lad } } }).settings : S;
    for (const a of ["write", "read", "review"]) {
      const ab = a === "review" ? "read" : a;
      for (const l of Object.keys(s.importanceTable[a])) for (const i of IMPS)
        for (const o of [{}, { draft: true }, { pinned: true }]) {
          if ((o as any).draft && !(ab === "write" && l === "0")) continue;
          const r = planLegs(R(ab, Number(l), o), i, P({ ability: ab, table: a }), s);
          for (const leg of [r.worker, r.review]) if (leg) {
            const m = enabled(s.models).find((x) => (x.abilities[ab] ?? -1) >= leg.level)!;
            const e = effortAt(m, leg.step);
            assert.ok(e !== "max" && m.efforts.includes(e), `${lad} ${a} ${l} ${i} ${JSON.stringify(o)}`);
            n++;
          }
        }
    }
  }
  assert.ok(n > 300, String(n));
});

// --- read-only rule (RD4, OD8, OD18; T2.4 at need 0) -----------------------------------------

const HAIKU = { haiku: { model: "anthropic/claude-haiku-5-5" } };
const ES = parseSettings({ readOnlyReview: "effort-step" }).settings;
const RO = P({ ability: "read", tools: "read-only" });

test("read-only rule: off under readOnlyReview review", () => {
  const r = planLegs(R("read", 0), "critical", RO, S);
  assert.deepEqual(show(r, "read"), ["T1 high", "T2 high"]);
  assert.deepEqual(r.reasons, ["importance=critical"]);
});

test("read-only rule: nothing at normal and high (read row 0 high keeps Qwen + Sonnet-high review; a read-only write draft keeps its review)", () => {
  assert.deepEqual(show(planLegs(R("read", 0), "high", RO, ES), "read", ES), ["qwen xhigh", "T1 high"]);
  const d = planLegs(R("write", 0, { draft: true }), "normal", P({ tools: "read-only" }), ES);
  assert.deepEqual(show(d, "write", ES), ["qwen xhigh", "T1 high"]);
});

test("read-only rule branch 1: W's member has a step left → one step up, no review (read row 0 critical → Sonnet xhigh)", () => {
  const r = planLegs(R("read", 0), "critical", RO, ES);
  assert.deepEqual([r.worker, r.review], [{ level: 2, step: 1 }, undefined]);
  assert.deepEqual(r.reasons, ["importance=critical", "read-only critical: review → T1 xhigh"]);
  assert.deepEqual(show(planLegs(R("read", 0), "critical", P({ ability: "read", tools: "read-only+files" }), ES), "read", ES), ["T1 high", "T2 high"]);
});

test("read-only rule branch 2: W at its last step, not pinned, a member above → the next level up at step 0, no review", () => {
  const s = parseSettings({ readOnlyReview: "effort-step", models: HAIKU,
    importanceTable: { read: { "1": { critical: { worker: { level: 1, step: 1 }, review: { level: 2, step: 0 } } } } } }).settings;
  const r = planLegs(R("read", 1), "critical", RO, s);
  assert.deepEqual([r.worker, r.review], [{ level: 2, step: 0 }, undefined]);
  assert.deepEqual(r.reasons, ["importance=critical", "read-only critical: review → T1 high"]);
});

test("read-only rule branch 3: at the top, or pinned, W at its last step keeps the review", () => {
  const t = planLegs(R("read", 3), "critical", RO, ES);
  assert.deepEqual(show(t, "read", ES), ["T2 xhigh", "T2 xhigh"]);
  assert.deepEqual(t.reasons, ["importance=critical", "read-only critical: no step left, review kept"]);
  const p1 = planLegs(R("write", 1, { pinned: true }), "critical", P({ tools: "read-only", level: 1 }), ES);
  assert.deepEqual(show(p1, "write", ES), ["T1 xhigh", "T2 high"]);
  assert.deepEqual(p1.reasons, ["importance=critical", "pinned tier T1", "read-only critical: no step left, review kept"]);
});

test("P-ro and P-imp over resolved members: all read-only profiles × requirements × settings, at need 0", () => {
  const variants = [
    ES,
    parseSettings({ readOnlyReview: "effort-step", models: HAIKU }).settings,
    parseSettings({ readOnlyReview: "effort-step", models: HAIKU,
      importanceTable: { read: { "1": { critical: { worker: { level: 1, step: 1 }, review: { level: 2, step: 0 } } } } } }).settings,
  ];
  const profiles = [RO, P({ ability: "read", tools: "read-only", table: "review" }), P({ tools: "read-only" })];
  const rank = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  let n = 0;
  for (const s of variants) {
    const off = { ...s, readOnlyReview: "review" as const };
    for (const p of profiles) {
      const a = p.ability ?? "write";
      const ls = [...new Set(enabled(s.models).map((m) => m.abilities[a]))];
      for (const level of ls) for (const pinned of [false, true]) for (const draft of a === "write" && level === 0 && !pinned ? [false, true] : [false]) {
        const req = R(a, level, { pinned, draft });
        const res = (l: Leg) => { const m = firstMeeting(s.models, a, l.level)!; return [m.abilities[a], rank.indexOf(effortAt(m, l.step))]; };
        const le = (x: number[], y: number[]) => x[0] < y[0] || (x[0] === y[0] && x[1] <= y[1]);
        const on = IMPS.map((i) => planLegs(req, i, p, s));
        const ro = IMPS.map((i) => planLegs(req, i, p, off));
        const id = `${a} ${level} ${pinned} ${draft} ${p.table ?? ""}`;
        for (const k of [0, 1]) assert.deepEqual(on[k], ro[k], `P-ro normal/high ${id}`);
        const c = on[2], c0 = ro[2];
        if (!c0.review) assert.deepEqual(c, c0, `P-ro no review to drop ${id}`);
        else if (c.review) {
          const W = firstMeeting(s.models, a, c.worker.level)!;
          const above = enabled(s.models).some((m) => (m.abilities[a] ?? -1) > W.abilities[a]);
          assert.ok(c.worker.step >= W.efforts.length - 1 && (pinned || !above), `P-ro review kept ${id}`);
        } else assert.ok(!le(res(c.worker), res(c0.worker)), `P-imp review dropped, worker not raised ${id}`);
        for (const [i, j] of [[0, 1], [1, 2], [0, 2]]) {
          assert.ok(le(res(on[i].worker), res(on[j].worker)), `P-imp worker ${IMPS[i]} ≤ ${IMPS[j]} ${id}`);
          if (on[i].review && j !== 2) assert.ok(on[j].review, `P-imp review ${IMPS[i]} ⇒ ${IMPS[j]} ${id}`);
          if (on[i].review && j === 2 && !on[j].review) assert.ok(!le(res(c.worker), res(c0.worker)), `P-imp exception ${id}`);
        }
        n++;
      }
    }
  }
  assert.ok(n >= 30, String(n));
});

// The read-only rule's W is the planned member at the card's need: the first context candidate (spec §4.4 rule 4; r2 M1; HP T3.1;
// r4 cases.mts). M5 defaults written out: Haiku enabled, the free cloud blank, contextFit 1; the rule on.
const ALL: T0 = { bounded: true, specified: true, verifiable: true, lowRisk: true, small: true, linear: true };
const M5 = (o: Record<string, unknown> = {}, models: Record<string, unknown> = {}) => parseSettings({
  readOnlyReview: "effort-step", contextFit: 1, ...o, models: { ...HAIKU, "qwen-cloud": { model: "" }, ...models },
}).settings;
const spawn = (s: RouterSettings, p: Profile, i: Importance, need: number, c: Pick<Card, "t0" | "t2"> = { t0: ALL, t2: [] }): Plan => {
  const card: Card = { kind: "x", files: [], acceptance: [], ...c };
  const r = planSpawn({ settings: s, attempts: new Map(), rng: () => 0.99 }, { taskId: "t", card, verified: { t0: card.t0, forceT2: false, reasons: [], tokens: need }, profile: p, importance: i });
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.value.plan;
};
const label = (p: Plan) => `${p.base}/${p.worker.tier}/${p.worker.effort}/${p.review?.tier ?? ""}/${p.review?.effort ?? ""}`;
const ROW = P({ tools: "read-only" });

test("read-only rule, Case A: W = Haiku (Qwen cannot hold 500k) has a step left → Haiku high, no review", () => {
  const s = M5({ importanceTable: { write: { "0": { critical: { worker: { level: 0, step: 0 }, review: { level: 1, step: 0 } } } } } });
  const p = spawn(s, ROW, "critical", 500000);
  assert.equal(label(p), "qwen/haiku/high//");
  assert.ok(p.reasons.includes("read-only critical: review → haiku high"), p.reasons.join("; "));
  assert.equal(label(spawn({ ...s, readOnlyReview: "review" }, ROW, "critical", 500000)), "qwen/haiku/medium/T1/high");
});

test("read-only rule, Case B: W = Opus (only it holds 1.5M) at its last step, nothing above → Opus xhigh + Opus-xhigh review (= rule off)", () => {
  const s = M5({}, { opus: { contextWindow: 2000000, efforts: ["xhigh"] } });
  const p = spawn(s, ROW, "critical", 1500000);
  assert.equal(label(p), "qwen/T2/xhigh/T2/xhigh");
  assert.ok(p.reasons.includes("read-only critical: no step left, review kept"), p.reasons.join("; "));
  assert.equal(label(spawn({ ...s, readOnlyReview: "review" }, ROW, "critical", 1500000)), "qwen/T2/xhigh/T2/xhigh");
});

test("P-ro and P-imp over resolved members at the card's need: needs × Opus 1M/2M × read-only profiles × cards × importances (840 plans)", () => {
  const NEEDS = [0, 200000, 300000, 950000, 1063824, 1500000, 2500000];
  const CARDS: Pick<Card, "t0" | "t2">[] = [{ t0: ALL, t2: [] }, { t0: { ...ALL, small: false }, t2: [] }, { t0: { ...ALL, linear: false }, t2: [] }, { t0: ALL, t2: ["security"] }];
  let n = 0;
  for (const ow of [1000000, 2000000]) {
    const s = M5({}, { opus: { contextWindow: ow } }), off = { ...s, readOnlyReview: "review" as const };
    const prof = (k: string) => { const r = profileFor(k, s); if (!r.ok) throw new Error(k); return r.value; };
    const profiles = [prof("scout"), prof("review"), P({ ability: "read", minLevel: 2, tools: "read-only" }), RO, ROW];
    for (const p of profiles) for (const c of CARDS) for (const need of NEEDS) {
      const a = p.ability ?? "write", M = capToTable(s, p).models;
      const res = (pl: Plan) => [M[pl.worker.member].abilities[a], effortRank(pl.worker.effort)];
      const le = (x: number[], y: number[]) => x[0] < y[0] || (x[0] === y[0] && x[1] <= y[1]);
      const on = IMPS.map((i) => spawn(s, p, i, need, c)), ro = IMPS.map((i) => spawn(off, p, i, need, c));
      const id = `opus ${ow} ${p.table ?? a} ${p.minLevel ?? ""} ${JSON.stringify(c)} need ${need}`;
      for (const k of [0, 1]) assert.deepEqual(on[k], ro[k], `P-ro normal/high ${id}`);
      const [cr, c0] = [on[2], ro[2]];
      if (c0.review && !cr.review) assert.ok(!le(res(cr), res(c0)), `P-imp review dropped, worker not raised ${id}: ${label(cr)} vs ${label(c0)}`);
      if (cr.review) {
        const W = M[cr.worker.member], above = enabled(M).some((m) => (m.abilities[a] ?? -1) > W.abilities[a]);
        assert.ok(cr.worker.effort === W.efforts.at(-1) && !above && label(cr) === label(c0), `P-ro review kept ${id}: ${label(cr)}`);
      }
      for (const [i, j] of [[0, 1], [1, 2], [0, 2]]) {
        if (j !== 2 || on[j].review || !on[i].review) assert.ok(le(res(on[i]), res(on[j])), `P-imp worker ${IMPS[i]} ≤ ${IMPS[j]} ${id}`);
        if (on[i].review && j !== 2) assert.ok(on[j].review, `P-imp review ${IMPS[i]} ⇒ ${IMPS[j]} ${id}`);
      }
      n += 3;
    }
  }
  assert.equal(n, 840);
});
