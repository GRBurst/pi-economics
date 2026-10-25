// T5.21: task-level randomization. A spawn whose computed worker is Qwen (T0 or Qwen draft) goes to
// T1 (Sonnet high) with probability `randomize.share`; the review obligation is unchanged. The spawn
// line says who assigned the tier (`assigned`) and what the router computed (`routeBase`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaults, parseSettings } from "../core/settings.ts";
import { randomizeLeg } from "../core/randomize.ts";
import { labelLeg } from "../core/select.ts";
import type { RouterSettings } from "../core/types.ts";
import { TODAY } from "./tier-plan.ts";
import { accepted, card, harness, provideSkills } from "./harness.ts";

const SONNET = "anthropic/claude-sonnet-5-5";
const T0 = card().t0;
// One card per route: T0 (qwen), Qwen draft (soft miss), Qwen at high importance (+ review), critical (T1), T1, T2, plan.
const CASES = [
  { name: "t0", task: card(), qwen: true },
  { name: "draft", task: card({ t0: { ...T0, small: false } }), qwen: true },
  { name: "high", task: card({ importance: "high" }), qwen: true },
  { name: "crit", task: card({ importance: "critical" }), qwen: false },
  { name: "t1", task: card({ t0: { ...T0, linear: false } }), qwen: false },
  { name: "t2", task: card({ t2: ["security"] }), qwen: false },
  { name: "plan", task: card({ kind: "plan" }), qwen: false },
];

async function run(rz: Partial<RouterSettings["randomize"]>, rng: () => number) {
  const h = harness({ settings: { randomize: { ...defaults().randomize, ...rz } }, extra: { rng } as never });
  provideSkills(h, ["tdd-implementation-planner"]);
  const out: Record<string, { r: any; e: Record<string, any> }> = {};
  for (const c of CASES) {
    const r = accepted(await h.a.spawn({ name: c.name, task: c.task })) as any;
    h.a.emit({ type: "spawn", name: c.name, by: "main", parent: "main", childSessionId: `s-${c.name}`, ts: 1 });
    out[c.name] = { r, e: h.lines().find((l) => l.event === "spawn" && l.taskId === c.name)! };
  }
  return out;
}

test("defaults: randomize and spot checks are off (the user's config enables them)", () => {
  assert.deepEqual(defaults().randomize, { enabled: false, share: 0.2 });
  assert.deepEqual(defaults().spotCheck, { enabled: false, share: 0.1 });
});

test("property: share 0 never randomizes; every spawn line says assigned router + routeBase = computed worker tier", async () => {
  for (const x of [0, 0.3, 0.999]) {
    const out = await run({ enabled: true, share: 0 }, () => x);
    for (const c of CASES) {
      const { e } = out[c.name];
      assert.equal(e.assigned, "router", c.name);
      assert.equal(e.routeBase, e.workerTier, c.name);
      assert.equal(e.routeBase === "qwen", c.qwen, c.name);
    }
  }
});

test("property: share 1 always sends qwen routes to T1 high (review unchanged) and never touches other routes", async () => {
  const base = await run({ enabled: false }, () => 0);
  for (const x of [0, 0.5, 0.999]) {
    const out = await run({ enabled: true, share: 1 }, () => x);
    for (const c of CASES) {
      const { r, e } = out[c.name];
      const b = base[c.name].e;
      assert.equal(e.routeBase, b.workerTier, c.name);
      assert.equal(e.reviewTier, b.reviewTier, `${c.name}: review obligation unchanged`);
      assert.equal(e.reviewEffort, b.reviewEffort, c.name);
      if (c.qwen) {
        assert.deepEqual([e.assigned, e.workerTier, e.workerEffort, r.model, r.thinkingLevel], ["random", "T1", "high", SONNET, "high"], c.name);
        assert.ok((e.reasons as string[]).some((s) => /randomized qwen → T1/.test(s)), c.name);
      } else {
        assert.deepEqual([e.assigned, e.workerTier, e.workerEffort, r.model], ["router", b.workerTier, b.workerEffort, base[c.name].r.model], c.name);
      }
    }
  }
});

