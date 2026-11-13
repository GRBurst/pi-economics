// levelsOfLine (spec §6.4 "Old → new mapping"): the router's levels and models of an outcome line. A line that carries
// the router's own fields (`ability`/`workerModel` on a spawn, `toModel`/`fromModel`/`ability` on an escalate, `toModel`/`fromModel` on a
// reroute) is returned as written; a line without them is mapped by the spec's tables, one case per row, whatever its `ts` says.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { levelsOfLine, type LevelsContext } from "../core/levels.ts";

const LOCAL = "llama/qwen3.8";
const FREE = "openrouter/qwen/qwen3.8-27b:free";
const SONNET = "anthropic/claude-sonnet-5-5";
const OPUS = "anthropic/claude-opus-5-5";

type Line = Record<string, any>;
// D9: the old route-label tables (core/legacy-routes.json) apply to the lines without the router's own fields; the fixtures of old lines carry OLD, those of new ones NEW (the date decides nothing).
const OLD = "2026-10-05T10:00:00.000Z", NEW = "2026-10-17T00:00:00.000Z";
const spawn = (taskId: string, kind: string, workerTier: string, rest: Line = {}): Line =>
  ({ v: 1, ts: OLD, event: "spawn", taskId, kind, workerTier, workerEffort: "xhigh", base: workerTier, reasons: [], ...rest });
const ctxOf = (lines: Line[]): LevelsContext => ({
  spawns: new Map(lines.filter((l) => l.event === "spawn").map((l) => [l.taskId, l])),
  lastReroute: new Map(lines.filter((l) => l.event === "reroute").map((l) => [l.taskId, l])),
});
const NONE = ctxOf([]);

// ---- spawn: a new line ----------------------------------------------------------------------------

test("a spawn line with the router's fields is returned as written; ranModel is the last reroute's toModel", () => {
  const l = spawn("n1", "implement", "qwen", {
    ts: NEW, ability: "write", level: 0, draft: true, workerLevel: 0, reviewLevel: 1, workerMember: "haiku", workerModel: "anthropic/claude-haiku", startEffort: "medium", waitMs: 0,
    reasons: ["qwen chain: cloud"], // a stray old reason never overrides the written fields
  });
  assert.deepEqual(levelsOfLine(l, NONE), {
    ability: "write", level: 0, draft: true, workerLevel: 0, reviewLevel: 1, workerModel: "anthropic/claude-haiku", ranModel: "anthropic/claude-haiku", startEffort: "medium",
  });
  const r = { ts: NEW, event: "reroute", taskId: "n1", from: "haiku", to: "T1", fromModel: "anthropic/claude-haiku", toModel: SONNET };
  assert.equal(levelsOfLine(l, ctxOf([l, r])).ranModel, SONNET);
});

// ---- spawn: old lines, table "old line → ability, level, workerLevel, workerModel" ---------------------------

test("old scout/review: read; base qwen/qwen-draft → 0, T1 → 2, T2 → 3; workerLevel on the same map (P20: read T1 is 2)", () => {
  const cases: [string, string, string, number, number][] = [
    ["scout", "qwen", "qwen", 0, 0], ["review", "qwen-draft", "qwen", 0, 0], ["scout", "T1", "T1", 2, 2], ["review", "T2", "T2", 3, 3], ["scout", "qwen", "T1", 0, 2],
  ];
  for (const [kind, base, tier, level, workerLevel] of cases) {
    const v = levelsOfLine(spawn("s", kind, tier, { base }), NONE);
    assert.deepEqual([v.ability, v.level, v.draft, v.workerLevel], ["read", level, undefined, workerLevel], `${kind} ${base} ${tier}`);
  }
});

test("old other routed kinds: write; base qwen → 0, qwen-draft → 0 + draft, T1 → 1, T2 → 2; workerLevel on the same map", () => {
  const cases: [string, string, number, true | undefined, number][] = [
    ["qwen", "qwen", 0, undefined, 0], ["qwen-draft", "qwen", 0, true, 0], ["T1", "T1", 1, undefined, 1], ["T2", "T2", 2, undefined, 2], ["T1", "T2", 1, undefined, 2],
  ];
  for (const [base, tier, level, draft, workerLevel] of cases) {
    const v = levelsOfLine(spawn("w", "implement", tier, { base }), NONE);
    assert.deepEqual([v.ability, v.level, v.draft, v.workerLevel], ["write", level, draft, workerLevel], `${base} ${tier}`);
  }
});

