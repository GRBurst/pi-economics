import { test } from "node:test";
import assert from "node:assert/strict";
import { systemHash } from "../core/system-hash.ts";

// M3b (M2a review carry-over): the hash of the system state a request ran under (prompt, sections, tools), replayed from
// its system messages like pi-ai 1.4's getCurrentSystemMessage, so the analyser can tell a prefix change from `other`.
const tool = (name: string, description = "d") => ({ name, description, parameters: { type: "object", properties: {} } });
const sys = (extra: object = {}) => ({ role: "system", content: "You are pi.", timestamp: 1, ...extra });
const user = { role: "user", content: "hi", timestamp: 2 };
const S0 = sys({ sections: { a: "A", b: "B" }, toolsAdded: [tool("read"), tool("bash")] });

test("systemHash: 16 hex digits, a function of the system state only (user and assistant messages, timestamps ignored)", () => {
  const h = systemHash([S0, user]);
  assert.match(h ?? "", /^[0-9a-f]{16}$/);
  assert.equal(systemHash([{ ...S0, timestamp: 99 }, user, { role: "assistant", content: [] }]), h);
  assert.equal(systemHash([S0]), h);
  assert.equal(systemHash([user]), undefined);
  assert.equal(systemHash([]), undefined);
  assert.equal(systemHash(undefined), undefined);
});

test("systemHash: changes with the prompt, a section, the tool list or a tool's declaration (description, parameters)", () => {
  const h = systemHash([S0, user]);
  const changed = [
    [sys({ content: "You are pi!", sections: { a: "A", b: "B" }, toolsAdded: [tool("read"), tool("bash")] })],
    [S0, user, sys({ content: "", sections: { a: "A2" } })],
    [S0, user, sys({ content: "", sections: { b: null } })],
    [S0, user, sys({ content: "", sections: { c: "C" } })],
    [S0, user, sys({ content: "Also this." })],
    [S0, user, sys({ content: "", toolsAdded: [tool("grep")] })],
    [S0, user, sys({ content: "", toolsRemoved: [{ name: "bash" }] })],
    [S0, user, sys({ content: "", toolsAdded: [tool("read", "new text")] })],
    [S0, user, sys({ content: "", toolsAdded: [{ ...tool("read"), parameters: { type: "object", properties: { path: { type: "string" } } } }] })],
  ];
  const hashes = changed.map((ms) => systemHash(ms));
  for (const [i, x] of hashes.entries()) assert.notEqual(x, h, String(i));
  assert.equal(new Set(hashes).size, hashes.length);
});

test("systemHash: the replayed state decides, not the path to it", () => {
  const h = systemHash([S0]);
  // a section toggled off and on again, a tool removed and re-added: the state of S0 again
  assert.equal(systemHash([S0, user, sys({ content: "", sections: { a: null } }), user, sys({ content: "", sections: { a: "A" } })]),
    systemHash([sys({ sections: { b: "B", a: "A" }, toolsAdded: [tool("read"), tool("bash")] })]));
  assert.equal(systemHash([S0, sys({ content: "", toolsRemoved: [{ name: "bash" }] }), sys({ content: "", toolsAdded: [tool("bash")] })]), h);
  // text blocks read like a string (pi's contentText)
  assert.equal(systemHash([{ ...S0, content: [{ type: "text", text: "You are pi." }, { type: "image", data: "x" }] }]), h);
});
