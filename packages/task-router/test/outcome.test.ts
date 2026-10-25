import { test } from "node:test";
import assert from "node:assert/strict";
import { cardHash, checkEvent, correctiveEvent, escalateEvent, outcomeFile, rerouteEvent, serializeEvent, spawnEvent, spotcheckEvent, verdictEvent } from "../core/outcome.ts";
import { createOutcomeLog } from "../core/log.ts";
import type { Card, Plan } from "../core/types.ts";

const K_ALLOWED = new Set([
  "v", "ts", "event", "taskId", "cardHash", "kind", "workerTier", "workerEffort", "reviewTier", "reviewEffort",
  "base", "importance", "reasons", "arm", "sessionId", "parentSessionId", "attemptOf", "from", "to", "reason",
  "exit", "durationMs", "verdict", "note", "unresolved", "assigned", "routeBase", "reviewOf", "requested",
  // T4.1 (spec §6.4, AC4, RD2)
  "ability", "level", "draft", "workerLevel", "reviewLevel", "workerMember", "workerModel", "startEffort", "waitMs",
  "fromModel", "toModel", "fromLevel", "toLevel",
]);
/** The T4.1 spawn fields (spec §6.4): the requirement, the plan's levels, what the child started on, the wait. */
const NEW_SPAWN_KEYS = ["ability", "level", "draft", "workerLevel", "reviewLevel", "workerMember", "workerModel", "startEffort", "waitMs"];
const NOW = new Date(Date.UTC(2026, 9, 2, 12, 0, 0));
const SECRET = "SECRET-PROMPT-TEXT";
const card: Card = {
  kind: "implement", files: [`src/${SECRET}.ts`], check: `run ${SECRET}`, acceptance: [`${SECRET} works`],
  t0: { bounded: true, specified: true, verifiable: true, lowRisk: true, small: true, linear: true }, t2: [], failure: SECRET,
};
const plan = { worker: { tier: "qwen", effort: "xhigh" }, review: { tier: "T1", effort: "high" }, base: "qwen", importance: "high", reasons: ["all t0 criteria hold"] } as unknown as Plan;
const long = "x".repeat(5000);
/** A routed write-0 draft plan with a review leg, started on Sonnet after a wait (a queue fallback). */
const routed = {
  ability: "write", level: 0, draft: true, worker: { tier: "qwen", effort: "xhigh", level: 0 }, review: { tier: "T1", effort: "high", level: 1 },
  base: "qwen-draft", importance: "normal", reasons: ["soft miss: small"],
} as unknown as Plan;
const start = { member: "sonnet", model: "anthropic/claude-sonnet-5-5", effort: "high" as const, waitMs: 12000 };
/** T4.2: an escalate line's router fields. */
const ESC = { fromModel: "openrouter/qwen/free", toModel: "anthropic/claude-sonnet-5-5", ability: "write", fromLevel: 0, toLevel: 1 };

const sample = () => [
  spawnEvent({ now: NOW, taskId: "t1", card, plan, arm: "a1", sessionId: "s1", parentSessionId: "p1", attemptOf: "t0" }),
  rerouteEvent({ now: NOW, taskId: "t1", from: "qwen", to: "T1", reason: "429 free cap" }),
  checkEvent({ now: NOW, taskId: "t1", exit: 1, durationMs: 1234 }),
  correctiveEvent({ now: NOW, taskId: "t1" }),
  escalateEvent({ now: NOW, taskId: "t1", from: "cloud", to: "T1", attemptOf: "t0", ...ESC }),
  verdictEvent({ now: NOW, taskId: "t1", verdict: "accepted", note: "ok", reviewOf: "t0" }),
  spotcheckEvent({ now: NOW, taskId: "t1" }),
  spawnEvent({ now: NOW, taskId: "t1", card, plan: routed, start }),
];

test("every builder: event name, ts, taskId; keys ⊆ allowlist", () => {
  const names = ["spawn", "reroute", "check", "corrective", "escalate", "verdict", "spotcheck", "spawn"];
  sample().forEach((e, i) => {
    assert.equal(e.event, names[i]);
    assert.equal(e.v, 1, "schema version (LOGS.md)");
    assert.equal(e.ts, NOW.toISOString());
    assert.equal(e.taskId, "t1");
    for (const k of Object.keys(e)) assert.ok(K_ALLOWED.has(k), `${e.event}: unexpected key ${k}`);
  });
});

test("R2: no card or prompt text reaches an event; strings and lists are bounded", () => {
  assert.ok(!sample().map((e) => JSON.stringify(e)).join("\n").includes(SECRET));
  const big = [
    spawnEvent({ now: NOW, taskId: long, card: { ...card, kind: long }, plan: { ...plan, reasons: [long, long] }, arm: long, sessionId: long }),
    rerouteEvent({ now: NOW, taskId: long, from: long, to: long, reason: long }),
    verdictEvent({ now: NOW, taskId: long, verdict: "partial", note: long }),
  ];
  for (const e of big) {
    for (const [k, v] of Object.entries(e)) {
      assert.ok(K_ALLOWED.has(k), k);
      for (const s of Array.isArray(v) ? v : [v]) if (typeof s === "string") assert.ok(s.length <= 256, `${k} ${s.length}`);
    }
    assert.ok(serializeEvent(e).length < 4096);
  }
});

test("spawn event carries route, reasons, importance, arm, session ids", () => {
  const e = sample()[0];
  assert.deepEqual(
    { ...e, cardHash: undefined },
    { v: 1, ts: NOW.toISOString(), event: "spawn", taskId: "t1", cardHash: undefined, kind: "implement", workerTier: "qwen", workerEffort: "xhigh",
      reviewTier: "T1", reviewEffort: "high", base: "qwen", importance: "high", reasons: ["all t0 criteria hold"], arm: "a1",
      sessionId: "s1", parentSessionId: "p1", attemptOf: "t0" },
  );
});

