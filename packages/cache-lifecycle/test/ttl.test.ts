import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTtl } from "../core/ttl.ts";

const payload = () => ({
  model: "m",
  system: [{ type: "text", text: "s", cache_control: { type: "ephemeral" } }],
  tools: [{ name: "t", cache_control: { type: "ephemeral", ttl: "5m" } }],
  messages: [
    { role: "user", content: [{ type: "text", text: "a" }] },
    { role: "user", content: [{ type: "text", text: "b", cache_control: { type: "ephemeral" } }] },
  ],
});

test("sets ttl on every cache_control breakpoint, keeps the rest", () => {
  const out = applyTtl(payload(), "1h") as ReturnType<typeof payload>;
  assert.deepEqual(out.system[0].cache_control, { type: "ephemeral", ttl: "1h" });
  assert.deepEqual(out.tools[0].cache_control, { type: "ephemeral", ttl: "1h" });
  assert.deepEqual((out.messages[1].content[0] as any).cache_control, { type: "ephemeral", ttl: "1h" });
  assert.deepEqual(out.messages[0], payload().messages[0]);
});

test("does not mutate its input", () => {
  const p = payload();
  applyTtl(p, "1h");
  assert.deepEqual(p, payload());
});

test("non-object payloads pass through", () => {
  for (const v of [undefined, null, "x", 3]) assert.equal(applyTtl(v, "1h"), v);
});
