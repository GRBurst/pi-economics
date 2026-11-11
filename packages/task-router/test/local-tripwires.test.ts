// Local mode L3.T1–T2 (design §3.1.1, plan S10): the pure tripwire detectors over the main session's call records.
// Each trip fires at its threshold and not one record earlier (AC-H1), checked against a reference counter written
// independently (streaming, over the whole history) on seeded random sequences; a tree change resets identical-call (AC-H3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { callTrips, changed, contextSoft, contextStall, errSig, push, riskGlobsOf, stableJson, trigramJaccard, windowSize } from "../core/local/tripwires.ts";
import type { CallRecord, Risk, Trip } from "../core/local/tripwires.ts";
import { defaults } from "../core/settings.ts";

const H = defaults().hints;
const NO_RISK: Risk = { globs: [], seen: new Set(), rel: (p) => p };
const trips = (ring: CallRecord[], risk = NO_RISK): Trip[] => callTrips(ring, H, risk);
const read = (key: string, turn = 0): CallRecord => ({ tool: "read", key, isWrite: false, turn });
/** A write: `before`/`after` are the file hashes (undefined = the hash failed). */
const write = (key: string, before: string | undefined, after: string | undefined, o: Partial<CallRecord> = {}): CallRecord =>
  ({ tool: "edit", key, isWrite: true, path: "/work/a.ts", hashBefore: before, hashAfter: after, turn: 0, ...o });
/** Seeded mulberry32 (an LCG's low bits cycle, so `% 2` would alternate): reproducible sequences, an integer in [0, n). */
const seeded = (seed: number) => (n: number): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296 * n) | 0;
};

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
  const rnd = seeded(20261002);
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

// ---- L3.T2: repeated-error, churn, risky-path, context-soft, context-stall ----
const ERR = {
  foo: (line: number) => `TypeError: Cannot read properties of undefined (reading 'foo') at /work/src/a.ts:${line}:5`,
  fooB: (line: number) => `TypeError: Cannot read properties of undefined (reading 'foo') at /work/src/b.ts:${line}:5`,
  bar: (line: number) => `TypeError: Cannot read properties of undefined (reading 'bar') at /work/src/a.ts:${line}:5`,
  enoent: (line: number) => `ENOENT: no such file or directory, open '/work/src/x${line}.ts'`,
};
const failing = (tool: string, key: string, text: string | undefined): CallRecord =>
  ({ tool, key, isWrite: false, isError: true, ...(text === undefined ? {} : { errSig: errSig(text) }), turn: 0 });

test("the error templates: one digit varying is the same signature; foo/fooB similar, foo/bar and foo/enoent not", () => {
  assert.equal(errSig(ERR.foo(1)), errSig(ERR.foo(7)));
  assert.ok(trigramJaccard(errSig(ERR.foo(1)), errSig(ERR.fooB(1))) >= H.errorSimilarity);
  assert.ok(trigramJaccard(errSig(ERR.foo(1)), errSig(ERR.bar(1))) < H.errorSimilarity);
  assert.ok(trigramJaccard(errSig(ERR.foo(1)), errSig(ERR.enoent(1))) < H.errorSimilarity);
});

test("AC-H1 repeated-error: threshold − 1 similar failures → none, the threshold → fires; another tool or error breaks it", () => {
  const fs = Array.from({ length: H.repeatedErrors }, (_, i) => failing("bash", `bash:${i}`, ERR.foo(i)));
  assert.deepEqual(trips(fs.slice(0, -1)), []);
  assert.deepEqual(trips(fs), ["repeated-error"]);
  assert.deepEqual(trips([failing("read", "read:0", ERR.foo(1)), failing("bash", "bash:1", ERR.foo(2))]), []);
  assert.deepEqual(trips([failing("bash", "bash:0", ERR.foo(1)), failing("bash", "bash:1", ERR.bar(2))]), []);
  assert.deepEqual(trips([failing("bash", "bash:0", undefined), failing("bash", "bash:1", undefined)]), []);
});

test("AC-H1 churn: threshold − 1 writes of one path within churnTurns turns → none, the threshold → fires; older turns do not count", () => {
  const ws = Array.from({ length: H.churnEdits }, (_, i) => write(`edit:${i}`, `h${i}`, `h${i + 1}`, { turn: i }));
  assert.deepEqual(trips(ws.slice(0, -1)), []);
  assert.deepEqual(trips(ws), ["churn"]);
  const spread = ws.map((w, i) => ({ ...w, turn: i * H.churnTurns }));
  assert.deepEqual(trips(spread), []);
  const failed = ws.map((w, i) => (i === 0 ? { ...w, isError: true } : w));
  assert.deepEqual(trips(failed), []);
});

