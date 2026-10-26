import { test } from "node:test";
import assert from "node:assert/strict";
import { respawn, type AttemptState } from "../core/attempts.ts";
import { enabled, levels } from "../core/members.ts";
import { defaults } from "../core/settings.ts";
import { labelLeg } from "../core/select.ts";
import type { Leg, RouterSettings } from "../core/types.ts";
import { TODAY, tierRank, type Tier } from "./tier-plan.ts";

// --- the tier statements over member state (T2.10b: restated over `respawn`, tier labels under TODAY) --------

/** The worker leg of a tier: the write level of its first enabled member, step 0. */
const at = (t: Tier): Leg => ({ level: enabled(TODAY.models).find((m) => m.tier === t)!.abilities.write, step: 0 });
const tr = (st: AttemptState, taskId: string, attemptOf: string | undefined, worker: Leg) =>
  respawn(st, TODAY, { taskId, attemptOf, a: "write", worker, need: 0 });
const ok = (r: ReturnType<typeof tr>) => {
  assert.ok(r.ok, r.ok ? "" : r.errors.join());
  return (r as { value: { worker: Leg; reasons: string[] } }).value;
};
const tierOf = (w: Leg) => labelLeg(TODAY, "write", w, 0).leg;
const recorded = (st: AttemptState, id: string) => ({ tier: TODAY.models[st.get(id)!.member].tier, retries: st.get(id)!.retries });

test("escalate: qwen → T1 → T2 → T2", () => {
  for (const [from, to] of [["qwen", "T1"], ["T1", "T2"], ["T2", "T2"]] as [Tier, Tier][]) {
    const st: AttemptState = new Map();
    tr(st, "t0", undefined, at(from));
    assert.equal(tierOf(ok(tr(st, "t1", "t0", at("qwen"))).worker).tier, to, from);
  }
});

test("first spawn (no attemptOf): plan unchanged, tier recorded", () => {
  const st: AttemptState = new Map();
  assert.deepEqual(ok(tr(st, "t1", undefined, at("qwen"))), { worker: at("qwen"), reasons: [] });
  assert.deepEqual(recorded(st, "t1"), { tier: "qwen", retries: 0 });
});

test("respawn with attemptOf is raised one tier", () => {
  const st: AttemptState = new Map();
  tr(st, "t1", undefined, at("qwen"));
  const p2 = ok(tr(st, "t2", "t1", at("qwen")));
  assert.equal(tierOf(p2.worker).tier, "T1");
  assert.equal(tierOf(p2.worker).effort, "high");
  assert.ok(p2.reasons.some((r) => /escalat/i.test(r) && r.includes("qwen") && r.includes("T1")));
  assert.deepEqual(recorded(st, "t2"), { tier: "T1", retries: 0 });
  assert.equal(tierOf(ok(tr(st, "t3", "t2", at("qwen"))).worker).tier, "T2");
});

test("T2 stays T2: one retry allowed, a further retry is rejected and leaves no state", () => {
  const st: AttemptState = new Map();
  tr(st, "t1", undefined, at("T2"));
  assert.equal(tierOf(ok(tr(st, "t2", "t1", at("T2"))).worker).tier, "T2");
  assert.deepEqual(recorded(st, "t2"), { tier: "T2", retries: 1 });
  const r = tr(st, "t3", "t2", at("T2"));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && /T2/.test(r.errors.join()) && r.errors.join().includes("t2"));
  assert.equal(st.has("t3"), false);
});

test("a plan already above the escalation target stands", () => {
  const st: AttemptState = new Map();
  tr(st, "t1", undefined, at("qwen"));
  const w = { ...at("T2"), step: 1 };
  assert.deepEqual(ok(tr(st, "t2", "t1", w)).worker, w);
  assert.deepEqual(recorded(st, "t2"), { tier: "T2", retries: 0 });
});

