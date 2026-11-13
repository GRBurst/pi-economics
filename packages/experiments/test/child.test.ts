// Child mode (redesign M5b.2, orchestrator call on the child event bus): pi.events is per ResourceLoader and the patched
// actor builds an in-process child without the parent's bus. experiments loads in the child too, never draws there, and
// derives the child's assignment from durable state, the root's assignments row (the actor keeps every child, nested
// ones too, under <sessionDir>/subagents/<root>/; an in-memory child is told by the actor's list()), then serves it
// on the child's own bus, so the add-ons in the child see the levers of the parent.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onAssigned, query, type Levers } from "../core/channel.ts";
import { defaults } from "../core/settings.ts";
import { ENTRY, install } from "../core/shell.ts";
import { fakePi } from "./fake.ts";

beforeEach(() => void delete (globalThis as { __piEconomicsWarned_v1?: unknown }).__piEconomicsWarned_v1);

const CL = ["cache-lifecycle.warmPolicy", "cache-lifecycle.mainCacheTtl", "cache-lifecycle.maskOnCold"];
type Agent = { name: string; sessionId: string };

/**
 * One process: a shared agentDir and the actor's process-global engine; every runtime (the main's, each child's) is a
 * fakePi with its own bus, experiments installed in it, a cache-lifecycle stand-in that asks with its target at
 * session_start, and a token-meter stand-in that listens.
 */
