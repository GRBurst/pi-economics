// AC1 (spec §8.2): the production plan layer, under the configuration that encodes today's models, equals the frozen oracle
// on the whole input grid. The counts are criteria: a different count means the grid changed, not the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EFFS, MODS, RNDS, SEQS, VARIANTS, firsts } from "./golden/grid.ts";
import { oracleRouter } from "./golden/oracle.ts";
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
