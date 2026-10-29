import { test } from "node:test";
import assert from "node:assert/strict";
import { candidates, labelLeg, pickMember } from "../core/select.ts";
import type { MemberState } from "../core/select.ts";
import { defaults, parseSettings } from "../core/settings.ts";
import { named } from "../core/members.ts";
import { TODAY_RAW, todayWith } from "./harness.ts";

const S = defaults();
/** T5.1: the tests that name today's members (the free cloud first at write 0, no Haiku) run on the today fixture. */
const T = parseSettings(TODAY_RAW).settings;
const names = (s: typeof S, a: string, l: number) => candidates(s, a, l, 0).cands.map((m) => m.name);

test("candidates: the enabled members meeting the level, in (cost, order, name) order (cloud before local today)", () => {
  assert.deepEqual(names(T, "write", 0), ["qwen-cloud", "qwen-local", "sonnet", "opus"]);
  assert.deepEqual(names(T, "write", 1), ["sonnet", "opus"]);
  assert.deepEqual(names(T, "read", 1), ["sonnet", "opus"]);
  assert.deepEqual(names(T, "read", 3), ["opus"]);
  const h = parseSettings(todayWith({ models: { haiku: { model: "anthropic/claude-haiku-5-5" } } })).settings;
  assert.deepEqual(names(h, "read", 1), ["haiku", "sonnet", "opus"]);
  assert.equal(candidates(T, "write", 0, 50_000).reason, undefined);
});

test("candidates: a blank member is no candidate", () => {
  const s = parseSettings(todayWith({ models: { "qwen-cloud": { model: "" } } })).settings;
  assert.deepEqual(names(s, "write", 0), ["qwen-local", "sonnet", "opus"]);
});

test("labelLeg: the first candidate, its effort at the step clamped to its ladder", () => {
  assert.deepEqual(labelLeg(T, "write", { level: 0, step: 3 }, 0), {
    leg: { level: 0, step: 3, member: "qwen-cloud", model: "openrouter/qwen/qwen3.8-27b:free", tier: "qwen", effort: "xhigh" },
  });
  assert.deepEqual(labelLeg(T, "read", { level: 2, step: 1 }, 0).leg, { level: 2, step: 1, member: "sonnet", model: "anthropic/claude-sonnet-5-5", tier: "T1", effort: "xhigh" });
  assert.deepEqual(labelLeg(T, "write", { level: 2, step: 0 }, 0).leg.effort, "high");
});

// P-ctx (OD17, plan T3.1; r4 `replay.mts select`): the soft context filter over 7 legs × 7 needs × Opus window {1M, 2M}, under the
// M5 defaults with Haiku enabled, the free cloud blank and `contextFit: 1`.
const NEEDS = [0, 200000, 300000, 950000, 1063824, 1500000, 2500000];
const LEGS = [["write", 0], ["write", 1], ["write", 2], ["read", 0], ["read", 1], ["read", 2], ["read", 3]] as const;
const ctx = (opusWindow: number, contextFit = 1) => parseSettings({
  contextFit, models: { haiku: { model: "anthropic/claude-haiku-5-5" }, "qwen-cloud": { model: "" }, opus: { contextWindow: opusWindow } },
}).settings;
/** r4 results.txt, "soft picks for need ≥ 950k" (needs 950000, 1063824, 1500000, 2500000 per leg). */
const SOFT_PICKS: Record<number, Record<string, string[]>> = {
  1000000: {
    "write 0": ["haiku", "haiku", "haiku", "haiku"], "write 1": ["sonnet", "sonnet", "sonnet", "sonnet"], "write 2": ["opus", "opus", "opus", "opus"],
    "read 0": ["haiku", "haiku", "haiku", "haiku"], "read 1": ["haiku", "haiku", "haiku", "haiku"], "read 2": ["sonnet", "sonnet", "sonnet", "sonnet"],
    "read 3": ["opus", "opus", "opus", "opus"],
  },
  2000000: {
    "write 0": ["haiku", "opus", "opus", "opus"], "write 1": ["sonnet", "opus", "opus", "opus"], "write 2": ["opus", "opus", "opus", "opus"],
    "read 0": ["haiku", "opus", "opus", "opus"], "read 1": ["haiku", "opus", "opus", "opus"], "read 2": ["sonnet", "opus", "opus", "opus"],
    "read 3": ["opus", "opus", "opus", "opus"],
  },
};

