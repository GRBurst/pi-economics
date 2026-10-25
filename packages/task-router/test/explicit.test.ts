import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptModel } from "../core/explicit.ts";
import { EFFORTS, effortAt, enabled, levels, lvl, named, stepOf } from "../core/members.ts";
import { labelLeg } from "../core/select.ts";
import { parseSettings } from "../core/settings.ts";
import { planLegs } from "../core/table.ts";
import type { Importance, Leg, RouterSettings, ThinkingLevel } from "../core/types.ts";

const HAIKU = "anthropic/claude-haiku-5-5", SONNET = "anthropic/claude-sonnet-5-5", OPUS = "anthropic/claude-opus-5-5";
const X = { model: "x/ro", tier: "X", route: "T1", abilities: { write: 1 }, efforts: ["high"], contextWindow: 1000, cost: 9 }; // never a planned member
const S = parseSettings({ models: { haiku: { model: HAIKU }, x: X } }).settings;
const plan = (s: RouterSettings, ability: string, worker: Leg, reasons = ["r1", "r2"]) => ({ ability, worker: labelLeg(s, ability, worker, 0).leg, reasons });
const QW = plan(S, "write", { level: 0, step: 0 });
const err = (r: ReturnType<typeof acceptModel>) => (r.ok ? "accepted" : r.errors.join("; "));

test("rule 1: an unknown model is rejected listing the enabled models; a blank member's model is unknown", () => {
  const list = enabled(S.models).map((m) => m.model).join(", ");
  assert.equal(err(acceptModel(QW, "no/such", "max", S)), `model no/such is not in the routing table (${list})`);
  const b = parseSettings({ models: { opus: { model: "" } } }).settings;
  assert.equal(err(acceptModel(plan(b, "write", { level: 0, step: 0 }), OPUS, undefined, b)),
    `model ${OPUS} is not in the routing table (${enabled(b.models).map((m) => m.model).join(", ")})`);
});

test("rule 2: max is rejected, also with a higher model", () => {
  assert.equal(err(acceptModel(QW, OPUS, "max", S)), "effort max is never used; ask for xhigh");
  assert.equal(err(acceptModel(QW, undefined, "max", S)), "effort max is never used; ask for xhigh");
  assert.equal(err(acceptModel(QW, "x/ro", "max", S)), "effort max is never used; ask for xhigh");
});

test("rule 3: a model without a level on the plan's ability", () => {
  assert.equal(err(acceptModel(plan(S, "read", { level: 0, step: 0 }), "x/ro", "high", S)), "model x/ro has no read level");
});

test("rule 5: a lower level is rejected with the plan's reasons", () => {
  assert.equal(err(acceptModel(plan(S, "write", { level: 2, step: 0 }), SONNET, undefined, S)), `model ${SONNET} (T1) is below the routed T2: r1; r2`);
});

test("rule 6: at an equal level an effort below the plan's step on the model's own ladder is rejected", () => {
  assert.equal(err(acceptModel(plan(S, "write", { level: 1, step: 1 }), SONNET, "high", S)), "effort high is below the routed xhigh for T1");
  assert.equal(err(acceptModel(plan(S, "write", { level: 1, step: 1 }), SONNET, "xhigh", S)), "accepted");
  // Haiku (write 0, ladder medium/high) on a Qwen write plan
  assert.equal(err(acceptModel(QW, HAIKU, "low", S)), "effort low is below the routed xhigh for qwen");
  assert.deepEqual(acceptModel(QW, HAIKU, undefined, S), { ok: true, value: { member: "haiku", tier: "haiku", effort: "medium", pinned: true } });
  assert.deepEqual(acceptModel(QW, HAIKU, "high", S), { ok: true, value: { member: "haiku", tier: "haiku", effort: "high", pinned: true } });
});

test("rule 7: accepted; no model = the planned member; the plan's effort when the model's ladder has it", () => {
  assert.deepEqual(acceptModel(QW, undefined, undefined, S), { ok: true, value: { member: "qwen-cloud", tier: "qwen", effort: "xhigh", pinned: false } });
  assert.deepEqual(acceptModel(QW, SONNET, undefined, S), { ok: true, value: { member: "sonnet", tier: "T1", effort: "xhigh", pinned: true } });
  assert.deepEqual(acceptModel(plan(S, "write", { level: 1, step: 0 }), OPUS, "low", S), { ok: true, value: { member: "opus", tier: "T2", effort: "low", pinned: true } });
});

test("P-explicit: the first matching rule over every plan of planLegs × models × efforts; max never accepted", () => {
  const IMPS: Importance[] = ["normal", "high", "critical"];
  const efforts: (ThinkingLevel | undefined)[] = [undefined, ...EFFORTS];
  const models = [undefined, "no/such", ...enabled(S.models).map((m) => m.model)];
  let n = 0;
  for (const s of [S, parseSettings({ readOnlyReview: "effort-step", models: { haiku: { model: HAIKU }, x: X } }).settings])
    for (const a of ["write", "read"]) for (const level of levels(s.models, a)) for (const i of IMPS)
      for (const o of [{ draft: false, pinned: false }, { draft: level === 0 && a === "write", pinned: false }, { draft: false, pinned: true }]) {
        const legs = planLegs({ ability: a, level, reasons: [], ...o }, i, { tools: "read-only", skills: [], report: "default", ability: a }, s);
        const p = plan(s, a, legs.worker);
        const W = named(s.models, p.worker.member)!;
        for (const m of models) for (const e of efforts) {
          const r = acceptModel(p, m, e, s);
          const M = m === undefined ? W : enabled(s.models).find((x) => x.model === m);
          const want =
            !M ? "unknown" : e === "max" ? "max" : M.abilities[a] === undefined ? "nolevel" : lvl(M, a) < lvl(W, a) ? "below"
            : lvl(M, a) === lvl(W, a) && e !== undefined && stepOf(M, e) < Math.min(p.worker.step, M.efforts.length - 1) ? "effort" : "ok";
          const got = r.ok ? "ok" : /not in the routing table/.test(r.errors[0]) ? "unknown" : /^effort max/.test(r.errors[0]) ? "max"
            : / has no /.test(r.errors[0]) ? "nolevel" : /^effort .* is below/.test(r.errors[0]) ? "effort" : / is below the routed /.test(r.errors[0]) ? "below" : "?";
          assert.equal(got, want, `${a} ${level} ${i} ${JSON.stringify(o)} ${m} ${e}`);
          if (r.ok) {
            assert.ok(r.value.effort !== "max");
            assert.ok(e !== undefined ? r.value.effort === e : M!.efforts.includes(r.value.effort), `${m} ${e} ${r.value.effort}`);
            assert.equal(r.value.member, M!.name);
          }
          n++;
        }
      }
  assert.ok(n > 5000, String(n));
});