test("old unrouted: no ability or levels; workerModel from the reason \"model …\"", () => {
  const v = levelsOfLine(spawn("u", "unrouted", "vendor/other", { reasons: ["routing off", "model vendor/other"] }), NONE);
  assert.deepEqual(v, { workerModel: "vendor/other", ranModel: "vendor/other", startEffort: "xhigh" });
});

test("old workerModel: T1/T2 → Sonnet/Opus 5.5; qwen by the chain reason; a v0 line without a chain reason → unknown", () => {
  const model = (tier: string, reasons: string[], rest: Line = {}) => levelsOfLine(spawn("m", "implement", tier, { reasons, ...rest }), NONE).workerModel;
  assert.equal(model("T1", ["t0 misses: linear"]), SONNET);
  assert.equal(model("T2", ["t2: auth"]), OPUS);
  assert.equal(model("qwen", ["all t0 criteria hold", "qwen chain: local"]), LOCAL);
  assert.equal(model("qwen", ["all t0 criteria hold", "qwen chain: cloud"]), FREE);
  assert.equal(model("qwen", ["all t0 criteria hold", "qwen chain → Sonnet: qwen slots busy for 300 s"]), SONNET);
  assert.equal(model("qwen", ["all t0 criteria hold"], { v: undefined }), undefined);
});

test("old startEffort: workerEffort, except a qwen chain → Sonnet fallback → high", () => {
  assert.equal(levelsOfLine(spawn("e", "implement", "qwen", { reasons: ["qwen chain: cloud"] }), NONE).startEffort, "xhigh");
  assert.equal(levelsOfLine(spawn("e", "implement", "qwen", { reasons: ["qwen chain → Sonnet: local down"] }), NONE).startEffort, "high");
});

test("old ranModel: the last reroute's `to` mapped (local, cloud, T1, T2), else workerModel", () => {
  const l = spawn("r1", "implement", "qwen", { reasons: ["qwen chain: cloud"] });
  assert.equal(levelsOfLine(l, NONE).ranModel, FREE);
  for (const [to, m] of [["local", LOCAL], ["cloud", FREE], ["T1", SONNET], ["T2", OPUS]]) {
    const r = { ts: OLD, event: "reroute", taskId: "r1", from: "cloud", to, reason: "x" };
    assert.equal(levelsOfLine(l, ctxOf([l, r])).ranModel, m, to);
  }
});

// ---- escalate and reroute ------------------------------------------------------------------------

test("an escalate line with the router's fields is returned as written", () => {
  const e = { ts: NEW, event: "escalate", taskId: "b", attemptOf: "a", from: "cloud", to: "T1", fromModel: FREE, toModel: SONNET, ability: "write", fromLevel: 0, toLevel: 1 };
  assert.deepEqual(levelsOfLine(e, NONE), { ability: "write", fromLevel: 0, toLevel: 1, fromModel: FREE, toModel: SONNET });
});

test("old escalate: ability of the spawn named by attemptOf; local/cloud → 0, T1 → 1 (read 2), T2 → 2 (read 3); models by label", () => {
  const w = spawn("a", "implement", "qwen"), s = spawn("sc", "scout", "qwen");
  const ctx = ctxOf([w, s]);
  const esc = (attemptOf: string, from: string, to: string) => levelsOfLine({ ts: OLD, event: "escalate", taskId: `${attemptOf}b`, attemptOf, from, to }, ctx);
  assert.deepEqual(esc("a", "local", "T1"), { ability: "write", fromLevel: 0, toLevel: 1, fromModel: LOCAL, toModel: SONNET });
  assert.deepEqual(esc("a", "cloud", "T2"), { ability: "write", fromLevel: 0, toLevel: 2, fromModel: FREE, toModel: OPUS });
  assert.deepEqual(esc("a", "T1", "T2"), { ability: "write", fromLevel: 1, toLevel: 2, fromModel: SONNET, toModel: OPUS });
  assert.deepEqual(esc("sc", "cloud", "T1"), { ability: "read", fromLevel: 0, toLevel: 2, fromModel: FREE, toModel: SONNET });
  assert.deepEqual(esc("sc", "T1", "T2"), { ability: "read", fromLevel: 2, toLevel: 3, fromModel: SONNET, toModel: OPUS });
});