test("P-ctx: fit ≠ ∅ → the first fitting member; fit = ∅ → the largest window with the reason; never no candidate (7 legs × 7 needs × Opus 1M/2M)", () => {
  for (const ow of [1000000, 2000000]) {
    const s = ctx(ow);
    const viol: string[] = [], noReason: string[] = [], picks: Record<string, string[]> = {};
    for (const [a, l] of LEGS) {
      const p = (picks[`${a} ${l}`] = [] as string[]);
      for (const need of NEEDS) {
        const meet = names(s, a, l).map((n) => s.models[n]);
        const fit = meet.filter((m) => need <= m.contextWindow);
        const { cands, reason } = candidates(s, a, l, need);
        const pick = cands[0];
        const ok = pick !== undefined && (fit.length
          ? pick.name === names(s, a, l).find((n) => need <= s.models[n].contextWindow) && cands.every((c) => need <= c.contextWindow)
          : meet.every((m) => m.contextWindow <= pick.contextWindow));
        if (!ok) viol.push(`opus ${ow} ${a} ${l} need ${need}: ${pick?.name ?? "none"}`);
        if (!fit.length && !reason?.includes("no member meeting")) noReason.push(`opus ${ow} ${a} ${l} need ${need}`);
        if (need >= 950000) p.push(pick?.name ?? "none");
      }
    }
    assert.deepEqual(viol, [], `${viol.length} P-ctx violations at Opus ${ow}`);
    assert.deepEqual(noReason, [], `${noReason.length} fallbacks without the context reason at Opus ${ow}`);
    assert.deepEqual(picks, SOFT_PICKS[ow], `soft picks at Opus ${ow}`);
  }
});

test("candidates: the exclusion reason names the members that cannot hold the files; none when all fit", () => {
  const s = ctx(1000000);
  assert.deepEqual(candidates(s, "write", 0, 300000), {
    cands: ["haiku", "sonnet", "opus"].map((n) => ({ ...s.models[n], name: n })),
    reason: "context: files need ~300000 tokens; excluded qwen-local (262144)",
  });
  assert.equal(candidates(s, "write", 0, 200000).reason, undefined);
  assert.deepEqual(names(s, "write", 0), ["qwen-local", "haiku", "sonnet", "opus"]);
  assert.equal(candidates(s, "write", 0, 262144).cands[0].name, "qwen-local");
});

test("candidates: no member holds the files → the largest window (ties in (cost, order, name)), the fallback reason, never empty", () => {
  const big = candidates(ctx(1000000), "write", 0, 1063824.4);
  assert.deepEqual(big.cands.map((m) => m.name), ["haiku", "sonnet", "opus"]);
  assert.equal(big.reason, "context: files need ~1063824 tokens (whole files); no member meeting write 0 holds them; took the largest window (haiku, 1000000 tokens): list only the files the task reads, or split the task");
  const two = candidates(ctx(2000000), "read", 1, 2500000);
  assert.deepEqual(two.cands.map((m) => m.name), ["opus"]);
  assert.equal(two.reason, "context: files need ~2500000 tokens (whole files); no member meeting read 1 holds them; took the largest window (opus, 2000000 tokens): list only the files the task reads, or split the task");
});

test("candidates: contextFit 0 (or need 0) → no filter, no reason", () => {
  const off = ctx(1000000, 0);
  assert.deepEqual(candidates(off, "write", 0, 2500000), { cands: candidates(off, "write", 0, 0).cands });
  assert.deepEqual(candidates(ctx(1000000), "write", 0, 0).cands.map((m) => m.name), ["qwen-local", "haiku", "sonnet", "opus"]);
  const half = parseSettings(todayWith({ contextFit: 0.5, models: { "qwen-cloud": { model: "" } } })).settings; // T5.1: no Haiku
  assert.deepEqual(candidates(half, "write", 0, 200000).cands.map((m) => m.name), ["sonnet", "opus"]);
});

