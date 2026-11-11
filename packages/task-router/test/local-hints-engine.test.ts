// Local mode L3.T3 (design §3.1.2, plan S11, D14): the fixed hint texts, the `<router-hint>` block, and the pure engine —
// a hint per trip outside its cooldown, the fixed escalation once a trip persists (AC-H2 pure, AC-H4 L3 part).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ESCALATION, HINT_TEXT, block, createHintEngine } from "../core/local/hints.ts";
import type { Delivery } from "../core/local/hints.ts";
import { TRIPS } from "../core/local/tripwires.ts";
import type { Trip } from "../core/local/tripwires.ts";
import { defaults } from "../core/settings.ts";

const D = defaults(), H = D.hints, P = D.plans;
/** S11 under defaults (plan Q7: pinned as written). */
const PINNED: Record<Trip, string> = {
  "identical-call": "You ran this exact call 3 times; its result will not change. Use the result you have, or change the approach.",
  "no-change-writes": "4 writes changed nothing. Re-read the file before editing; oldText must match exactly.",
  alternation: "You alternated between the same two calls 2 times and no file changed. Change the approach.",
  "repeated-error": "The same error came back 2 times in a row. Fix its cause; do not repeat the call unchanged.",
  churn: "You wrote the same file 3 times within 4 turns. Re-read it, decide the whole change, then write it once.",
  "check-failing": "The check failed 2 times in a row. If the cause is unclear, spawn a debug-design card (files, check, acceptance).",
  "over-size": "This branch exceeds 100 changed lines or 3 files. Commit what passes and split the rest.",
  "risky-path": "This path matches a risk rule. Keep the change minimal and spawn a review card for it (the file and its check).",
  "context-soft": "Context is above 32k tokens. Fold finished work or hand off with a task card.",
  "context-stall": "Context is above 85 % and nothing changed for 25 turns. Hand the rest to a fresh agent with a task card, or fold finished work.",
  "outside-worktree": "write in the worktree; use absolute paths under it", // L5.T7: raised by the write guard
};

test("HINT_TEXT: the pinned text of every trip under defaults; ESCALATION", () => {
  assert.deepEqual(Object.keys(HINT_TEXT).sort(), [...TRIPS].sort());
  for (const t of TRIPS) assert.equal(HINT_TEXT[t](H, P), PINNED[t], t);
  assert.equal(ESCALATION, "This persists after the hints. Spawn a debug-design card for it; the router will route it to Sonnet or above.");
});

test("HINT_TEXT: the numbers come from the settings", () => {
  const h = { ...H, identicalCalls: 7, contextSoftTokens: 64500, contextPercent: 90, stallTurns: 9 };
  assert.match(HINT_TEXT["identical-call"](h, P), /this exact call 7 times/);
  assert.match(HINT_TEXT["context-soft"](h, P), /above 65k tokens/);
  assert.match(HINT_TEXT["context-stall"](h, P), /above 90 % and nothing changed for 9 turns/);
  assert.match(HINT_TEXT["over-size"](h, { ...P, splitLines: 40, splitFiles: 2 }), /exceeds 40 changed lines or 2 files/);
});

test("block: the <router-hint> element", () => {
  assert.equal(block("churn", 2, "text."), '<router-hint trip="churn" n="2">text.</router-hint>');
});

test("engine: first detection → hint n 1; within cooldownCalls → nothing; after it → hint n = the count", () => {
  const e = createHintEngine(H, P);
  assert.deepEqual(e.detected(["identical-call"], 1), [{ trip: "identical-call", n: 1, stage: "hint", text: PINNED["identical-call"] }]);
  e.progress(); // counts reset, the cooldown stays
  assert.deepEqual(e.detected(["identical-call"], 1 + H.cooldownCalls), []);
  assert.deepEqual(e.detected(["identical-call"], 2 + H.cooldownCalls), [{ trip: "identical-call", n: 2, stage: "hint", text: PINNED["identical-call"] }]);
});