test("old escalate from \"?\": fromLevel from the failed spawn's workerTier, fromModel unknown; no failed spawn → no ability, no levels", () => {
  const ctx = ctxOf([spawn("a", "implement", "T1"), spawn("sc", "review", "qwen")]);
  assert.deepEqual(levelsOfLine({ ts: OLD, event: "escalate", taskId: "ab", attemptOf: "a", from: "?", to: "T2" }, ctx), { ability: "write", fromLevel: 1, toLevel: 2, toModel: OPUS });
  assert.deepEqual(levelsOfLine({ ts: OLD, event: "escalate", taskId: "sb", attemptOf: "sc", from: "?", to: "T1" }, ctx), { ability: "read", fromLevel: 0, toLevel: 2, toModel: SONNET });
  assert.deepEqual(levelsOfLine({ ts: OLD, event: "escalate", taskId: "zb", attemptOf: "z", from: "cloud", to: "T1" }, ctx), { fromModel: FREE, toModel: SONNET });
});

test("reroute: models only — as written when present, else by the label map", () => {
  assert.deepEqual(levelsOfLine({ ts: NEW, event: "reroute", taskId: "q", from: "cloud", to: "T1", reason: "x", fromModel: "a/b", toModel: "c/d" }, NONE), { fromModel: "a/b", toModel: "c/d" });
  assert.deepEqual(levelsOfLine({ ts: OLD, event: "reroute", taskId: "q", from: "local", to: "cloud", reason: "x" }, NONE), { fromModel: LOCAL, toModel: FREE });
});

test("other events have no levels", () => {
  for (const event of ["check", "verdict", "corrective", "spotcheck"]) assert.deepEqual(levelsOfLine({ event, taskId: "t" }, NONE), {});
});

// ---- D9: the route-label tables are data, and apply to the lines without the router's own fields ----------------------

test("D9: the label → model and level tables are core/legacy-routes.json, not levels.ts; the file has no date", () => {
  const src = readFileSync(new URL("../core/levels.ts", import.meta.url), "utf8");
  for (const model of [LOCAL, FREE, SONNET, OPUS]) assert.ok(!src.includes(model), `levels.ts names ${model}`);
  const data = JSON.parse(readFileSync(new URL("../core/legacy-routes.json", import.meta.url), "utf8"));
  assert.ok(!("before" in data), "a line is old by its shape, not by a date");
  assert.deepEqual(Object.values(data.models).sort(), [FREE, LOCAL, OPUS, SONNET].sort());
  assert.deepEqual(Object.keys(data.levels).sort(), ["read", "write"]);
});

