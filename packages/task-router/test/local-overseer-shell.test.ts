// Local mode L4.T12 (design §3.0.4, §3.0.2, §2.5; plan D30, Q19): the shell's overseer wiring. The spawn-API warning, the
// `task-router/budget` entries and their rebuild at session_start, and the Opus budget in the status line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { statusText } from "../core/local/mode.ts";
import { NO_SPAWN_API, verdictSubmit } from "../core/local/overseer.ts";
import type { RouterSettings } from "../core/types.ts";
import { harness } from "./harness.ts";
import { VALID, type Ok } from "./overseer-rig.ts";

type H = ReturnType<typeof harness>;
/** A main ctx: notify/status spies, the branch = the fake pi's appended entries. */
function ctxOf(h: H) {
  const notes: [string, string][] = [], status: [string, string | undefined][] = [];
  const ctx = {
    hasUI: true,
    ui: { notify: (m: string, l: string) => void notes.push([m, l]), setStatus: (k: string, v: string | undefined) => void status.push([k, v]) },
    sessionManager: { getSessionId: () => "s-main", getBranch: () => h.f.entries.map((e) => ({ type: "custom", customType: e.type, data: e.data })) },
  };
  return { ctx, notes, status };
}
const start = (s: Partial<RouterSettings>, apiExt: boolean, entries: H["f"]["entries"] = []) => {
  const h = harness({ settings: s, apiExt });
  h.f.entries.push(...entries);
  const c = ctxOf(h);
  h.f.fire("session_start", {}, c.ctx);
  return { h, c };
};
/** One merge review through the shell's overseer; the child submits a valid verdict at the first poll. */
const review = async (h: H) => {
  h.hooks.onSleep = () => { void (h.a.apiSpawns.at(-1)!.policy as Ok).childTools![0]!.execute(VALID); };
  const r = await h.router.overseer.run({ role: "merge", input: "review this", cwd: "/wt", submit: verdictSubmit() });
  assert.equal(r.ok, true);
};
const budgets = (h: H) => h.f.entries.filter((e) => e.type === "task-router/budget").map((e) => e.data);

test("missing API extension: one warning in local mode, none on a second session_start, none in default mode or with it", () => {
  const { h, c } = start({ mode: "local" }, false);
  h.f.fire("session_start", {}, c.ctx);
  assert.deepEqual(c.notes.filter(([m]) => m === NO_SPAWN_API), [[NO_SPAWN_API, "warning"]]);
  assert.equal(NO_SPAWN_API, "task-router: local mode needs actor-subagents with spawnPolicyApi ≥ 2; merges are refused and plans are unavailable");
  for (const [s, ext] of [[{}, false], [{ mode: "local" }, true]] as const) {
    assert.deepEqual(start(s, ext).c.notes.filter(([m]) => m === NO_SPAWN_API), [], JSON.stringify(s));
  }
});

test("budget persisted: one entry per spawn; a session rebuilt from them starts at the last", async () => {
  const { h } = start({ mode: "local" }, true);
  await review(h);
  await review(h);
  assert.deepEqual(budgets(h), [{ opusUsed: 1, steerUsed: 0 }, { opusUsed: 2, steerUsed: 0 }]);
  const g = start({ mode: "local" }, true, h.f.entries).h;
  assert.deepEqual(g.router.budget, { opusUsed: 2, steerUsed: 0 });
  assert.deepEqual(start({ mode: "local" }, true).h.router.budget, { opusUsed: 0, steerUsed: 0 });
});

test("status: the Opus budget once at most 3 are left (Q19), after a rebuild and after a spawn", async () => {
  const { h, c } = start({ mode: "local", overseer: { budget: 5 } } as never, true);
  assert.deepEqual(c.status.at(-1), ["task-router", "local"]);
  await review(h);
  assert.deepEqual(c.status.at(-1), ["task-router", "local"]);
  await review(h);
  assert.deepEqual(c.status.at(-1), ["task-router", "local · opus 3 left"]);
  const g = start({ mode: "local", overseer: { budget: 5 } } as never, true, h.f.entries);
  assert.deepEqual(g.c.status.at(-1), ["task-router", "local · opus 3 left"]);
  assert.equal(statusText({ local: true, localModels: [], force: "force m high", opusLeft: 0, hint: "repeat-call" }),
    "local · force m high · opus 0 left · hint repeat-call");
});

test("review F5 (LD14): the shell's overseer defaults its cwd to the main session's (the main checkout)", async () => {
  const h = harness({ settings: { mode: "local" }, apiExt: true });
  h.f.fire("session_start", {}, { ...ctxOf(h).ctx, cwd: "/main" });
  h.hooks.onSleep = () => { void (h.a.apiSpawns.at(-1)!.policy as Ok).childTools![0]!.execute(VALID); };
  assert.equal((await h.router.overseer.run({ role: "merge", input: "review this", submit: verdictSubmit() })).ok, true);
  assert.equal((h.a.apiSpawns[0]!.policy as Ok).cwd, "/main");
});