test("engine: detection 1 + persistTrips without progress → the escalation (never suppressed); counts reset", () => {
  const e = createHintEngine(H, P);
  const out: Delivery[][] = [];
  for (let c = 1; c <= 1 + H.persistTrips; c++) out.push(e.detected(["identical-call"], c));
  assert.deepEqual(out.slice(0, -1), [[{ trip: "identical-call", n: 1, stage: "hint", text: PINNED["identical-call"] }], ...Array(H.persistTrips - 1).fill([])]);
  assert.deepEqual(out.at(-1), [{ trip: "identical-call", n: 1 + H.persistTrips, stage: "steer", text: ESCALATION }]);
  // the count starts again: persistTrips more detections are quiet (cooldown), the next escalates again
  const c0 = 2 + H.persistTrips;
  for (let c = c0; c < c0 + H.persistTrips; c++) assert.deepEqual(e.detected(["identical-call"], c), [], `call ${c}`);
  assert.equal(e.detected(["identical-call"], c0 + H.persistTrips)[0]?.stage, "steer");
});

test("engine: trips count apart", () => {
  const e = createHintEngine(H, P);
  const stages = (ts: Trip[], c: number) => e.detected(ts, c).map((d) => `${d.trip} ${d.stage}`);
  assert.deepEqual(stages(["churn", "alternation"], 1), ["churn hint", "alternation hint"]);
  for (let c = 2; c <= H.persistTrips; c++) assert.deepEqual(stages(["churn"], c), [], `call ${c}`);
  assert.deepEqual(stages(["churn", "alternation"], 1 + H.persistTrips), ["churn steer"]);
});

test("engine: progress() resets every count", () => {
  const e = createHintEngine(H, P);
  for (let c = 1; c <= H.persistTrips; c++) e.detected(["churn"], c);
  e.progress();
  for (let c = 1 + H.persistTrips; c <= 2 * H.persistTrips; c++) assert.deepEqual(e.detected(["churn"], c), [], `call ${c}`);
  assert.deepEqual(e.detected(["churn"], 1 + 2 * H.persistTrips).map((d) => d.stage), ["steer"]);
});

test("engine property: #escalations = Σ ⌊detections / (1 + persistTrips)⌋ over progress-free runs; hints of a trip > cooldownCalls apart", () => {
  let seed = 99;
  const rnd = (n: number): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296 * n) | 0;
  };
  const pool: Trip[] = ["identical-call", "churn", "context-stall"];
  let steers = 0, hints = 0;
  for (let s = 0; s < 300; s++) {
    const h = { ...H, cooldownCalls: rnd(6), persistTrips: 1 + rnd(3) };
    const e = createHintEngine(h, P);
    const run = new Map<Trip, number>(), want = new Map<Trip, number>(), got = new Map<Trip, number>(), last = new Map<Trip, number>();
    const close = () => { for (const [t, k] of run) want.set(t, (want.get(t) ?? 0) + Math.floor(k / (1 + h.persistTrips))); run.clear(); };
    let call = 0;
    for (let i = 0; i < 60; i++) {
      if (rnd(8) === 0) { e.progress(); close(); continue; }
      call += rnd(3) === 0 ? 0 : 1; // a turn-end detection shares the call number of the last result
      const ts = pool.filter(() => rnd(2) === 0);
      for (const t of ts) run.set(t, (run.get(t) ?? 0) + 1);
      for (const d of e.detected(ts, call)) {
        if (d.stage === "steer") { got.set(d.trip, (got.get(d.trip) ?? 0) + 1); steers++; assert.equal(d.text, ESCALATION); continue; }
        hints++;
        assert.equal(d.text, HINT_TEXT[d.trip](h, P));
        const prev = last.get(d.trip);
        assert.ok(prev === undefined || call - prev > h.cooldownCalls, `sequence ${s}: ${d.trip} hinted at ${prev} and ${call} (cooldown ${h.cooldownCalls})`);
        last.set(d.trip, call);
      }
    }
    close();
    for (const t of pool) assert.equal(got.get(t) ?? 0, want.get(t) ?? 0, `sequence ${s}: escalations of ${t}`);
  }
  assert.ok(steers > 50 && hints > 50, `steers ${steers}, hints ${hints}: the generator is too weak`);
});