test("AC-H1 risky-path: a write under riskGlobs or a critical pathRules glob fires once per path; a high rule never", () => {
  const s = { ...defaults(), pathRules: [{ glob: "infra/**", level: "critical" as const }, { glob: "docs/**", level: "high" as const }] };
  const globs = riskGlobsOf(s);
  assert.deepEqual(globs, [...defaults().riskGlobs, "infra/**"]);
  const seen = new Set<string>();
  const risk: Risk = { globs, seen, rel: (p) => p.replace(/^\/work\//, "") };
  const at = (path: string, o: Partial<CallRecord> = {}) => write(`edit:${path}`, "h0", "h1", { path, ...o });
  const run = (r: CallRecord): Trip[] => {
    const t = trips([r], risk);
    if (t.includes("risky-path")) seen.add(r.path!); // the engine's part (plan S10)
    return t;
  };
  assert.deepEqual(run(at("/work/src/a.ts")), []);
  assert.deepEqual(run(at("/work/docs/a.md")), []);
  assert.deepEqual(run(at("/work/src/auth/login.ts", { isError: true })), []);
  assert.deepEqual(run(read("read:/work/src/auth/login.ts")), []);
  assert.deepEqual(run(at("/work/src/auth/login.ts")), ["risky-path"]);
  assert.deepEqual(run(at("/work/src/auth/login.ts")), []);
  assert.deepEqual(run(at("/work/infra/main.tf")), ["risky-path"]);
  assert.deepEqual(run(at("/work/infra/main.tf")), []);
});

test("AC-H1 context-soft: fires on the first crossing, not again until the tokens fall below and cross again", () => {
  const T = H.contextSoftTokens;
  let armed = true;
  const step = (t: number | undefined): boolean => { const x = contextSoft(armed, t, H); armed = x.armed; return x.fire; };
  assert.deepEqual([T - 1, T, undefined].map(step), [false, false, false]);
  assert.deepEqual([T + 1, T + 5000, T, T + 1].map(step), [true, false, false, false]);
  assert.deepEqual([T - 1, T + 1, T + 2].map(step), [false, true, false]);
});

test("AC-H1 context-stall: fires at exactly stallTurns turns at ≥ contextPercent without progress; progress resets", () => {
  let stall = 0;
  const turn = (p: number | undefined, progress = false): boolean => { const x = contextStall(stall, progress, p, H); stall = x.stall; return x.fire; };
  const hi = H.contextPercent;
  for (let i = 0; i < H.stallTurns - 1; i++) assert.equal(turn(hi), false, `turn ${i}`);
  assert.equal(turn(hi + 1), true);
  for (let i = 0; i < H.stallTurns - 1; i++) assert.equal(turn(hi), false, `after the fire, turn ${i}`);
  assert.equal(turn(hi, true), false); // progress: the count starts again
  for (let i = 0; i < H.stallTurns - 1; i++) assert.equal(turn(hi), false, `after progress, turn ${i}`);
  assert.equal(turn(hi - 1), false); // below the percent: no count
  assert.equal(turn(undefined), false);
  assert.equal(turn(hi), true);
});

/** repeated-error: the run of failures of one tool with similar signatures. */
const refRepeated = (): Ref => {
  let run = 0, prev: CallRecord | undefined;
  return (r) => {
    const counts = r.isError === true && r.errSig !== undefined;
    run = !counts ? 0
      : prev && run > 0 && prev.tool === r.tool && trigramJaccard(prev.errSig!, r.errSig!) >= H.errorSimilarity ? run + 1 : 1;
    prev = r;
    return run >= H.repeatedErrors;
  };
};
/** churn: every successful write so far, by path and turn. */
const refChurn = (): Ref => {
  const ws: CallRecord[] = [];
  return (r) => {
    if (!(r.isWrite && !r.isError && r.path !== undefined)) return false;
    ws.push(r);
    return ws.filter((w) => w.path === r.path && w.turn > r.turn - H.churnTurns).length >= H.churnEdits;
  };
};

test("AC-H1 property: repeated-error and churn fire exactly where the reference counters do", () => {
  const rnd = seeded(4711);
  const fired: Record<string, number> = {};
  const texts = [ERR.foo, ERR.fooB, ERR.bar, ERR.enoent];
  for (let s = 0; s < 400; s++) {
    const len = 1 + rnd(windowSize(H));
    const refs: [Trip, Ref][] = [["repeated-error", refRepeated()], ["churn", refChurn()]];
    let ring: CallRecord[] = [], turn = 0;
    for (let i = 0; i < len; i++) {
      turn += rnd(3) === 0 ? 1 : 0;
      const tool = ["bash", "read", "edit"][rnd(3)], isError = rnd(2) > 0;
      const text = rnd(5) === 0 ? undefined : texts[rnd(texts.length)](rnd(10));
      const base: CallRecord = { tool, key: `${tool}:${i}`, isWrite: tool === "edit", turn, isError, ...(isError && text !== undefined ? { errSig: errSig(text) } : {}) };
      const r: CallRecord = base.isWrite ? { ...base, path: `/work/p${rnd(2)}.ts`, hashBefore: `h${i}`, hashAfter: `h${i + 1}` } : base;
      ring = push(ring, r, H);
      const got = trips(ring);
      for (const [trip, ref] of refs) {
        const want = ref(r);
        assert.equal(got.includes(trip), want, `${trip}, sequence ${s}, record ${i}`);
        if (want) fired[trip] = (fired[trip] ?? 0) + 1;
      }
    }
  }
  for (const t of ["repeated-error", "churn"]) assert.ok((fired[t] ?? 0) > 5, `${t} fired ${fired[t] ?? 0} times: the generator is too weak`);
});

// --- L5.T11: check-failing (design §3.1.1, plan D41) ------------------------------------------------------------------

import { checkPassed, isCheckRun, normCmd, normOf } from "../core/local/tripwires.ts";

const CHECK = "npm test -- parse";
const bash = (cmd: string, isError: boolean, turn = 0): CallRecord =>
  ({ tool: "bash", key: `bash:${cmd}`, isWrite: false, turn, isError, cmd: cmd.slice(0, 200), norm: normOf("bash", { command: cmd }) });
const withChecks = (checks: string[]): Risk => ({ ...NO_RISK, checks });

test("normCmd and normOf: whitespace collapsed and trimmed; only a bash command of at most 300 normalised characters", () => {
  assert.equal(normCmd("  npm   test\t--\nparse "), "npm test -- parse");
  assert.equal(normOf("bash", { command: "  npm   test " }), "npm test");
  assert.equal(normOf("read", { command: "npm test" }), undefined);
  assert.equal(normOf("bash", { command: 5 }), undefined);
  assert.equal(normOf("bash", {}), undefined);
  assert.equal(normOf("bash", { command: "x".repeat(300) }), "x".repeat(300));
  assert.equal(normOf("bash", { command: "x".repeat(301) }), undefined);
});

test("isCheckRun and checkPassed: the normalised command equals a check; a passing run is a pass", () => {
  assert.ok(isCheckRun(bash("npm   test -- parse\n", true), [CHECK]));
  assert.ok(!isCheckRun(bash("npm test -- parse && echo ok", true), [CHECK]));
  assert.ok(!isCheckRun(bash("NPM test -- parse", true), [CHECK]));
  assert.ok(!isCheckRun(bash("npm test -- parse", true), []));
  assert.ok(!isCheckRun({ ...read("k"), norm: CHECK }, [CHECK]), "only bash");
  assert.ok(isCheckRun(bash(CHECK, true), [`  npm test   -- parse `]), "the check is normalised too");
  assert.equal(checkPassed(bash(CHECK, false), [CHECK]), true);
  assert.equal(checkPassed(bash(CHECK, true), [CHECK]), false);
  assert.equal(checkPassed(bash("ls", false), [CHECK]), false);
  assert.equal(checkPassed({ ...bash(CHECK, false), isError: undefined }, [CHECK]), true, "no error flag: it passed");
});

test("AC-H1 check-failing: fires exactly when the last record is a failing check run and checkFailures failed in a row (a pass resets, other calls do not)", () => {
  const rnd = seeded(41);
  const ws = ["", " ", "\n", "  \t "];
  const variant = () => `npm${ws[1 + rnd(3)]}test${ws[1 + rnd(3)]}--${ws[1 + rnd(3)]}parse${ws[rnd(4)]}`;
  let fired = 0, quiet = 0;
  for (const N of [1, 2, 3]) {
    const h = { ...H, checkFailures: N };
    for (let round = 0; round < 80; round++) {
      let ring: CallRecord[] = [], failing = 0; // the reference: streaming over the history
      for (let i = 1 + rnd(18); i > 0; i--) {
        const k = rnd(6), isCheck = k < 3;
        const r = isCheck ? bash(variant(), rnd(3) > 0) : k === 3 ? bash(`ls ${rnd(3)}`, rnd(2) === 0) : k === 4 ? read(`r${rnd(3)}`) : write(`w${rnd(2)}`, "h0", rnd(2) ? "h1" : "h0");
        if (isCheck) failing = r.isError ? failing + 1 : 0;
        ring = push(ring, r, h);
        const expected = isCheck && r.isError === true && failing >= N;
        assert.equal(callTrips(ring, h, withChecks([CHECK])).includes("check-failing"), expected, `N=${N} round ${round}: ${ring.map((x) => `${x.cmd ?? x.tool}:${x.isError ? "F" : "ok"}`).join(" | ")}`);
        if (expected) fired++; else quiet++;
      }
    }
  }
  assert.ok(fired > 100 && quiet > 100, `${fired}/${quiet}`);
});

test("check-failing: pinned sequences; no check, a different command, and a check older than the window", () => {
  const f = bash(CHECK, true), ok = bash(CHECK, false);
  const run = (rs: CallRecord[], checks = [CHECK]) => callTrips(rs.reduce<CallRecord[]>((ring, r) => push(ring, r, H), []), H, withChecks(checks));
  assert.deepEqual(run([f]).filter((t) => t === "check-failing"), []);
  assert.deepEqual(run([f, f]).filter((t) => t === "check-failing"), ["check-failing"]);
  assert.deepEqual(run([f, read("x"), edit0(), f]).filter((t) => t === "check-failing"), ["check-failing"], "other calls do not reset");
  assert.deepEqual(run([f, ok, f]).filter((t) => t === "check-failing"), []);
  assert.deepEqual(run([f, f, f]).filter((t) => t === "check-failing"), ["check-failing"], "and again at the third");
  assert.deepEqual(run([f, f], []).filter((t) => t === "check-failing"), [], "no check, no trip");
  assert.deepEqual(run([bash("npm test", true), bash("npm test", true)]).filter((t) => t === "check-failing"), [], "another command");
  const aged = [f, ...Array.from({ length: windowSize(H) }, (_, i) => read(`k${i}`)), f];
  assert.deepEqual(run(aged).filter((t) => t === "check-failing"), [], "the first failure left the ring: one failure in the window");
});
const edit0 = () => write("e", "h0", "h0");

// --- L5.T12: over-size (design §3.1.1, plan D13) ----------------------------------------------------------------------

import { overSize } from "../core/local/tripwires.ts";

test("AC-H1 over-size: fires iff changed lines > splitLines or files > splitFiles, and not one line or file earlier", () => {
  const P = defaults().plans;
  const lim = { splitLines: P.splitLines, splitFiles: P.splitFiles };
  const files = (n: number, per: number) => Array.from({ length: n }, (_, i) => ({ path: `f${i}`, added: per, deleted: 0 }));
  assert.equal(overSize([], lim), false);
  assert.equal(overSize(files(1, P.splitLines), lim), false, "exactly splitLines");
  assert.equal(overSize(files(1, P.splitLines + 1), lim), true, "one line more");
  assert.equal(overSize([{ path: "a", added: 60, deleted: 41 }], lim), true, "added + deleted count: 101");
  assert.equal(overSize([{ path: "a", added: 60, deleted: 40 }], lim), false, "100");
  assert.equal(overSize(files(P.splitFiles, 0), lim), false, "exactly splitFiles files, binary or empty included");
  assert.equal(overSize(files(P.splitFiles + 1, 0), lim), true, "one file more");
  const rnd = seeded(12);
  let over = 0, under = 0;
  for (let i = 0; i < 400; i++) {
    const p = { splitLines: 1 + rnd(40), splitFiles: 1 + rnd(5) };
    const stat = Array.from({ length: rnd(8) }, (_, k) => ({ path: `p${k}`, added: rnd(20), deleted: rnd(20) }));
    let lines = 0;
    for (const s of stat) lines += s.added + s.deleted;
    const expected = lines > p.splitLines || stat.length > p.splitFiles;
    assert.equal(overSize(stat, p), expected, JSON.stringify([p, stat]));
    if (expected) over++; else under++;
  }
  assert.ok(over > 50 && under > 50, `${over}/${under}`);
});