function world(o: { persisted?: boolean } = {}) {
  const agentDir = mkdtempSync(join(tmpdir(), "experiments-child-"));
  const sessionDir = join(agentDir, "sessions");
  const agents: Agent[] = [];
  const actor = { version: 1, list: () => agents.map((a) => ({ ...a })), subscribe: () => () => {}, registerSpawnPolicy: () => {}, send: () => {} };
  const runtime = (sid: string, file: string | undefined, extra: Record<string, unknown> = {}) => {
    const f = fakePi();
    const heard: Levers[] = [];
    onAssigned(f.events, (l) => void heard.push(l));
    install(f.pi, { agentDir, settings: defaults(), rng: () => 0.5, api: () => actor });
    const ctx = {
      ...extra,
      model: { provider: "openai", id: "gpt-5" },
      sessionManager: { getSessionId: () => sid, getSessionDir: () => (o.persisted === false ? undefined : sessionDir), getSessionFile: () => file, getBranch: () => [] },
    };
    f.fire("session_start", { type: "session_start", reason: "startup" }, ctx);
    const seen = query(f.events, sid, "cache-lifecycle"); // the cache-lifecycle stand-in
    return { ...f, sid, ctx, heard, seen, end: (usage: unknown) => f.fire("message_end", { message: { role: "assistant", usage } }, ctx) };
  };
  const main = (sid: string) => {
    agents.push({ name: "main", sessionId: sid });
    return runtime(sid, o.persisted === false ? undefined : join(sessionDir, `2026-11-20T10-00-00-000Z_${sid}.jsonl`));
  };
  /** The actor's createSession: the record is reserved (sessionId "") while the child's session_start runs, then attached. */
  const spawn = (name: string, sid: string) => {
    const rec = { name, sessionId: "" };
    agents.push(rec);
    const root = agents.find((a) => a.name === "main")!.sessionId;
    const file = o.persisted === false ? undefined : join(sessionDir, "subagents", root, `2026-11-20T10-00-01-000Z_${sid}.jsonl`);
    if (file) mkdirSync(join(sessionDir, "subagents", root), { recursive: true });
    const child = runtime(sid, file);
    rec.sessionId = sid;
    return child;
  };
  const rowsFile = join(agentDir, "experiments", "assignments.jsonl");
  const rows = () => (existsSync(rowsFile) ? readFileSync(rowsFile, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  return { agentDir, sessionDir, agents, main, spawn, rows, rowsFile, runtime };
}

const parentView = (l: Levers, sessionId: string, parentSessionId: string) => ({ ...l, sessionId, parentSessionId });

for (const persisted of [true, false]) {
  const kind = persisted ? "file-backed" : "in-memory";

  test(`T5b2.5 ${kind}: an in-process child with its own bus sees its parent's assignment and levers; it never draws`, () => {
    const w = world({ persisted });
    const m = w.main("m1");
    const [row] = w.rows();
    assert.equal(typeof row.arm, "string");
    const c = w.spawn("w1", "c1");
    assert.deepEqual(w.rows(), [row], "a child writes no row");
    assert.deepEqual(c.entries, [], "nor a custom entry");
    // The child's own bus: the root's arm, design, stratum, eligibility and factors, its own session, the root as parent.
    const { levers: mainLevers, ...mainAssigned } = m.seen!;
    const { levers, ...assigned } = c.seen!;
    assert.deepEqual(assigned, parentView(mainAssigned as Levers, "c1", "m1"));
    // The parent's levers in the child: the same assigned levels; mainCacheTtl is a main session's lever (cache-lifecycle
    // writes 5 m in a child), refused up front and recorded once a response shows the TTL.
    assert.deepEqual(Object.keys(mainLevers), CL);
    assert.deepEqual(levers, { [CL[0]]: mainLevers[CL[0]], [CL[2]]: mainLevers[CL[2]] });
    c.end({ cacheWrite: 500, cacheWrite1h: 0 });
    const ttl = row.factors.mainCacheTtl.assigned;
    assert.deepEqual(query(c.events, "c1")!.levers[CL[1]], ttl === "5m" ? { v: "5m", s: "fixed" } : { v: "5m", s: "fixed", a: "1h", rb: "refused", tier: "replace" });
    assert.deepEqual(c.heard.at(-1), query(c.events, "c1"), "the token-meter stand-in heard the last state");
    // Nothing of the child reaches the parent's bus, and the parent's answer is unchanged.
    assert.equal(query(m.events, "c1"), undefined);
    assert.ok(m.heard.every((l) => l.sessionId === "m1"));
  });

  test(`T5b2.5 ${kind}: a grandchild (spawned by a child) runs the root's arm too`, () => {
    const w = world({ persisted });
    const m = w.main("m1");
    w.spawn("w1", "c1");
    const g = w.spawn("w2", "g1");
    const { levers: _l, ...root } = m.seen!;
    const { levers: _g, ...grand } = g.seen!;
    assert.deepEqual(grand, parentView(root as Levers, "g1", "m1"));
    assert.equal(w.rows().length, 1);
  });

  test(`T5b2.5 ${kind}: a child of a root without a row stays unassigned (no draw, no row, nothing served)`, () => {
    const w = world({ persisted });
    w.agents.push({ name: "main", sessionId: "m0" }); // a main that ran without experiments
    const c = w.spawn("w1", "c1");
    assert.equal(c.seen, undefined);
    assert.deepEqual([w.rows(), c.heard, c.entries], [[], [], []]);
  });
}

test("T5b2.5 a resumed child (its session file under the root's subagents dir, no actor record) still gets the root's arm", () => {
  const w = world();
  const m = w.main("m1");
  w.agents.length = 0; // a new process: the actor knows no agent yet
  mkdirSync(join(w.sessionDir, "subagents", "m1"), { recursive: true });
  const f = fakePi();
  install(f.pi, { agentDir: w.agentDir, settings: defaults(), api: () => undefined });
  const file = join(w.sessionDir, "subagents", "m1", "2026-11-20T11-00-00-000Z_c9.jsonl");
  f.fire("session_start", { type: "session_start", reason: "resume" }, { sessionManager: { getSessionId: () => "c9", getSessionDir: () => w.sessionDir, getSessionFile: () => file, getBranch: () => [] } });
  assert.equal(query(f.events, "c9")?.arm, m.seen!.arm);
  assert.equal(query(f.events, "c9")?.parentSessionId, "m1");
  assert.equal(w.rows().length, 1);
});

test("T5b2.5 in-memory: a main is no child (the actor's main record is its own, or a stale one with no pending agent)", () => {
  const w = world({ persisted: false });
  w.main("m1");
  w.agents.splice(0, w.agents.length, { name: "main", sessionId: "m-old" }); // /new: the actor refreshes its record later
  const m2 = w.main("m2");
  assert.equal(m2.seen?.sessionId, "m2");
  assert.equal(m2.seen?.parentSessionId, undefined);
  assert.deepEqual(w.rows().map((r) => r.sessionId), ["m1", "m2"]);
});

test("T5b2.5 a root's row of the v1 engine: the child gets its arm, design and flags as factors over the v4 levers", () => {
  const w = world();
  mkdirSync(join(w.agentDir, "experiments"), { recursive: true });
  writeFileSync(w.rowsFile, JSON.stringify({ ts: "2026-09-01T00:00:00.000Z", sessionId: "m-v1", arm: "-+-", design: "v4", flags: { warmPolicy: "native", mainCacheTtl: "1h", maskOnCold: "off", gone: "x" } }) + "\n");
  w.agents.push({ name: "main", sessionId: "m-v1" });
  const c = w.spawn("w1", "c1");
  const { levers: _l, ...a } = c.seen!;
  assert.deepEqual(a, {
    sessionId: "c1", parentSessionId: "m-v1", eligible: true, design: "v4", arm: "-+-",
    factors: {
      warmPolicy: { lever: "cache-lifecycle.warmPolicy", assigned: "native" },
      mainCacheTtl: { lever: "cache-lifecycle.mainCacheTtl", assigned: "1h" },
      maskOnCold: { lever: "cache-lifecycle.maskOnCold", assigned: "off" },
    },
  });
});

test("T5b2.5 a child runtime logs no guard events (corrections and ratings are the main session's)", () => {
  const w = world();
  w.main("m1");
  const c = w.spawn("w1", "c1");
  c.fire("message_end", { message: { role: "assistant" } }, c.ctx);
  c.fire("input", { source: "interactive", text: "no, that's wrong" }, c.ctx);
  assert.equal(existsSync(join(w.agentDir, "guards", "events.jsonl")), false);
  assert.equal(ENTRY, "pi-economics:assignment");
});

test("T5b2.7 a child derives once per runtime: its root's row is read at session_start, not again on every query", () => {
  const w = world();
  w.agents.push({ name: "main", sessionId: "m0" });
  const c = w.spawn("w1", "c1");
  assert.equal(c.seen, undefined);
  mkdirSync(join(w.agentDir, "experiments"), { recursive: true });
  writeFileSync(w.rowsFile, JSON.stringify({ v: 2, ts: "2026-11-20T10:00:00.000Z", sessionId: "m0", mode: "explore", eligible: true, arm: "000", factors: {} }) + "\n");
  assert.equal(query(c.events, "c1", "cache-lifecycle"), undefined);
});

// Review m1: the in-memory rule reads the actor's pending reservation (sessionId "") as "a child is being created". The actor
// binds every child headless (hasUI false), so an in-memory session with a UI is never a child: an interactive --no-session
// main starting while the actor still lists the previous main and a reservation (e.g. a spawn timer) draws its own arm.
test("review m1: an in-memory session with a UI is never a child (stale main record + pending reservation)", () => {
  const w = world({ persisted: false });
  w.main("m1");
  w.agents.push({ name: "w-late", sessionId: "" });
  const m2 = w.runtime("m2", undefined, { hasUI: true });
  assert.equal(m2.seen?.sessionId, "m2");
  assert.equal(m2.seen?.parentSessionId, undefined);
  assert.deepEqual(w.rows().map((r) => r.sessionId), ["m1", "m2"]);
});

// The residuals, bounded by the actor (its session_shutdown deletes every non-main record, pending ones included, before a
// replacement runtime starts) and removed only by the actor (pi-setup backlog: the reservation carries the child's sessionId
// before the child's extensions are bound, so the "" wildcard can go, and a child whose reservation is gone is not bound).
test("review m1 residual: a headless in-memory main in that window is still read as a child; an orphan in-memory child is read as a main", () => {
  const w = world({ persisted: false });
  w.main("m1");
  w.agents.push({ name: "w-late", sessionId: "" });
  const headless = w.runtime("m2", undefined, { hasUI: false });
  assert.equal(headless.seen?.parentSessionId, "m1", "print mode in the window: taken for m1's child");
  w.agents.splice(0, w.agents.length); // the actor's shutdownAll ran before the child's session_start
  const orphan = w.runtime("c-orphan", undefined, { hasUI: false });
  assert.equal(orphan.seen?.parentSessionId, undefined, "no record: taken for a main");
  assert.deepEqual(w.rows().map((r) => r.sessionId), ["m1", "c-orphan"]);
});

// Review n1: the actor's layout is <sessionDir>/subagents/<root>/<file>; a main whose session dir merely contains a
// "subagents" segment higher up is no child.
test("review n1: only the subagents/<root>/ directory that holds the file names a root", () => {
  const w = world();
  const dir = join(w.agentDir, "subagents", "proj", "sessions");
  mkdirSync(dir, { recursive: true });
  const m = w.runtime("m5", join(dir, "2026-11-20T12-00-00-000Z_m5.jsonl"));
  assert.equal(m.seen?.parentSessionId, undefined);
  assert.deepEqual(w.rows().map((r) => r.sessionId), ["m5"]);
});
