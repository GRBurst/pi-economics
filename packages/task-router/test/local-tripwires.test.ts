// Local mode L3.T1–T2 (design §3.1.1, plan S10): the pure tripwire detectors over the main session's call records.
// Each trip fires at its threshold and not one record earlier (AC-H1), checked against a reference counter written
// independently (streaming, over the whole history) on seeded random sequences; a tree change resets identical-call (AC-H3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { callTrips, changed, errSig, push, stableJson, trigramJaccard, windowSize } from "../core/local/tripwires.ts";
import type { CallRecord, Trip } from "../core/local/tripwires.ts";
import { defaults } from "../core/settings.ts";

const H = defaults().hints;
const trips = (ring: CallRecord[]): Trip[] => callTrips(ring, H);
const read = (key: string, turn = 0): CallRecord => ({ tool: "read", key, isWrite: false, turn });
/** A write: `before`/`after` are the file hashes (undefined = the hash failed). */
const write = (key: string, before: string | undefined, after: string | undefined, o: Partial<CallRecord> = {}): CallRecord =>
  ({ tool: "edit", key, isWrite: true, path: "/work/a.ts", hashBefore: before, hashAfter: after, turn: 0, ...o });
/** Seeded LCG (as in test/verify.test.ts): reproducible sequences. */
const lcg = (seed: number) => (n: number): number => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % n);

test("stableJson: key order does not matter, values do; arrays keep their order", () => {
  assert.equal(stableJson({ a: 1, b: { c: [1, 2], d: "x" } }), stableJson({ b: { d: "x", c: [1, 2] }, a: 1 }));
  assert.notEqual(stableJson({ a: 1 }), stableJson({ a: 2 }));
  assert.notEqual(stableJson([1, 2]), stableJson([2, 1]));
  assert.equal(stableJson({ a: undefined, b: 1 }), stableJson({ b: 1 }));
});

test("errSig: lowercase, digits → #, whitespace collapsed and trimmed, cut at 500", () => {
  assert.equal(errSig("  Error at LINE 12:\n\tfoo   bar 7 "), "error at line ##: foo bar #");
  assert.equal(errSig("x".repeat(600)).length, 500);
});

test("trigramJaccard: 1 on equal, 0 on disjoint, symmetric, in [0, 1]", () => {
  assert.equal(trigramJaccard("abcdef", "abcdef"), 1);
  assert.equal(trigramJaccard("", ""), 1);
  assert.equal(trigramJaccard("abcdef", "uvwxyz"), 0);
  assert.equal(trigramJaccard("ab", "cd"), 0);
  const xs = ["error: x", "error: y", "cannot find module a", "cannot find module b", "", "ab", "zzzz"];
  for (const a of xs) for (const b of xs) {
    const j = trigramJaccard(a, b);
    assert.equal(j, trigramJaccard(b, a), `${a} / ${b}`);
    assert.ok(j >= 0 && j <= 1, `${a} / ${b}: ${j}`);
  }
  // abcd → {abc, bcd}; abce → {abc, bce}: 1 shared of 3
  assert.equal(trigramJaccard("abcd", "abce"), 1 / 3);
});

test("changed: a write whose hash after differs from before (a new file too); not a failed hash, not a read", () => {
  assert.equal(changed(write("k", "h0", "h1")), true);
  assert.equal(changed(write("k", undefined, "h1")), true);
  assert.equal(changed(write("k", "h0", "h0")), false);
  assert.equal(changed(write("k", "h0", undefined)), false);
  assert.equal(changed(read("k")), false);
});

test("push: keeps the last windowSize records", () => {
  assert.equal(windowSize(H), 4 * H.identicalCalls + 8);
  let ring: CallRecord[] = [];
  for (let i = 0; i < 50; i++) ring = push(ring, read(`k${i}`), H);
  assert.equal(ring.length, windowSize(H));
  assert.equal(ring.at(-1)!.key, "k49");
  assert.equal(ring[0].key, `k${50 - windowSize(H)}`);
});

test("AC-H1 identical-call: threshold − 1 identical calls → none, the threshold → fires", () => {
  const ks = Array.from({ length: H.identicalCalls }, () => read("read:k"));
  assert.deepEqual(trips(ks.slice(0, -1)), []);
  assert.deepEqual(trips(ks), ["identical-call"]);
});

test("AC-H1 no-change-writes: threshold − 1 writes that changed nothing → none, the threshold → fires", () => {
  // distinct keys (no identical-call), distinct paths and failed edits (no churn), no error text (no repeated-error)
  const ws = Array.from({ length: H.noChangeWrites }, (_, i) => write(`edit:${i}`, "h0", "h0", { path: `/work/f${i}.ts`, isError: true }));
  assert.deepEqual(trips(ws.slice(0, -1)), []);
  assert.deepEqual(trips(ws), ["no-change-writes"]);
});

