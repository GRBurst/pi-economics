import { test } from "node:test";
import assert from "node:assert/strict";
import { toolsFor } from "../core/toolguard.ts";
import type { Profile } from "../core/types.ts";
import { accepted, card, harness, provideSkills } from "./harness.ts";

const rig = () => { const h = harness(); provideSkills(h, ["code-reviewer", "tdd-implementation-planner"]); return h; };

const WRITERS = ["write", "edit"];
// Non-mutating extension tools a read-only child must keep (pi 1.4's `tools`
// allowlist filters extension tools too, so they must be named here):
// the search pair and infinite-context's read-only context tools.
const EXT_READ_ONLY = ["web_search", "web_fetch", "context_fold", "context_map", "context_peek", "context_search"];

const READ_ONLY = ["read", "grep", "find", "ls", "bash", ...EXT_READ_ONLY];

test("read-only profile → tool allowlist without write/edit, orchestration tools are added by actor-subagents", async () => {
  const r = accepted(await rig().a.spawn({ name: "s1", task: card({ kind: "scout" }) })) as any;
  assert.deepEqual(r.tools, READ_ONLY);
  assert.ok(WRITERS.every((w) => !r.tools.includes(w)));
  const rev = accepted(await rig().a.spawn({ name: "r1", task: card({ kind: "review" }) })) as any;
  assert.deepEqual(rev.tools, READ_ONLY);
});

test("lookup child (read-only profile) keeps the non-mutating extension tools in its allowlist", async () => {
  const r = accepted(await rig().a.spawn({ name: "l1", task: card({ kind: "lookup" }) })) as any;
  assert.ok(EXT_READ_ONLY.every((t) => r.tools.includes(t)), `lookup allowlist ${JSON.stringify(r.tools)} misses the read-only extension tools`);
  assert.ok(WRITERS.every((w) => !r.tools.includes(w)));
});

test("toolsFor: the read-only profiles keep the six non-mutating extension tools; read-only never has the writers", () => {
  for (const tools of ["read-only", "read-only+files"] as const) {
    const profile: Profile = { tools, skills: [], report: "default" };
    const { tools: allowlist } = toolsFor(profile, card(), "/work");
    assert.ok(allowlist);
    assert.ok(EXT_READ_ONLY.every((t) => (allowlist as string[]).includes(t)), `profile ${tools} misses ${JSON.stringify(EXT_READ_ONLY)}`);
    assert.ok(["read", "grep", "find", "ls", "bash"].every((t) => (allowlist as string[]).includes(t)));
    if (tools === "read-only") assert.ok(WRITERS.every((w) => !(allowlist as string[]).includes(w)), "read-only must not grant the writers");
  }
});

test("profile with all tools → no allowlist, no guard", async () => {
  const r = accepted(await harness().a.spawn({ name: "i1", task: card() })) as any;
  assert.equal(r.tools, undefined);
  assert.equal(r.toolGuard, undefined);
});

test("read-only+files: write/edit allowed only for paths ∈ card.files (resolved against cwd); reason names the allowed files", async () => {
  const r = accepted(await rig().a.spawn({ name: "p1", task: card({ kind: "plan", files: ["docs/plan.md", "/work/docs/notes.md"] }) })) as any;
  assert.deepEqual(r.tools, ["read", "grep", "find", "ls", "bash", ...EXT_READ_ONLY, "edit", "write"]);
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