// P-cheapest, P-empty (HP T3.2): the runtime pick over the leg's candidates, in (cost, order, name) order.
const ST = ["down", "busy", "free"] as const;
const state = (name: string, cost: number, st: (typeof ST)[number]): MemberState => ({ name, cost, up: st !== "down", free: st === "free" });

test("P-cheapest: before expiry a free member of the cheapest up pool or wait; after it the first free up member; nothing up → none (exhaustive, costs 0, 0, 3)", () => {
  let n = 0;
  for (const x of ST) for (const y of ST) for (const z of ST) for (const expired of [false, true]) {
    const cands = [state("x", 0, x), state("y", 0, y), state("z", 3, z)];
    const up = cands.filter((m) => m.up), pool = up.filter((m) => m.cost === Math.min(...up.map((u) => u.cost)));
    const got = pickMember(cands, expired), id = `${x} ${y} ${z} expired=${expired}`;
    if (up.length === 0) assert.deepEqual(got, { none: "no member up" }, id);
    else if ("pick" in got) {
      const m = cands.find((c) => c.name === got.pick)!;
      assert.ok(m.free, `picked a busy member ${id}`);
      if (!expired) assert.ok(pool.includes(m), `pick outside the cheapest up pool ${id}`);
      assert.equal(m, (expired ? up : pool).find((c) => c.free), `not the first free ${id}`);
    } else if ("wait" in got) assert.ok(!expired && !pool.some((m) => m.free), `waited with a free cheapest member ${id}`);
    else assert.ok(expired && !up.some((m) => m.free) && got.none === "no member free", `none ${id}: ${got.none}`);
    n++;
  }
  assert.equal(n, 54);
});

test("pickMember: a down member is skipped at once; a busy cheapest pool waits before expiry and falls through after it", () => {
  assert.deepEqual(pickMember([state("x", 0, "down"), state("y", 1, "free")], false), { pick: "y" });
  assert.deepEqual(pickMember([state("x", 0, "busy"), state("y", 1, "free")], false), { wait: true });
  assert.deepEqual(pickMember([state("x", 0, "busy"), state("y", 1, "free")], true), { pick: "y" });
  assert.deepEqual(pickMember([state("x", 0, "busy"), state("y", 0, "free")], false), { pick: "y" });
  assert.deepEqual(pickMember([], false), { none: "no member up" });
});

test("P-empty: a blank member is no candidate, so no pick, even when it would be the cheapest and free", () => {
  const s = parseSettings(todayWith({ models: { "qwen-cloud": { model: "" } } })).settings;
  const states = (ss: typeof T) => candidates(ss, "write", 0, 0).cands.map((m) => state(m.name, m.cost, "free"));
  assert.deepEqual(pickMember(states(T), false), { pick: "qwen-cloud" });
  assert.deepEqual(pickMember(states(s), false), { pick: "qwen-local" });
});

// mi7 (HP T3.4, r2 L6): a busy probe makes a member not free whatever its slots; it stays up (a wait, not a skip).
test("memberState: `slots: 2`, nothing running, probe busy → up, not free; not busy → free", async () => {
  const { memberState } = await import("../core/policy.ts");
  const m = { ...named(defaults().models, "qwen-local")!, slots: 2 };
  const d = { children: new Map(), blocks: new Map(), counter: { today: () => 0, bump() {} } } as any;
  assert.deepEqual(memberState(d, m, new Map(), 0, { up: true, busy: true }), { name: "qwen-local", cost: m.cost, up: true, free: false });
  assert.deepEqual(memberState(d, m, new Map(), 0, { up: true, busy: false }), { name: "qwen-local", cost: m.cost, up: true, free: true });
  assert.deepEqual(memberState(d, m, new Map(), 0, { up: false, busy: false }), { name: "qwen-local", cost: m.cost, up: false, free: false });
});
