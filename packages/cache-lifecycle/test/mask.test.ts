import { test } from "node:test";
import assert from "node:assert/strict";
import { planMasks, stub, type Entry } from "../core/mask.ts";

// Seeded generator: properties run over many lists, reproducibly.
function rng(seed: number) {
  let s = seed >>> 0;
  return (n: number) => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s % n);
}
const kinds: Entry["kind"][] = ["toolResult", "thinking", "other", "toolResult", "other"];
function entries(seed: number, len = 1 + (seed % 40)): Entry[] {
  const r = rng(seed);
  return Array.from({ length: len }, (_, i) => {
    const kind = kinds[r(kinds.length)];
    return { id: `${kind}:${i}`, role: kind === "toolResult" ? "toolResult" : "assistant", kind, tokens: 1 + r(500) };
  });
}
const seeds = Array.from({ length: 300 }, (_, i) => i + 1);
const tails = [0, 1, 50, 700, 20000];
const levels: ("tools" | "thinking")[][] = [[], ["tools"], ["thinking"], ["tools", "thinking"]];
const total = (es: Entry[]) => es.reduce((a, e) => a + e.tokens, 0);
const none = new Set<string>();

function unmaskedSuffixTokens(es: Entry[], m: ReadonlySet<string>): number {
  let t = 0;
  for (let i = es.length - 1; i >= 0 && !m.has(es[i].id); i--) t += es[i].tokens;
  return t;
}

test("masks tool results older than the protected tail, keeps the tail", () => {
  const es: Entry[] = [
    { id: "tool:a", role: "toolResult", kind: "toolResult", tokens: 100 },
    { id: "think:r:0", role: "assistant", kind: "thinking", tokens: 100 },
    { id: "msg:2", role: "assistant", kind: "other", tokens: 100 },
    { id: "tool:b", role: "toolResult", kind: "toolResult", tokens: 100 },
    { id: "tool:c", role: "toolResult", kind: "toolResult", tokens: 100 },
  ];
  assert.deepEqual([...planMasks(es, none, 200, ["tools"])], ["tool:a"]);
  assert.deepEqual([...planMasks(es, none, 200, ["tools", "thinking"])].sort(), ["think:r:0", "tool:a"]);
  assert.deepEqual([...planMasks(es, none, 200, [])], []);
  assert.deepEqual([...planMasks(es, none, 10_000, ["tools"])], [], "transcript smaller than the tail: nothing masked");
});

test("P-tail: the unmasked suffix holds at least min(tail, total) tokens", () => {
  for (const seed of seeds) for (const tail of tails) for (const inc of levels) {
    const es = entries(seed);
    const m = planMasks(es, none, tail, inc);
    assert.ok(unmaskedSuffixTokens(es, m) >= Math.min(tail, total(es)), `seed ${seed} tail ${tail}`);
  }
});

test("only entries of an included kind are ever masked", () => {
  for (const seed of seeds) for (const inc of levels) {
    const es = entries(seed);
    const ok = new Set(es.filter((e) => (e.kind === "toolResult" && inc.includes("tools")) || (e.kind === "thinking" && inc.includes("thinking"))).map((e) => e.id));
    for (const id of planMasks(es, none, 100, inc)) assert.ok(ok.has(id), `${id} masked at ${inc}`);
  }
});

test("P-idem: planning again over the same entries changes nothing", () => {
  for (const seed of seeds) for (const tail of tails) {
    const es = entries(seed);
    const once = planMasks(es, none, tail, ["tools", "thinking"]);
    assert.deepEqual([...planMasks(es, once, tail, ["tools", "thinking"])].sort(), [...once].sort());
  }
});

test("P-stable: masks only grow as the transcript grows, whatever the tail setting", () => {
  for (const seed of seeds) {
    const es = entries(seed, 30);
    let m: ReadonlySet<string> = none;
    for (let k = 1; k <= es.length; k++) {
      const next = planMasks(es.slice(0, k), m, tails[(seed + k) % tails.length], ["tools", "thinking"]);
      for (const id of m) assert.ok(next.has(id), `seed ${seed} k ${k}: ${id} was unmasked`);
      m = next;
    }
  }
});

test("P-stable: ids from outside the list (other branch, earlier run) are kept", () => {
  const m = planMasks(entries(7), new Set(["tool:gone"]), 100, ["tools"]);
  assert.ok(m.has("tool:gone"));
});

test("stub names the tool and call, and is deterministic", () => {
  assert.equal(stub("tool:call_1", 1234, "bash"), "[elided after cache expiry: 1234 tok; tool bash call call_1; re-run if needed]");
  assert.equal(stub("tool:call_1", 1234, "bash"), stub("tool:call_1", 1234, "bash"));
});