test("unknown attemptOf: treated as failed at the planned tier", () => {
  assert.equal(tierOf(ok(tr(new Map(), "t2", "gone", at("qwen"))).worker).tier, "T1");
});

test("P-att: over every respawn sequence, retries per task lineage and tier ≤ 1", () => {
  for (const start of ["qwen", "T1", "T2"] as Tier[]) {
    const st: AttemptState = new Map();
    tr(st, "t0", undefined, at(start));
    let prev = "t0";
    let accepted = 0;
    for (let n = 1; n <= 8; n++) {
      const r = tr(st, `t${n}`, prev, at(start));
      if (!r.ok) break;
      accepted++;
      prev = `t${n}`;
      assert.ok(st.get(prev)!.retries <= 1);
      assert.ok(tierRank(tierOf(r.value.worker).tier) >= tierRank(start));
    }
    assert.ok(accepted <= 3 - tierRank(start) + 1, `${start}: ${accepted}`);
    assert.ok(accepted >= 1);
  }
});

// --- respawn by members (spec §4.6, P-att, mi2; T2.6) ----------------------------------------

const S = defaults();
const rsOn = (s: RouterSettings) => (st: AttemptState, taskId: string, attemptOf: string | undefined, worker: Leg, a = "write", fromRan?: boolean) =>
  respawn(st, s, { taskId, attemptOf, a, worker, need: 0, ...(fromRan ? { fromRan } : {}) });
const rs = rsOn(S);
/** T5.1: the tests that name today's members (the free cloud at write 0, read 2 = T1) run on the today fixture. */
const rsT = rsOn(TODAY);
const L = (level: number, step = 0): Leg => ({ level, step });

test("respawn: write 0 → 1 → 2 → 2 → reject, the rejection text unchanged", () => {
  const st: AttemptState = new Map();
  assert.deepEqual(rsT(st, "t0", undefined, L(0)), { ok: true, value: { worker: L(0), reasons: [] } });
  assert.deepEqual(st.get("t0"), { member: "qwen-cloud", ranMember: "qwen-cloud", retries: 0 });
  assert.deepEqual(rsT(st, "t1", "t0", L(0)), { ok: true, value: { worker: L(1), reasons: ["escalated qwen → T1 after failure of t0"], esc: { ranMember: "qwen-cloud", fromLevel: 0, toLevel: 1, known: true } } });
  assert.deepEqual(st.get("t1"), { member: "sonnet", ranMember: "sonnet", retries: 0 });
  const t2 = rsT(st, "t2", "t1", L(0));
  assert.ok(t2.ok && t2.value.worker.level === 2 && t2.value.reasons[0] === "escalated T1 → T2 after failure of t1");
  const t3 = rsT(st, "t3", "t2", L(0));
  assert.ok(t3.ok && t3.value.worker.level === 2 && t3.value.reasons[0] === "escalated T2 → T2 after failure of t2");
  assert.deepEqual(st.get("t3"), { member: "opus", ranMember: "opus", retries: 1 });
  assert.deepEqual(rsT(st, "t4", "t3", L(0)), { ok: false, errors: ["task t3 already retried at write level 2 (T2); report the failure to the user instead of a third attempt"] });
  assert.equal(st.has("t4"), false);
});

test("respawn: a plan above the target stands, recording its own member with retries 0 (mi2)", () => {
  const st: AttemptState = new Map();
  rsT(st, "t0", undefined, L(0));
  assert.deepEqual(rsT(st, "t1", "t0", L(2, 1)), { ok: true, value: { worker: L(2, 1), reasons: [], esc: { ranMember: "qwen-cloud", fromLevel: 0, toLevel: 2, known: true } } });
  assert.deepEqual(st.get("t1"), { member: "opus", ranMember: "opus", retries: 0 });
});