test("spawn event carries the optional T5.20\u2013T5.22 fields only when set; spotcheck is requested:true", () => {
  const e = spawnEvent({ now: NOW, taskId: "t2", card: { ...card, reviewOf: "t1" }, plan: { ...plan, assigned: "random", routeBase: "qwen" }, unresolved: true });
  assert.deepEqual([e.assigned, e.routeBase, e.unresolved, e.reviewOf], ["random", "qwen", true, "t1"]);
  const none = spawnEvent({ now: NOW, taskId: "t3", card, plan, unresolved: false });
  for (const k of ["assigned", "routeBase", "unresolved", "reviewOf"]) assert.ok(!(k in none), k);
  assert.deepEqual(spotcheckEvent({ now: NOW, taskId: "t1" }), { v: 1, ts: NOW.toISOString(), event: "spotcheck", taskId: "t1", requested: true });
});

test("T4.1 spawn line: requirement, plan levels, the started member, model and effort, the wait; workerEffort stays planned (AC4, RD2)", () => {
  const e = spawnEvent({ now: NOW, taskId: "t1", card, plan: routed, start });
  assert.deepEqual(Object.fromEntries(NEW_SPAWN_KEYS.map((k) => [k, e[k]])), {
    ability: "write", level: 0, draft: true, workerLevel: 0, reviewLevel: 1,
    workerMember: "sonnet", workerModel: "anthropic/claude-sonnet-5-5", startEffort: "high", waitMs: 12000,
  });
  assert.deepEqual([e.workerTier, e.workerEffort], ["qwen", "xhigh"]); // the planned leg (RD2)
  // draft only when true; no review leg → no reviewLevel; no start → no started fields
  const noDraft = spawnEvent({ now: NOW, taskId: "t2", card, plan: { ...routed, draft: undefined, review: undefined } as unknown as Plan });
  for (const k of ["draft", "reviewLevel", "workerMember", "workerModel", "startEffort", "waitMs"]) assert.ok(!(k in noDraft), k);
  assert.deepEqual([noDraft.ability, noDraft.level, noDraft.workerLevel], ["write", 0, 0]);
});

test("T4.2 escalate line: models, ability and levels when given; without them only from/to/attemptOf", () => {
  const e = sample()[4];
  assert.deepEqual([e.from, e.to, e.fromModel, e.toModel, e.ability, e.fromLevel, e.toLevel], ["cloud", "T1", ...Object.values(ESC)]);
  const bare = escalateEvent({ now: NOW, taskId: "t1", from: "?", to: "T1" });
  for (const k of Object.keys(ESC)) assert.ok(!(k in bare), k);
});

test("T4.1 an unrouted spawn line has none of the new fields", () => {
  const e = spawnEvent({ now: NOW, taskId: "u1", card, plan });
  for (const k of NEW_SPAWN_KEYS) assert.ok(!(k in e), k);
});

test("cardHash: 16 hex chars, stable, sensitive to the card", () => {
  assert.match(cardHash(card), /^[0-9a-f]{16}$/);
  assert.equal(cardHash(card), cardHash({ ...card }));
  assert.notEqual(cardHash(card), cardHash({ ...card, files: [] }));
});

test("serializeEvent: one JSON line; outcomeFile by UTC month", () => {
  const s = serializeEvent(sample()[5]);
  assert.ok(s.endsWith("\n") && s.indexOf("\n") === s.length - 1);
  assert.deepEqual(JSON.parse(s), sample()[5]);
  assert.equal(outcomeFile("/a", NOW), "/a/task-router/outcomes/2026-10.jsonl");
  assert.equal(outcomeFile("/a", new Date(Date.UTC(2026, 11, 31, 23, 59))), "/a/task-router/outcomes/2026-12.jsonl");
});

const mk = () => {
  const out: Array<Record<string, unknown>> = [];
  return { out, log: createOutcomeLog({ append: (e) => out.push(e), now: () => NOW }) };
};

test("log: verdict writes a verdict event for a spawned task", () => {
  const { out, log } = mk();
  log.spawn({ taskId: "t1", card, plan });
  assert.equal(log.verdict("t1", "accepted", "fine"), true);
  assert.deepEqual(out.map((e) => e.event), ["spawn", "verdict"]);
  assert.equal(out[1].verdict, "accepted");
  assert.equal(out[1].note, "fine");
});

test("log: verdict for an unknown task writes nothing", () => {
  const { out, log } = mk();
  assert.equal(log.verdict("nope", "rejected"), false);
  assert.deepEqual(out, []);
});

test("log: kill without verdict → unjudged, once; after a verdict → nothing", () => {
  const { out, log } = mk();
  log.spawn({ taskId: "t1", card, plan });
  log.spawn({ taskId: "t2", card, plan });
  log.verdict("t2", "partial");
  log.killed("t1");
  log.killed("t1");
  log.killed("t2");
  log.killed("ghost");
  const verdicts = out.filter((e) => e.event === "verdict");
  assert.deepEqual(verdicts.map((e) => [e.taskId, e.verdict]), [["t2", "partial"], ["t1", "unjudged"]]);
});

test("log: reroute/check/corrective/escalate append events", () => {
  const { out, log } = mk();
  log.spawn({ taskId: "t1", card, plan });
  log.reroute("t1", "qwen", "T1", "infra");
  log.check("t1", 0, 10);
  log.corrective("t1");
  log.escalate("t1", "qwen", "T1", "t0");
  assert.deepEqual(out.map((e) => e.event), ["spawn", "reroute", "check", "corrective", "escalate"]);
});
