// The engine drives the add-ons (redesign §7.4, §7.7, M5b.2): a lever starts once its target asks the channel, its
// read-back is observed at its readBackAt, and every state change goes out on the channel. Two components share the
// fake bus: a cache-lifecycle stand-in that asks with `target`, and a token-meter stand-in that listens.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onAssigned, query, type Levers } from "../core/channel.ts";
import { defaults } from "../core/settings.ts";
import { install } from "../core/shell.ts";
import { fakePi } from "./fake.ts";

beforeEach(() => void delete (globalThis as { __piEconomicsWarned_v1?: unknown }).__piEconomicsWarned_v1);

const CL = ["cache-lifecycle.warmPolicy", "cache-lifecycle.mainCacheTtl", "cache-lifecycle.maskOnCold"];

function engine() {
  const agentDir = mkdtempSync(join(tmpdir(), "experiments-levers-"));
  const f = fakePi();
  const heard: Levers[] = []; // the token-meter stand-in
  onAssigned(f.events, (l) => void heard.push(l));
  install(f.pi, { agentDir, settings: defaults(), rng: () => 0.5, api: () => undefined });
  const ctx = (sid: string) => ({
    model: { provider: "openai", id: "gpt-5" },
    sessionManager: { getSessionId: () => sid, getSessionDir: () => join(agentDir, "sessions"), getSessionFile: () => join(agentDir, "sessions", `x_${sid}.jsonl`), getBranch: () => [] },
  });
  const start = (sid: string) => f.fire("session_start", { type: "session_start", reason: "startup" }, ctx(sid));
  const end = (sid: string, usage: unknown) => f.fire("message_end", { message: { role: "assistant", usage } }, ctx(sid));
  return { ...f, heard, start, end };
}

test("T5b2.3 a lever is inert until its target asks: the assignment goes out without cache-lifecycle's levers", () => {
  const e = engine();
  e.start("s1");
  assert.equal(e.heard.length, 1);
  assert.equal(typeof e.heard[0].arm, "string");
  assert.deepEqual(e.heard[0].levers, {});
  assert.deepEqual(query(e.events, "s1")?.levers, {}, "a query without target loads nothing");
});

test("T5b2.3 the target's first query starts its levers: the reply and one publication carry them (unverified, replace)", () => {
  const e = engine();
  e.start("s1");
  const a = query(e.events, "s1", "cache-lifecycle")!;
  assert.deepEqual(Object.keys(a.levers), CL);
  for (const id of CL) {
    const assigned = Object.values(a.factors!).find((f) => f.lever === id)!.assigned;
    assert.deepEqual(a.levers[id], { v: assigned, s: "pe", a: assigned, rb: "unverified", tier: "replace" });
  }
  assert.equal(e.heard.length, 2);
  assert.deepEqual(e.heard[1], a);
  query(e.events, "s1", "cache-lifecycle");
  assert.equal(e.heard.length, 2, "no change, no publication");
});

test("T5b2.3 read-back at message_end: a response's cache writes confirm or refuse mainCacheTtl; the change is published once", () => {
  const e = engine();
  e.start("s1");
  const a = query(e.events, "s1", "cache-lifecycle")!;
  const ttl = Object.values(a.factors!).find((f) => f.lever === CL[1])!.assigned;
  const other = ttl === "1h" ? "5m" : "1h";
  e.end("s1", { cacheWrite: 0, cacheWrite1h: 0 });
  assert.equal(e.heard.length, 2, "nothing written: nothing observed");
  e.end("s1", { cacheWrite: 800, cacheWrite1h: ttl === "1h" ? 800 : 0 });
  assert.equal(e.heard.length, 3);
  assert.deepEqual(e.heard[2].levers[CL[1]], { v: ttl, s: "pe", a: ttl, rb: "confirmed", tier: "replace" });
  e.end("s1", { cacheWrite: 800, cacheWrite1h: ttl === "1h" ? 800 : 0 });
  assert.equal(e.heard.length, 3, "the same observation again: no publication");
  e.end("s1", { cacheWrite: 800, cacheWrite1h: other === "1h" ? 800 : 0 });
  assert.deepEqual(e.heard[3].levers[CL[1]], { v: other, s: "fixed", a: ttl, rb: "refused", tier: "replace" });
  assert.deepEqual(query(e.events, "s1")!.levers[CL[1]], e.heard[3].levers[CL[1]]);
});

test("T5b2.3 a target that asks from inside a publication: listeners end with the full state (no stale last payload)", () => {
  const e = engine();
  // cache-lifecycle installed before the engine: it asks when it hears its session's assignment.
  onAssigned(e.events, (l) => void query(e.events, l.sessionId, "cache-lifecycle"));
  const last: Levers[] = [];
  onAssigned(e.events, (l) => void last.push(l));
  e.start("s1");
  assert.deepEqual(Object.keys(last.at(-1)!.levers), CL);
  assert.deepEqual(Object.keys(e.heard.at(-1)!.levers), CL);
});
