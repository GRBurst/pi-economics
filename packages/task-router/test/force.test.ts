// Local mode L2.T1 (design §3.6): the pure force core — the command's grammar, model references, the session entry's
// countdown and rebuild, and the precedence of a command force over the settings force.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FORCE_TYPE, consume, describeForce, effective, parseForce, rebuild, resolveRef } from "../core/force.ts";
import type { ActiveForce, ForceEntry } from "../core/force.ts";
import { defaults } from "../core/settings.ts";

test("parseForce: show, off, set with effort and scope, and every malformed input is usage", () => {
  const cases: [string, unknown][] = [
    ["", { op: "show" }],
    ["   ", { op: "show" }],
    ["off", { op: "off" }],
    [" off ", { op: "off" }],
    ["sonnet", { op: "set", ref: "sonnet", scope: "session" }],
    ["sonnet high", { op: "set", ref: "sonnet", effort: "high", scope: "session" }],
    ["sonnet next", { op: "set", ref: "sonnet", scope: "next", n: 1 }],
    ["sonnet high next:2", { op: "set", ref: "sonnet", effort: "high", scope: "next", n: 2 }],
    ["sonnet  max   next:12", { op: "set", ref: "sonnet", effort: "max", scope: "next", n: 12 }],
    ["a/b session", { op: "set", ref: "a/b", scope: "session" }],
    ["a/b off session", { op: "set", ref: "a/b", effort: "off", scope: "session" }],
    ["sonnet next:0", { op: "usage" }],
    ["sonnet next:01", { op: "usage" }],
    ["sonnet next:", { op: "usage" }],
    ["sonnet bogus", { op: "usage" }],
    ["sonnet next high", { op: "usage" }],
    ["sonnet high high", { op: "usage" }],
    ["sonnet session next", { op: "usage" }],
    ["sonnet high next extra", { op: "usage" }],
  ];
  for (const [args, want] of cases) assert.deepEqual(parseForce(args), want, JSON.stringify(args));
});

test("resolveRef: a member maps to its model, a blank member is unknown, provider/id splits at the first slash", () => {
  const models = defaults().models; // qwen-cloud is blank
  const asked: [string, string][] = [];
  const known = new Set(["anthropic/x", "openrouter/qwen/x:free"]);
  const find = (p: string, id: string) => { asked.push([p, id]); return known.has(`${p}/${id}`) ? {} : undefined; };
  assert.equal(resolveRef("sonnet", models, find), "anthropic/claude-sonnet-5-5");
  assert.equal(resolveRef("qwen-cloud", models, find), undefined);
  assert.equal(resolveRef("anthropic/x", models, find), "anthropic/x");
  assert.deepEqual(asked.at(-1), ["anthropic", "x"]);
  assert.equal(resolveRef("openrouter/qwen/x:free", models, find), "openrouter/qwen/x:free");
  assert.deepEqual(asked.at(-1), ["openrouter", "qwen/x:free"]);
  assert.equal(resolveRef("nosuch/model", models, find), undefined);
  assert.equal(resolveRef("nosuch", models, find), undefined);
  assert.equal(resolveRef("/x", models, find), undefined);
  assert.equal(resolveRef("x/", models, find), undefined);
});

test("consume: a next:N force stays live for exactly N spawns, the last one expires it into {cleared: true}", () => {
  const live = (e: ForceEntry | undefined) => effective(e, undefined) !== undefined;
  for (let n = 1; n <= 6; n++) {
    let e: ForceEntry | undefined = { model: "a/b", scope: "next", remaining: n, source: "command" };
    let lives = 0, expired: boolean[] = [];
    while (live(e)) {
      lives++;
      const r = consume(e);
      expired.push(r.expired);
      e = r.next;
      assert.ok(lives <= n, `N=${n}: more than N live states`);
    }
    assert.equal(lives, n);
    assert.deepEqual(expired, [...Array(n - 1).fill(false), true]);
    assert.deepEqual(e, { cleared: true });
  }
  const s: ForceEntry = { model: "a/b", scope: "session", source: "command" };
  assert.deepEqual(consume(s), { next: s, expired: false });
  assert.deepEqual(consume(undefined), { next: undefined, expired: false });
  assert.deepEqual(consume({ cleared: true }), { next: { cleared: true }, expired: false });
});

test("effective: a live command force wins over the settings force, otherwise the settings force applies", () => {
  const set: ActiveForce = { model: "s/x", thinkingLevel: "low", source: "settings" };
  const cmds: [ForceEntry | undefined, ActiveForce | undefined][] = [
    [{ model: "c/y", thinkingLevel: "max", scope: "session", source: "command" }, { model: "c/y", thinkingLevel: "max", source: "command" }],
    [{ model: "c/y", scope: "next", remaining: 2, source: "command" }, { model: "c/y", source: "command", remaining: 2 }],
    [{ model: "c/y", scope: "next", remaining: 0, source: "command" }, undefined],
    [{ cleared: true }, undefined],
    [undefined, undefined],
  ];
  for (const [cmd, live] of cmds) {
    assert.deepEqual(effective(cmd, set), live ?? set, JSON.stringify(cmd));
    assert.deepEqual(effective(cmd, undefined), live, JSON.stringify(cmd));
  }
});

test("rebuild: the last force entry on the branch, other custom types and non-custom entries ignored", () => {
  const custom = (customType: string, data: unknown) => ({ type: "custom", customType, data });
  const a = { model: "a/b", scope: "session", source: "command" };
  const b = { model: "c/d", thinkingLevel: "high", scope: "next", remaining: 1, source: "command" };
  assert.equal(rebuild([]), undefined);
  assert.equal(rebuild([{ type: "message", customType: FORCE_TYPE, data: a }, custom("other", a)]), undefined);
  assert.deepEqual(rebuild([custom(FORCE_TYPE, a), custom(FORCE_TYPE, b), custom("other", { cleared: true }), { type: "message" }]), b);
  assert.deepEqual(rebuild([custom(FORCE_TYPE, b), custom(FORCE_TYPE, { cleared: true })]), { cleared: true });
  assert.equal(rebuild([custom(FORCE_TYPE, a), custom(FORCE_TYPE, { model: 7 })]), undefined); // a malformed last entry is no force
  assert.equal(rebuild([null, 3, "x", custom(FORCE_TYPE, null)]), undefined);
});

test("describeForce: model, effort when set, remaining for a countdown", () => {
  assert.equal(describeForce({ model: "a/b", source: "command" }), "force a/b");
  assert.equal(describeForce({ model: "a/b", thinkingLevel: "high", source: "settings" }), "force a/b high");
  assert.equal(describeForce({ model: "a/b", thinkingLevel: "high", source: "command", remaining: 2 }), "force a/b high (2 left)");
});