test("AC-H1 alternation: A, B, A → none; A, B, A, B → fires; a tree change inside → none", () => {
  const seq = Array.from({ length: 2 * H.alternations }, (_, i) => read(i % 2 ? "read:b" : "read:a"));
  assert.deepEqual(trips(seq.slice(0, -1)), []);
  assert.deepEqual(trips(seq), ["alternation"]);
  const w = [write("edit:a", "h0", "h1"), read("read:b"), write("edit:a", "h1", "h1"), read("read:b")];
  assert.deepEqual(trips(w), []);
});

test("AC-H3: k, k, (a changed write), k → no identical-call; k, k, k → fires", () => {
  const k = read("read:k");
  assert.deepEqual(trips([k, k, write("edit:x", "h0", "h1"), k]), []);
  assert.deepEqual(trips([k, k, k]), ["identical-call"]);
  // a write that changed nothing is no progress (plan D15)
  assert.deepEqual(trips([k, k, write("edit:x", "h0", "h0"), k]), ["identical-call"]);
});

// ---- reference counters: streaming over the whole history, written apart from the detectors (S10 definitions) ----
type Ref = (r: CallRecord) => boolean;
/** identical-call: per key, the calls since the last tree change; a changed write starts the new count with itself. */
const refIdentical = (): Ref => {
  let since = new Map<string, number>();
  return (r) => {
    const c = (since.get(r.key) ?? 0) + 1;
    since.set(r.key, c);
    if (changed(r)) since = new Map([[r.key, 1]]);
    return c >= H.identicalCalls;
  };
};
/** no-change-writes: the run of hashed writes that left their hash unchanged; a failed hash does not count (§3.1.4). */
const refNoChange = (): Ref => {
  let run = 0;
  return (r) => {
    const hashed = r.isWrite && r.hashBefore !== undefined && r.hashAfter !== undefined;
    if (!hashed) return false;
    run = r.hashBefore === r.hashAfter ? run + 1 : 0;
    return run >= H.noChangeWrites;
  };
};
/** alternation: the length of the alternating suffix, and the records since the last tree change. */
const refAlternation = (): Ref => {
  const keys: string[] = [];
  let alt = 0, clean = 0;
  return (r) => {
    const n = keys.push(r.key);
    alt = n >= 2 && keys[n - 1] !== keys[n - 2] ? (n >= 3 && keys[n - 1] === keys[n - 3] ? alt + 1 : 2) : 1;
    clean = changed(r) ? 0 : clean + 1;
    const m = 2 * H.alternations;
    return alt >= m && clean >= m;
  };
};

/** A random record: 3 keys, 2 paths, reads and writes, hashes from {⊥, h0, h1} (so changed, unchanged and failed). */
const randomRecord = (rnd: (n: number) => number, turn: number): CallRecord => {
  const k = rnd(3), hashes = [undefined, "h0", "h1"];
  if (rnd(2)) return read(`read:${k}`, turn);
  const r = write(`edit:${k}`, hashes[rnd(3)], hashes[rnd(3)], { path: `/work/p${rnd(2)}.ts`, turn });
  return rnd(4) === 0 ? { ...r, hashAfter: r.hashBefore } : r;
};

test("AC-H1 property: identical-call, no-change-writes and alternation fire exactly where the reference counters do", () => {
  const rnd = lcg(20261002);
  const fired: Record<string, number> = {};
  for (let s = 0; s < 400; s++) {
    const len = 1 + rnd(windowSize(H));
    const refs: [Trip, Ref][] = [["identical-call", refIdentical()], ["no-change-writes", refNoChange()], ["alternation", refAlternation()]];
    let ring: CallRecord[] = [], turn = 0;
    for (let i = 0; i < len; i++) {
      turn += rnd(2);
      const r = randomRecord(rnd, turn);
      ring = push(ring, r, H);
      const got = trips(ring);
      for (const [trip, ref] of refs) {
        const want = ref(r);
        assert.equal(got.includes(trip), want, `${trip}, sequence ${s}, record ${i}: ${JSON.stringify(ring.map((x) => [x.key, x.hashBefore, x.hashAfter]))}`);
        if (want) fired[trip] = (fired[trip] ?? 0) + 1;
      }
    }
  }
  for (const t of ["identical-call", "no-change-writes", "alternation"]) assert.ok((fired[t] ?? 0) > 5, `${t} fired ${fired[t] ?? 0} times: the generator is too weak`);
});
