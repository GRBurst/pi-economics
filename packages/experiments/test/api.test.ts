// The process-global API (plan S11): armFor / flag / inherit. P19: flag honours child inheritance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../core/api.ts";

const arm = { id: "+-", flags: { warmPolicy: "orchestrator-aware", mainCacheTtl: "5m" } };

test("flag: main session → the arm's value; unknown session or unknown factor → the default", () => {
  const { api, assign } = createApi(() => "main-1");
  assign("main-1", arm);
  assert.equal(api.version, 1);
  assert.equal(api.flag("warmPolicy", "native", "main-1"), "orchestrator-aware");
  assert.equal(api.flag("foldHint", "fixed", "main-1"), "fixed");
  assert.equal(api.flag("warmPolicy", "native", "other"), "native");
  assert.equal(api.armFor("other"), undefined);
});

test("flag without a session id uses the current main session", () => {
  const { api, assign } = createApi(() => "main-1");
  assert.equal(api.flag("warmPolicy", "native"), "native");
  assign("main-1", arm);
  assert.equal(api.flag("warmPolicy", "native"), "orchestrator-aware");
});

test("P19: an inherited child (and its own children) sees the parent's arm and flags", () => {
  const { api, assign } = createApi(() => "main-1");
  assign("main-1", arm);
  api.inherit("child", "main-1");
  api.inherit("grandchild", "child");
  assert.deepEqual(api.armFor("child"), arm);
  assert.equal(api.flag("warmPolicy", "native", "child"), "orchestrator-aware");
  assert.equal(api.flag("warmPolicy", "native", "grandchild"), "orchestrator-aware");
});

test("inherit cycles terminate", () => {
  const { api } = createApi(() => undefined);
  api.inherit("a", "b");
  api.inherit("b", "a");
  assert.equal(api.armFor("a"), undefined);
});

// T13.7: a process restart drops the in-memory inheritance of a resumed child (its spawn
// event fired before the api knew its root), so the arm is re-derived from the session-file
// parent (`resolveParent`, the same rule token-meter uses for parentSessionId) up to the root.
test("resumed child without a spawn event: the session-path parent's arm, cached", () => {
  let lookups = 0;
  const { api, assign } = createApi(() => "main-1", (sid) => {
    lookups++;
    return sid === "child" ? "main-1" : undefined;
  });
  assign("main-1", arm);
  assert.deepEqual(api.armFor("child"), arm);
  assert.equal(api.flag("warmPolicy", "native", "child"), "orchestrator-aware");
  assert.deepEqual(api.armFor("child"), arm);
  assert.equal(lookups, 1); // the resolution is cached: no second path lookup
});

test("resumed grandchild climbs the session-path chain to the root's arm", () => {
  const { api, assign } = createApi(() => "main-1", (sid) => (sid === "g" ? "child" : sid === "child" ? "main-1" : undefined));
  assign("main-1", arm);
  assert.deepEqual(api.armFor("g"), arm);
  assert.deepEqual(api.armFor("child"), arm); // the intermediate hop is cached too
});

test("root session without an assignment stays unknown, as does a child of it", () => {
  const { api } = createApi(() => undefined, (sid) => (sid === "a" ? "root" : undefined));
  assert.equal(api.armFor("a"), undefined);
  assert.equal(api.armFor("root"), undefined);
});

test("resolveParent cycles and self-parents terminate", () => {
  const cyclic = createApi(() => undefined, (sid) => (sid === "a" ? "b" : "a")).api;
  assert.equal(cyclic.armFor("a"), undefined);
  const selfParent = createApi(() => undefined, () => "x").api;
  assert.equal(selfParent.armFor("x"), undefined);
});
