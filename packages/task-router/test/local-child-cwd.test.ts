// Local mode L5.T9 (design §2.2 item 2, LD2; plan D38): while a worktree is active a card without `cwd` gets it, and the
// child's session starts there (`PolicyResult.cwd`, spawnPolicyApi 2). Default mode answers exactly as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PolicyResult } from "../core/api.ts";
import type { BranchRecord } from "../core/local/branches.ts";
import type { FsPort } from "../core/verify.ts";
import { accepted, card, harness, provideSkills } from "./harness.ts";

const FS: FsPort = {
  exists: (p) => p.startsWith("/wt/src/") || p.startsWith("/other/src/"),
  size: () => 1000,
  isDir: (p) => ["/wt", "/wt/src", "/other", "/other/src", "/work"].includes(p),
};
const REC: BranchRecord = { repo: "/r/x", branch: "lm/a", worktree: "/wt", base: "b", state: "active", rejections: 0, fixerRuns: 0 };
type Guard = (t: string, i: unknown) => string | undefined;
function rig(settings: Record<string, unknown> = { mode: "local" }, active: BranchRecord | null = REC) {
  const runs: { cmd: string; cwd: string }[] = [];
  const h = harness({ settings: settings as never, extra: { fs: FS, run: async (cmd: string, cwd: string) => { runs.push({ cmd, cwd }); return { exit: 0, output: "", timedOut: false }; } } as never });
  if (active) h.router.branches.put(active);
  provideSkills(h, ["tdd-implementation-planner"]);
  return { h, runs };
}
const keys = (r: PolicyResult): string[] => Object.keys(r).sort();

test("a card without cwd gets the active worktree: the result's cwd, and the guard resolves card files and the child's paths under it", async () => {
  const { h } = rig();
  const r = accepted(await h.a.spawn({ name: "c1", task: card({ kind: "plan", files: ["src/a.ts"] }) })) as Extract<PolicyResult, { model: string }>;
  assert.equal(r.cwd, "/wt");
  const g = r.toolGuard as Guard;
  assert.equal(g("edit", { path: "src/a.ts" }), undefined);
  assert.equal(g("edit", { path: "/wt/src/a.ts" }), undefined);
  assert.match(g("edit", { path: "src/b.ts" })!, /limited to the files of your task card: \/wt\/src\/a\.ts/);
  assert.match(g("write", { path: "/work/src/a.ts" })!, /not one of them/);
});

test("the card's own cwd wins over the worktree and is the child's cwd", async () => {
  const { h } = rig();
  const r = accepted(await h.a.spawn({ name: "c2", task: card({ kind: "plan", cwd: "/other", files: ["src/a.ts"] }) })) as Extract<PolicyResult, { model: string }>;
  assert.equal(r.cwd, "/other");
  assert.equal((r.toolGuard as Guard)("edit", { path: "src/a.ts" }), undefined);
  assert.match((r.toolGuard as Guard)("edit", { path: "/wt/src/a.ts" })!, /limited to the files/);
});

test("a card cwd equal to the caller's cwd adds no cwd key; no active worktree adds none either", async () => {
  const { h } = rig();
  const same = accepted(await h.a.spawn({ name: "c3", task: card({ cwd: "/work", files: ["src/a.ts"] }) }));
  assert.ok(!("cwd" in same), keys(same).join());
  const none = rig({ mode: "local" }, null);
  const r = accepted(await none.h.a.spawn({ name: "c4", task: card({ files: ["src/a.ts"] }) }));
  assert.ok(!("cwd" in r), keys(r).join());
  const merged = rig({ mode: "local" }, { ...REC, state: "merged" });
  assert.ok(!("cwd" in accepted(await merged.h.a.spawn({ name: "c5", task: card({ files: ["src/a.ts"] }) }))));
});

test("the files resolve under the worktree: a file that exists there is not unresolved", async () => {
  const { h } = rig();
  accepted(await h.a.spawn({ name: "c6", task: card({ files: ["src/a.ts"] }) }));
  h.a.emit({ type: "spawn", name: "c6", by: "main", parent: "main", childSessionId: "s-c6", ts: 1 });
  const line = h.lines().find((l) => l.event === "spawn" && l.taskId === "c6")!;
  assert.equal(line.unresolved, undefined, JSON.stringify(line.reasons));
  assert.equal(line.base, "qwen");
});

test("the verify gate runs the check in the worktree", async () => {
  const { h, runs } = rig();
  accepted(await h.a.spawn({ name: "g1", task: card({ check: "npm test" }) }));
  h.a.agents.splice(0, h.a.agents.length, { name: "g1", parent: "main", sessionId: "g1", model: "x", thinkingLevel: "xhigh", state: "idle" });
  h.a.emit({ type: "route", from: "g1", to: "main", preview: "done", buffered: false, ts: 1 });
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.deepEqual(runs, [{ cmd: "npm test", cwd: "/wt" }]);
});

test("default mode: no cwd key, today's keys, whatever the card and an active branch say", async () => {
  const { h } = rig({ worktrees: { enabled: "on" } }); // default mode with worktrees on and an active record
  for (const [i, c] of [card({ files: ["src/a.ts"] }), card({ cwd: "/other", files: ["src/a.ts"] }), card({ kind: "lookup", files: [] }),
    card({ kind: "plan", files: ["src/a.ts"] })].entries()) {
    const r = accepted(await h.a.spawn({ name: `d${i}`, task: c }));
    assert.ok(!("cwd" in r), `${c.kind}: ${keys(r).join()}`);
    for (const k of keys(r)) assert.ok(["briefAppend", "meta", "model", "thinkingLevel", "tools", "toolGuard"].includes(k), `${c.kind}: key ${k}`);
  }
});
