// Local mode L3.T6 (design §2.2.3, plan S13, D19, X1): `composeGuards` — guards run in order, the first block wins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeGuards } from "../core/toolguard.ts";
import type { ToolGuard } from "../core/toolguard.ts";

test("composeGuards: nothing to compose → undefined", () => {
  assert.equal(composeGuards(), undefined);
  assert.equal(composeGuards(undefined), undefined);
  assert.equal(composeGuards(undefined, undefined), undefined);
});

test("composeGuards property: the first guard's block wins; every guard up to it is called, none after it", () => {
  let seed = 7;
  const rnd = (n: number): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296 * n) | 0;
  };
  const tools = ["read", "edit", "write", "bash"];
  for (let s = 0; s < 300; s++) {
    const k = rnd(5);
    // guard j blocks the tools in its table with "g<j>:<tool>"; some slots are undefined
    const tables = Array.from({ length: k }, () => (rnd(4) === 0 ? undefined : tools.filter(() => rnd(3) === 0)));
    const calls: number[] = [];
    const guards: (ToolGuard | undefined)[] = tables.map((tb, j) => tb && ((tool: string, input: unknown) => {
      calls.push(j);
      assert.deepEqual(input, { path: "a" });
      return tb.includes(tool) ? `g${j}:${tool}` : undefined;
    }));
    const g = composeGuards(...guards);
    if (tables.every((tb) => tb === undefined)) { assert.equal(g, undefined, `sequence ${s}`); continue; }
    for (const tool of tools) {
      calls.length = 0;
      const first = tables.findIndex((tb) => tb?.includes(tool));
      assert.equal(g!(tool, { path: "a" }), first < 0 ? undefined : `g${first}:${tool}`, `sequence ${s}, ${tool}`);
      const upTo = first < 0 ? tables.length : first + 1;
      assert.deepEqual(calls, tables.map((tb, j) => (tb && j < upTo ? j : -1)).filter((j) => j >= 0), `sequence ${s}, ${tool}: call log`);
    }
  }
});