test("D9: the shape decides, not the date: a label-only line is mapped even when its ts is after the router's change; a line with the router's fields is read as written even when its ts is before", () => {
  const LATE = "2026-10-26T19:00:00.000Z"; // between the router's change (2026-10-17) and the first line of an owner's log that carries its fields
  const rest = { reasons: ["qwen chain: local"] };
  const labelOnly = levelsOfLine(spawn("b", "implement", "qwen", { ...rest, ts: LATE }), NONE);
  assert.deepEqual([labelOnly.workerModel, labelOnly.ranModel, labelOnly.ability, labelOnly.workerLevel], [LOCAL, LOCAL, "write", 0]);
  assert.deepEqual(levelsOfLine(spawn("b", "implement", "qwen", { ...rest, ts: NEW }), NONE).workerModel, LOCAL);
  const written = levelsOfLine(spawn("b", "implement", "qwen", { ...rest, ts: OLD, ability: "write", workerModel: "x/started" }), NONE);
  assert.deepEqual([written.workerModel, written.ability], ["x/started", "write"]);
  const esc = (ts: string, extra: Line = {}) => levelsOfLine({ ts, event: "escalate", taskId: "qb", attemptOf: "q", from: "local", to: "T1", ...extra }, ctxOf([spawn("q", "implement", "qwen")]));
  assert.deepEqual(esc(LATE), { ability: "write", fromLevel: 0, toLevel: 1, fromModel: LOCAL, toModel: SONNET });
  assert.deepEqual(esc(OLD, { toModel: "x/to", ability: "write" }), { ability: "write", toModel: "x/to" });
  const rr = (ts: string, extra: Line = {}) => levelsOfLine({ ts, event: "reroute", taskId: "q", from: "local", to: "cloud", reason: "x", ...extra }, NONE);
  assert.deepEqual(rr(LATE), { fromModel: LOCAL, toModel: FREE });
  assert.deepEqual(rr(OLD, { fromModel: "a/b", toModel: "c/d" }), { fromModel: "a/b", toModel: "c/d" });
  assert.deepEqual(rr(LATE, { toModel: "c/d" }), { fromModel: LOCAL, toModel: "c/d" }); // per field: the model written wins, the label fills the other
});

test("D9: a new unrouted spawn still names its model in its own reason", () => {
  const u = spawn("u", "unrouted", "vendor/other", { ts: NEW, reasons: ["routing off", "model vendor/other"] });
  assert.deepEqual(levelsOfLine(u, NONE), { workerModel: "vendor/other", ranModel: "vendor/other", startEffort: "xhigh" });
});

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

test("D9 property: whatever the labels and the date say, a line with the router's own fields yields the models and levels it carries, never one from the tables", () => {
  const rand = rng(17);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const labels = ["local", "cloud", "qwen", "haiku", "T1", "T2", "?"];
  const reasons = [[], ["qwen chain: local"], ["qwen chain: cloud"], ["qwen chain → Sonnet: busy"], ["t2: auth"]];
  const maybe = <T>(x: T): T | undefined => (rand() < 0.5 ? x : undefined);
  const own = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  for (let i = 0; i < 300; i++) {
    const kind = pick(["implement", "scout", "review"]);
    const ts = new Date(Date.parse(OLD) + Math.floor(rand() * 90) * 86_400_000).toISOString(); // before and after the router's change alike
    const ability = maybe(pick(["read", "write"])), workerModel = maybe("x/started");
    const s = spawn("t", kind, pick(labels), { ts, base: pick(labels), reasons: pick(reasons), ability: ability ?? (workerModel ? undefined : "write"), level: maybe(1), workerLevel: maybe(2), workerModel });
    const r = maybe({ ts, event: "reroute", taskId: "t", from: pick(labels), to: pick(labels), reason: "x", fromModel: "x/from", toModel: "x/to" }); // a reroute carries both models, or its labels are read
    const ctx = ctxOf(r ? [s, r] : [s]);
    const got = levelsOfLine(s, ctx);
    assert.equal(got.workerModel, s.workerModel, JSON.stringify(s));
    assert.equal(got.workerLevel, s.workerLevel, JSON.stringify(s));
    assert.equal(got.ranModel, r ? r.toModel : s.workerModel, JSON.stringify([s, r]));
    const toModel = maybe("x/to");
    const e = { ts, event: "escalate", taskId: "tb", attemptOf: "t", from: pick(labels), to: pick(labels), fromModel: maybe("x/from"), toModel: toModel ?? "x/to2", ability: maybe("write"), fromLevel: maybe(0), toLevel: maybe(1) };
    assert.deepEqual(levelsOfLine(e, ctx), own({ ability: e.ability, fromLevel: e.fromLevel, toLevel: e.toLevel, fromModel: e.fromModel, toModel: e.toModel }), JSON.stringify(e));
    if (r) assert.deepEqual(levelsOfLine(r, ctx), own({ fromModel: r.fromModel, toModel: r.toModel }), JSON.stringify(r));
  }
});