test("enabled=false never randomizes, even at share 1", async () => {
  const out = await run({ enabled: false, share: 1 }, () => 0);
  for (const c of CASES) assert.equal(out[c.name].e.assigned, "router", c.name);
});

test("draft randomized to T1 keeps its review line in the brief", async () => {
  const out = await run({ enabled: true, share: 1 }, () => 0);
  assert.match(out.draft.r.briefAppend, /Review required: a fresh T1 high agent/);
});

test("rng < share decides: 0.19 < 0.2 randomizes, 0.2 does not", () => {
  const s = { ...TODAY, randomize: { enabled: true, share: 0.2 } };
  const q = { level: 0, step: 0 };
  const r = randomizeLeg(s, "write", q, 0, () => 0.19)!;
  assert.deepEqual([r.from, labelLeg(s, "write", r.worker, 0).leg.tier], ["qwen", "T1"]);
  assert.equal(randomizeLeg(s, "write", q, 0, () => 0.2), undefined);
});

test("a re-spawn with attemptOf and a qwen-pinned profile are never randomized", async () => {
  const h = harness({
    settings: { randomize: { enabled: true, share: 1 }, profiles: { cheap: { tier: "qwen", tools: "all", skills: [], report: "default" } } },
    extra: { rng: () => 0 } as never,
  });
  accepted(await h.a.spawn({ name: "p1", task: card({ kind: "cheap" }) }));
  accepted(await h.a.spawn({ name: "x1", task: card({ attemptOf: "nobody" }) }));
  for (const n of ["p1", "x1"]) h.a.emit({ type: "spawn", name: n, by: "main", parent: "main", childSessionId: `s-${n}`, ts: 1 });
  const [p1, x1] = ["p1", "x1"].map((n) => h.lines().find((l) => l.event === "spawn" && l.taskId === n)!);
  assert.deepEqual([p1.assigned, p1.workerTier], ["router", "qwen"]);
  assert.equal(x1.assigned, "router");
});

test("a randomized task that fails escalates from where it ran (T1 → T2)", async () => {
  const h = harness({ settings: { randomize: { enabled: true, share: 1 } }, extra: { rng: () => 0 } as never });
  accepted(await h.a.spawn({ name: "r1", task: card() }));
  const r2 = accepted(await h.a.spawn({ name: "r1b", task: card({ attemptOf: "r1" }) })) as any;
  assert.equal(r2.model, "anthropic/claude-opus-5-5");
});

// --- randomizeLeg (spec §6.1; T2.7) -----------------------------------------------------------


const RS = parseSettings({ randomize: { enabled: true, share: 0.2 } }).settings;

test("randomizeLeg: draws only at the bottom of the ability, enabled, rng() < share (0.19 yes, 0.2 no)", () => {
  assert.deepEqual(randomizeLeg(RS, "write", { level: 0, step: 0 }, 0, () => 0.19),
    { worker: { level: 1, step: 0 }, from: "qwen", reason: "randomized qwen → T1 (share 0.2)" });
  assert.equal(randomizeLeg(RS, "write", { level: 0, step: 0 }, 0, () => 0.2), undefined);
  assert.deepEqual(randomizeLeg(RS, "read", { level: 0, step: 0 }, 0, () => 0)?.worker, { level: 2, step: 0 });
});

test("randomizeLeg: rng is not called above the bottom or when disabled", () => {
  const boom = () => { throw new Error("rng called"); };
  assert.equal(randomizeLeg(RS, "write", { level: 1, step: 0 }, 0, boom), undefined);
  assert.equal(randomizeLeg(RS, "read", { level: 2, step: 1 }, 0, boom), undefined);
  const off = parseSettings({ randomize: { enabled: false, share: 1 } }).settings;
  assert.equal(randomizeLeg(off, "write", { level: 0, step: 0 }, 0, boom), undefined);
});
