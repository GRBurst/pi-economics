// Identity shim: pi 1.0.0's CacheWarmer stops a warm run when any message
// object in agent.state.messages changed identity since the request. Custom
// messages get a new object on every projection, so warming never fires again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerIdentityShim, wrapProjection } from "../core/identity.ts";

// A session manager that projects like pi 1.0.0: `message` entries return the
// stored object, `custom_message` entries a fresh object on every call.
function fakeSm(entries: any[]) {
  return {
    entries,
    buildSessionProjection() {
      const projected = this.entries.map((sourceEntry: any) => ({
        sourceEntry,
        messages:
          sourceEntry.type === "message"
            ? [sourceEntry.message]
            : [{ role: "custom", customType: sourceEntry.customType, content: sourceEntry.content,
                 display: sourceEntry.display, details: sourceEntry.details, timestamp: 1 }],
      }));
      return { entries: projected, messages: projected.flatMap((e: any) => e.messages), model: "m" };
    },
  };
}

const user = { type: "message", id: "u1", message: { role: "user", content: "hi" } };
const custom = (id: string, content: string) => ({ type: "custom_message", id, customType: "x", content, display: true });

function fakePi() {
  const handlers = new Map<string, Array<(e: any, ctx: any) => unknown>>();
  return {
    pi: { on(n: string, h: (e: any, ctx: any) => unknown) { handlers.set(n, [...(handlers.get(n) ?? []), h]); } },
    fire(n: string, e: unknown, ctx: unknown) { for (const h of handlers.get(n) ?? []) h(e, ctx); },
    names: () => [...handlers.keys()].sort(),
  };
}

test("RED repro: unwrapped pi projection gives custom messages a new identity each call", () => {
  const sm = fakeSm([user, custom("c1", "mail")]);
  const a = sm.buildSessionProjection().messages, b = sm.buildSessionProjection().messages;
  assert.equal(a[0], b[0]);
  assert.notEqual(a[1], b[1]);
});

test("wrapped: unchanged entries keep their message objects across projections", () => {
  const sm = fakeSm([user, custom("c1", "mail")]);
  assert.equal(wrapProjection(sm), "installed");
  const a = sm.buildSessionProjection(), b = sm.buildSessionProjection();
  assert.equal(a.messages.length, 2);
  a.messages.forEach((m: unknown, i: number) => assert.equal(m, b.messages[i]));
  assert.equal(a.entries[1].messages[0], b.entries[1].messages[0]);
  assert.equal(b.model, "m");
});

test("wrapped: changed content gets a new object (no stale message)", () => {
  const sm = fakeSm([user, custom("c1", "mail")]);
  wrapProjection(sm);
  const a = sm.buildSessionProjection().messages;
  sm.entries[1] = { ...sm.entries[1], content: "edited" };
  const b = sm.buildSessionProjection().messages;
  assert.notEqual(a[1], b[1]);
  assert.equal((b[1] as any).content, "edited");
});

test("wrapped: new entries appear, earlier ones stay identical", () => {
  const sm = fakeSm([user, custom("c1", "mail")]);
  wrapProjection(sm);
  const a = sm.buildSessionProjection().messages;
  sm.entries.push(custom("c2", "more"));
  const b = sm.buildSessionProjection().messages;
  assert.equal(b.length, 3);
  assert.equal(a[1], b[1]);
});

test("a delivered live custom message object is reused by the first projection of its entry", () => {
  const sm = fakeSm([user]);
  const f = fakePi();
  registerIdentityShim(f.pi, true);
  f.fire("session_start", {}, { sessionManager: sm });
  const live = { role: "custom", customType: "x", content: "mail", display: true, details: undefined, timestamp: 99 };
  f.fire("message_end", { message: live }, { sessionManager: sm });
  sm.entries.push(custom("c1", "mail"));
  const a = sm.buildSessionProjection().messages, b = sm.buildSessionProjection().messages;
  assert.equal(a[1], live);
  assert.equal(b[1], live);
});

test("feature detection: no buildSessionProjection → no-op, no throw", () => {
  assert.equal(wrapProjection({}), "absent");
  assert.equal(wrapProjection(undefined), "absent");
});

test("wrapping twice is a no-op", () => {
  const sm = fakeSm([user, custom("c1", "mail")]);
  assert.equal(wrapProjection(sm), "installed");
  assert.equal(wrapProjection(sm), "already");
  const a = sm.buildSessionProjection().messages, b = sm.buildSessionProjection().messages;
  assert.equal(a[1], b[1]);
});

test("unexpected projection shape passes through unchanged", () => {
  const odd = { messages: [{ role: "custom" }] };
  const sm = { buildSessionProjection: () => odd };
  wrapProjection(sm);
  assert.equal(sm.buildSessionProjection(), odd);
  const mismatch = { entries: [{ sourceEntry: {}, messages: [{ role: "custom" }] }], messages: [] as unknown[] };
  const sm2 = { buildSessionProjection: () => mismatch };
  wrapProjection(sm2);
  assert.equal(sm2.buildSessionProjection().messages.length, 0);
});

test("identityShim off → registers no handlers and leaves the session manager alone", () => {
  const sm = fakeSm([user, custom("c1", "mail")]);
  const orig = sm.buildSessionProjection;
  const f = fakePi();
  registerIdentityShim(f.pi, false);
  assert.deepEqual(f.names(), []);
  assert.equal(sm.buildSessionProjection, orig);
});

test("identityShim on → wraps the session manager at session_start", () => {
  const sm = fakeSm([user, custom("c1", "mail")]);
  const f = fakePi();
  registerIdentityShim(f.pi, true);
  assert.deepEqual(f.names(), ["message_end", "session_start"]);
  f.fire("session_start", {}, { sessionManager: sm });
  const a = sm.buildSessionProjection().messages, b = sm.buildSessionProjection().messages;
  assert.equal(a[1], b[1]);
});
