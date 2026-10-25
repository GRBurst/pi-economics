import { test } from "node:test";
import assert from "node:assert/strict";
import { accepted, card, harness, provideSkills } from "./harness.ts";

const rig = () => { const h = harness(); provideSkills(h, ["code-reviewer", "tdd-implementation-planner"]); return h; };

const WRITERS = ["write", "edit"];

test("read-only profile → tool allowlist without write/edit, orchestration tools are added by actor-subagents", async () => {
  const r = accepted(await rig().a.spawn({ name: "s1", task: card({ kind: "scout" }) })) as any;
  assert.deepEqual(r.tools, ["read", "grep", "find", "ls", "bash"]);
  assert.ok(WRITERS.every((w) => !r.tools.includes(w)));
  const rev = accepted(await rig().a.spawn({ name: "r1", task: card({ kind: "review" }) })) as any;
  assert.deepEqual(rev.tools, ["read", "grep", "find", "ls", "bash"]);
});

test("profile with all tools → no allowlist, no guard", async () => {
  const r = accepted(await harness().a.spawn({ name: "i1", task: card() })) as any;
  assert.equal(r.tools, undefined);
  assert.equal(r.toolGuard, undefined);
});

test("read-only+files: write/edit allowed only for paths ∈ card.files (resolved against cwd); reason names the allowed files", async () => {
  const r = accepted(await rig().a.spawn({ name: "p1", task: card({ kind: "plan", files: ["docs/plan.md", "/work/docs/notes.md"] }) })) as any;
  assert.deepEqual(r.tools, ["read", "grep", "find", "ls", "bash", "edit", "write"]);
  const g = r.toolGuard as (t: string, i: unknown) => string | undefined;
  for (const tool of WRITERS) {
    assert.equal(g(tool, { path: "docs/plan.md" }), undefined);
    assert.equal(g(tool, { path: "/work/docs/plan.md" }), undefined);
    assert.equal(g(tool, { path: "docs/notes.md" }), undefined);
    const bad = g(tool, { path: "src/a.ts" });
    assert.match(bad!, /\/work\/docs\/plan\.md/);
    assert.match(bad!, /\/work\/docs\/notes\.md/);
    assert.match(bad!, /src\/a\.ts/);
    assert.ok(g(tool, { path: "docs/../src/a.ts" }));
    assert.ok(g(tool, { path: "/etc/passwd" }));
    assert.ok(g(tool, {}));
    assert.ok(g(tool, "not an object"));
  }
  assert.equal(g("read", { path: "src/a.ts" }), undefined);
  assert.equal(g("bash", { command: "ls" }), undefined);
});