test("respawn: an unknown attemptOf is a failure at the planned member", () => {
  const r = rsT(new Map(), "t2", "gone", L(0));
  assert.ok(r.ok && r.value.worker.level === 1 && r.value.esc?.fromLevel === 0 && r.value.esc.ranMember === "qwen-cloud");
  assert.equal(r.ok && r.value.esc?.known, false); // RG6: the stand-in is not where the attempt ran
});

test("respawn: another kind is compared on the new card's scale (scout after implement: read(qwen) = 0 → 2)", () => {
  const st: AttemptState = new Map();
  rsT(st, "t0", undefined, L(0));
  const r = rsT(st, "t1", "t0", L(2), "read");
  assert.deepEqual(r, { ok: true, value: { worker: L(2), reasons: ["escalated qwen → T1 after failure of t0"], esc: { ranMember: "qwen-cloud", fromLevel: 0, toLevel: 2, known: true } } });
});

test("respawn: esc carries the member the task ran on; fromRan raises from to it (D7)", () => {
  const st: AttemptState = new Map([["t0", { member: "qwen-cloud", ranMember: "sonnet", retries: 0 }]]);
  const plain = rs(st, "t1", "t0", L(0));
  assert.ok(plain.ok && plain.value.worker.level === 1);
  assert.deepEqual(plain.ok && plain.value.esc, { ranMember: "sonnet", fromLevel: 0, toLevel: 1, known: true });
  const ran = rs(st, "t2", "t0", L(0), "write", true);
  assert.ok(ran.ok && ran.value.worker.level === 2);
  assert.deepEqual(ran.ok && ran.value.esc, { ranMember: "sonnet", fromLevel: 1, toLevel: 2, known: true });
});

// RF3 (review-g5 plant MP1): D7 starts from the higher of the planned and the ran level, not from the ran one alone. The shipped
// configs never leave the planned member above the ran one on the re-spawn's ability, so the state is constructed: a write-0
// attempt planned on Haiku (read 1) that ran on Qwen local (read 0), re-spawned on the read scale.
test("respawn (D7): the planned member above the ran one on the new ability → the escalation starts from the planned level", () => {
  const st: AttemptState = new Map([["t0", { member: "haiku", ranMember: "qwen-local", retries: 0 }]]);
  const r = rs(st, "t1", "t0", L(0), "read", true);
  assert.ok(r.ok && r.value.worker.level === 2);
  assert.deepEqual(r.ok && r.value.esc, { ranMember: "qwen-local", fromLevel: 1, toLevel: 2, known: true });
});

test("P-att (members): over every re-spawn sequence of length ≤ 4 on both scales, retries per lineage and level ≤ 1", () => {
  let n = 0;
  for (const a of ["write", "read"]) {
    const ls = levels(S.models, a);
    const seqs: number[][] = [[]];
    for (let k = 0; k < 4; k++) for (const q of seqs.filter((x) => x.length === k)) for (const l of ls) seqs.push([...q, l]);
    for (const first of ls) for (const seq of seqs) {
      const st: AttemptState = new Map();
      rs(st, "t0", undefined, L(first), a);
      const lv = (id: string) => S.models[st.get(id)!.member].abilities[a];
      const seen = [lv("t0")];
      let prev = "t0";
      for (const [k, l] of seq.entries()) {
        const r = rs(st, `t${k + 1}`, prev, L(l), a);
        if (!r.ok) { assert.equal(st.has(`t${k + 1}`), false); break; }
        prev = `t${k + 1}`;
        assert.ok(st.get(prev)!.retries <= 1);
        assert.ok(lv(prev) >= seen.at(-1)!, `${a} ${first} ${seq}`);
        assert.ok(r.value.esc && r.value.esc.toLevel >= r.value.esc.fromLevel);
        seen.push(lv(prev));
      }
      for (const l of ls) assert.ok(seen.filter((x, i) => i > 0 && x === l && seen[i - 1] === l).length <= 1, `${a} ${first} ${seq}`);
      n++;
    }
  }
  assert.ok(n > 100, String(n));
});
