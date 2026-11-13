// T5b1.7 (redesign §7.7): the internal channel on pi.events, between two fake components on one bus.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { LEVERS, LEVERS_QUERY, onAssigned, publish, query, serve, type Levers } from "../core/channel.ts";

/** pi 1.4's createEventBus: emit is synchronous; each handler is wrapped async and its errors are logged, not thrown. */
function bus() {
  const e = new EventEmitter();
  return {
    emit: (channel: string, data: unknown) => void e.emit(channel, data),
    on: (channel: string, h: (d: any) => unknown) => {
      const safe = async (d: unknown) => { try { await h(d); } catch { /* logged by pi */ } };
      e.on(channel, safe);
      return () => void e.off(channel, safe);
    },
  };
}

const main: Levers = { sessionId: "m", design: "0123456789ab", stratum: "api", eligible: true, arm: "010", factors: { mainCacheTtl: { lever: "cache-lifecycle.mainCacheTtl", assigned: "1h" } }, levers: {} };

test("channel names are versioned and pi-economics' own", () => {
  assert.equal(LEVERS, "pi-economics:levers:v1");
  assert.equal(LEVERS_QUERY, "pi-economics:levers-query:v1");
});

test("publish reaches every subscriber; query is answered synchronously by the engine's lookup", () => {
  const b = bus();
  const known = new Map<string, Levers>();
  // Component 1, the engine.
  const stop = serve(b, (sid) => known.get(sid));
  // Component 2, an add-on: before the engine knows the session, then after the publish.
  const seen: Levers[] = [];
  const off = onAssigned(b, (a) => void seen.push(a));
  assert.equal(query(b, "m"), undefined, "not assigned yet");
  known.set("m", main);
  publish(b, main);
  assert.deepEqual(seen, [main]);
  assert.deepEqual(query(b, "m"), main);
  assert.equal(query(b, "other"), undefined);
  off();
  publish(b, { ...main, sessionId: "n" });
  assert.equal(seen.length, 1, "unsubscribed");
  stop();
  assert.equal(query(b, "m"), undefined, "no engine on the bus: no answer");
});

test("query: the first answer counts; a throwing listener does not break the asker", () => {
  const b = bus();
  b.on(LEVERS_QUERY, () => { throw new Error("broken add-on"); });
  serve(b, (sid) => (sid === "m" ? main : undefined));
  serve(b, () => ({ ...main, arm: "111" }));
  assert.equal(query(b, "m")?.arm, "010");
  assert.equal(query(b, "x")?.arm, "111", "undefined is no answer: a later engine may still know the session");
});

test("T5b2.3 query: the asking target reaches the engine's lookup; a plain query names none", () => {
  const b = bus();
  const asked: Array<string | undefined> = [];
  serve(b, (_sid, target) => (asked.push(target), main));
  query(b, "m", "cache-lifecycle");
  query(b, "m");
  assert.deepEqual(asked, ["cache-lifecycle", undefined]);
});
