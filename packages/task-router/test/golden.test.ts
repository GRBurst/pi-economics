// AC1 (spec §8.2): the production plan layer, under the configuration that encodes today's models, equals the frozen oracle
// on the whole input grid. The counts are criteria: a different count means the grid changed, not the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EFFS, MODS, RNDS, SEQS, VARIANTS, firsts } from "./golden/grid.ts";
import { oracleRouter, type Delta } from "./golden/oracle.ts";
import { sutRouter } from "./golden/sut.ts";

const oracle = oracleRouter();
const sut = sutRouter();

test("today-config: plan grid == oracle", () => {
  let n = 0, bad = 0;
  const ex = new Map<string, string>(); // the first differing case per (variant, kind, importance, t2 mode)
  for (const v of VARIANTS)
    for (const f of firsts(v))
      for (const rnd of RNDS)
        for (const seq of SEQS) {
          n++;
          const c = { ...f, rnd, seq };
          const want = oracle.seq(v, c), got = sut.seq(v, c);
          if (want === got) continue;
          bad++;
          const key = `${v.name} ${c.kind} ${c.imp} ${c.t2m}`;
          if (!ex.has(key)) ex.set(key, `${v.name} ${c.kind} t0=${c.bits} ${c.t2m} ${c.imp} rnd=${rnd} seq=${seq}: want ${want} got ${got}`);
        }
  assert.equal(n, 146880);
  assert.equal(bad, 0, `${bad} plan cases differ; first per (variant kind importance t2):\n${[...ex.values()].slice(0, 20).join("\n")}`);
});

test("today-config: explicit grid == oracle", () => {
  let n = 0, bad = 0;
  const ex = new Map<string, string>();
  for (const v of VARIANTS)
    for (const f of firsts(v))
      for (const m of MODS)
        for (const e of EFFS) {
          n++;
          const want = oracle.explicit(v, f, m, e), got = sut.explicit(v, f, m, e);
          if (want === got) continue;
          bad++;
          const key = `${v.name} ${f.kind} ${f.imp} ${f.t2m} ${m} ${e}`;
          if (!ex.has(key)) ex.set(key, `${v.name} ${f.kind} t0=${f.bits} ${f.t2m} ${f.imp} m=${m} e=${e}: want ${want} got ${got}`);
        }
  assert.equal(n, 470016);
  assert.equal(bad, 0, `${bad} explicit cases differ; first per (variant kind importance t2 model effort):\n${[...ex.values()].slice(0, 20).join("\n")}`);
});

// Default delta (spec §8.2, HS §9 M5; plan T5.1): under the defaults the production grid equals the oracle with the ACTIVE
// deltas' wrappers, and that expectation differs from the plain oracle in exactly Σ COUNTS[ACTIVE] cases (r4 results.txt).
// Each flip of T5.2–T5.5 adds its delta to ACTIVE.
const ACTIVE = new Set<Delta>(["D12", "D1", "D3"]);
const COUNTS: Record<Delta, { plan: number; explicit: number }> = {
  D12: { plan: 960, explicit: 576 }, D1: { plan: 45, explicit: 15 }, D15: { plan: 6912, explicit: 0 },
  D11: { plan: 0, explicit: 6456 }, D3: { plan: 0, explicit: 2364 },
};
const want = (k: "plan" | "explicit") => Object.fromEntries([...ACTIVE].map((d) => [d, COUNTS[d][k]]).filter(([, n]) => n !== 0));
const expect = oracleRouter(ACTIVE);
const sutD = sutRouter({});
/** The delta a differing case is counted under (r4 grid.mts): the explicit model's delta first, then the plan's. */
const deltaOf = (f: Set<Delta>): string => (["D3", "D11", "D12", "D1", "D15"] as Delta[]).find((d) => f.has(d)) ?? "other";
const bump = (o: Record<string, number>, k: string) => void (o[k] = (o[k] ?? 0) + 1);

test("defaults: plan grid == oracle + ACTIVE; expectation vs oracle per delta == COUNTS[ACTIVE]", () => {
  let n = 0, bad = 0;
  const by: Record<string, number> = {}, ex: string[] = [];
  for (const v of VARIANTS)
    for (const f of firsts(v))
      for (const rnd of RNDS)
        for (const seq of SEQS) {
          n++;
          const c = { ...f, rnd, seq };
          const w = expect.seq(v, c), fired = expect.fired();
          if (w !== oracle.seq(v, c)) bump(by, deltaOf(fired));
          const got = sutD.seq(v, c);
          if (w === got) continue;
          bad++;
          if (ex.length < 20) ex.push(`${v.name} ${c.kind} t0=${c.bits} ${c.t2m} ${c.imp} rnd=${rnd} seq=${seq}: want ${w} got ${got}`);
        }
  assert.equal(n, 146880);
  assert.equal(bad, 0, `${bad} plan cases differ from the expectation:\n${ex.join("\n")}`);
  assert.deepEqual(by, want("plan"));
});

test("defaults: explicit grid == oracle + ACTIVE; expectation vs oracle per delta == COUNTS[ACTIVE]", () => {
  let n = 0, bad = 0;
  const by: Record<string, number> = {}, ex: string[] = [];
  for (const v of VARIANTS)
    for (const f of firsts(v))
      for (const m of MODS)
        for (const e of EFFS) {
          n++;
          const w = expect.explicit(v, f, m, e), fired = expect.fired();
          if (w !== oracle.explicit(v, f, m, e)) bump(by, deltaOf(fired));
          const got = sutD.explicit(v, f, m, e);
          if (w === got) continue;
          bad++;
          if (ex.length < 20) ex.push(`${v.name} ${f.kind} t0=${f.bits} ${f.t2m} ${f.imp} m=${m} e=${e}: want ${w} got ${got}`);
        }
  assert.equal(n, 470016);
  assert.equal(bad, 0, `${bad} explicit cases differ from the expectation:\n${ex.join("\n")}`);
  assert.deepEqual(by, want("explicit"));
});
