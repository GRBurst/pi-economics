// Local mode L2.T4 (design §3.6.1, §3.6.2, §2.5; AC-F3, AC-F4, AC-N3): the `/force` command, its session entries, the
// settings force at session_start, and the force in the status line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FORCE_TYPE } from "../core/force.ts";
import { statusText } from "../core/local/mode.ts";
import type { RouterSettings } from "../core/types.ts";
import { harness } from "./harness.ts";

type H = ReturnType<typeof harness>;
const SONNET = "anthropic/claude-sonnet-5-5";
const KNOWN = ["anthropic/claude-haiku-5-5", SONNET, "anthropic/claude-opus-5-5", "llama/qwen3.8", "other/model",
  ...Array.from({ length: 12 }, (_, i) => `extra/m${i}`)];
const USAGE = "usage: /force <model> [effort] [next[:N] | session] | /force off | /force";
const NOT_FORCED = "overseer reviews are not forced (they use overseer.*)";
/** A main ctx: a model registry over KNOWN, notify/status spies, the branch = the fake pi's appended entries. */
function ctxOf(h: H, o: { model?: { provider: string; id: string }; registry?: boolean } = {}) {
  const notes: [string, string][] = [], status: [string, string | undefined][] = [];
  const ctx = {
    hasUI: true, ...(o.model ? { model: o.model } : {}),
    ...(o.registry === false ? {} : { modelRegistry: {
      find: (p: string, id: string) => (KNOWN.includes(`${p}/${id}`) ? { provider: p, id } : undefined),
      getAvailable: () => KNOWN.map((k) => ({ provider: k.split("/")[0], id: k.slice(k.indexOf("/") + 1) })),
    } }),
    ui: { notify: (m: string, l: string) => void notes.push([m, l]), setStatus: (k: string, v: string | undefined) => void status.push([k, v]) },
    sessionManager: { getSessionId: () => "s-main", getBranch: () => h.f.entries.map((e) => ({ type: "custom", customType: e.type, data: e.data })) },
  };
  return { ctx, notes, status };
}
const force = async (h: H, args: string, ctx: unknown): Promise<void> => {
  const c = h.f.commands.get("force");
  assert.ok(c, "no /force command");
  await c.handler(args, ctx);
};
const forceLines = (h: H) => h.lines().filter((l) => l.event === "force");
const show = async (h: H, c: ReturnType<typeof ctxOf>): Promise<string> => {
  const before = c.notes.length;
  await force(h, "", c.ctx);
  assert.equal(c.notes.length, before + 1);
  assert.equal(c.notes.at(-1)![1], "info");
  return c.notes.at(-1)![0];
};
const start = (s: Partial<RouterSettings> = {}) => {
  const h = harness({ settings: s });
  const c = ctxOf(h);
  h.f.fire("session_start", {}, c.ctx);
  return { h, c };
};

test("statusText: the force part, alone in default mode, after local in local mode", () => {
  const localModels = ["llama/qwen3.8"];
  assert.equal(statusText({ local: false, localModels, force: "force a/b high" }), "force a/b high");
  assert.equal(statusText({ local: false, localModels, force: undefined }), undefined);
  assert.equal(statusText({ local: true, main: "llama/qwen3.8", localModels, force: "force a/b" }), "local · force a/b");
  assert.equal(statusText({ local: true, main: SONNET, localModels, force: "force a/b" }), `local (main: ${SONNET}) · force a/b`);
});

test("AC-F3: /force nosuch/model leaves the state unchanged, one error notification, one force rejected line", async () => {
  const { h, c } = start();
  await force(h, "nosuch/model", c.ctx);
  assert.deepEqual(c.notes, [[`task-router: /force: unknown model nosuch/model; available: ${KNOWN.slice(0, 10).join(", ")}`, "error"]]);
  assert.deepEqual(forceLines(h).map((l) => [l.action, l.source, l.model, l.reason]), [["rejected", "command", "nosuch/model", "unknown-model"]]);
  assert.deepEqual(h.f.entries, []);
  assert.equal(await show(h, c), "task-router: no force; routing decides");
  // a set force survives a rejected one
  await force(h, "sonnet", c.ctx);
  await force(h, "haiku/nope", c.ctx);
  assert.equal(c.notes.at(-1)![1], "error");
  assert.equal(await show(h, c), `task-router: force ${SONNET} (command)`);
  // no registry: every provider/id is unknown, with an empty list
  const d = start();
  const bare = ctxOf(d.h, { registry: false });
  await force(d.h, "other/model", bare.ctx);
  assert.deepEqual(bare.notes, [["task-router: /force: unknown model other/model; available: (none listed)", "error"]]);
});

test("usage: a malformed /force is a warning and a force rejected usage line; nothing is stored", async () => {
  const { h, c } = start();
  await force(h, "sonnet bogus", c.ctx);
  assert.deepEqual(c.notes, [[USAGE, "warning"]]);
  assert.deepEqual(forceLines(h).map((l) => [l.action, l.source, l.reason, "model" in l]), [["rejected", "command", "usage", false]]);
  assert.deepEqual(h.f.entries, []);
});

test("set/show/off: entries, notifications, force lines and the status line in default mode", async () => {
  const { h, c } = start();
  assert.deepEqual(c.status, []); // default mode, no force: the status line is never touched
  await force(h, "sonnet high next:2", c.ctx);
  assert.deepEqual(h.f.entries, [{ type: FORCE_TYPE, data: { model: SONNET, thinkingLevel: "high", scope: "next", remaining: 2, source: "command" } }]);
  assert.deepEqual(c.notes.at(-1), [`task-router: force ${SONNET} high for the next 2 spawns; ${NOT_FORCED}`, "info"]);
  assert.deepEqual(c.status.at(-1), ["task-router", `force ${SONNET} high (2 left)`]);
  assert.equal(await show(h, c), `task-router: force ${SONNET} high (2 left) (command)`);
  await force(h, "other/model max next", c.ctx);
  assert.deepEqual(c.notes.at(-1), [`task-router: force other/model max for the next spawn; ${NOT_FORCED}`, "info"]);
  await force(h, "opus session", c.ctx);
  assert.deepEqual(h.f.entries.at(-1), { type: FORCE_TYPE, data: { model: "anthropic/claude-opus-5-5", scope: "session", source: "command" } });
  assert.deepEqual(c.notes.at(-1), [`task-router: force anthropic/claude-opus-5-5 for the session; ${NOT_FORCED}`, "info"]);
  assert.deepEqual(c.status.at(-1), ["task-router", "force anthropic/claude-opus-5-5"]);
  await force(h, "off", c.ctx);
  assert.deepEqual(h.f.entries.at(-1), { type: FORCE_TYPE, data: { cleared: true } });
  assert.deepEqual(c.notes.at(-1), ["task-router: force cleared", "info"]);
  assert.deepEqual(c.status.at(-1), ["task-router", undefined]);
  assert.equal(await show(h, c), "task-router: no force; routing decides");
  assert.deepEqual(forceLines(h).map((l) => [l.action, l.source, l.model, l.effort]), [
    ["set", "command", SONNET, "high"], ["set", "command", "other/model", "max"], ["set", "command", "anthropic/claude-opus-5-5", undefined],
    ["clear", "command", undefined, undefined],
  ]);
});

test("set/show/off: in local mode the status line keeps local and adds the force", async () => {
  const h = harness({ settings: { mode: "local" } });
  const c = ctxOf(h, { model: { provider: "llama", id: "qwen3.8" } });
  h.f.fire("session_start", {}, c.ctx);
  assert.deepEqual(c.status, [["task-router", "local"]]);
  await force(h, "sonnet high", c.ctx);
  assert.deepEqual(c.status.at(-1), ["task-router", `local · force ${SONNET} high`]);
  h.f.fire("model_select", { model: { provider: "anthropic", id: "claude-opus-5-5" } }, c.ctx);
  assert.deepEqual(c.status.at(-1), ["task-router", `local (main: anthropic/claude-opus-5-5) · force ${SONNET} high`]);
  await force(h, "off", c.ctx);
  assert.deepEqual(c.status.at(-1), ["task-router", "local (main: anthropic/claude-opus-5-5)"]);
});

test("rebuild: a second install on the same branch restores the command force at session_start", async () => {
  const { h, c } = start();
  await force(h, "sonnet high next:3", c.ctx);
  const g = harness();
  g.f.entries.push(...h.f.entries);
  const d = ctxOf(g);
  g.f.fire("session_start", {}, d.ctx);
  assert.equal(await show(g, d), `task-router: force ${SONNET} high (3 left) (command)`);
  assert.deepEqual(d.status, [["task-router", `force ${SONNET} high (3 left)`]]);
  await force(g, "off", d.ctx);
  const k = harness();
  k.f.entries.push(...g.f.entries);
  const e = ctxOf(k);
  k.f.fire("session_start", {}, e.ctx);
  assert.equal(await show(k, e), "task-router: no force; routing decides");
});

test("AC-F4 settings unresolvable: one notification at session_start naming it, a force rejected settings line, the force inactive", async () => {
  const { h, c } = start({ force: { model: "nosuch/x", thinkingLevel: "" } });
  assert.equal(c.notes.length, 1);
  assert.equal(c.notes[0][1], "warning");
  assert.ok(c.notes[0][0].includes("force.model: unknown model nosuch/x; the settings force is inactive"), c.notes[0][0]);
  assert.deepEqual(forceLines(h).map((l) => [l.action, l.source, l.model, l.reason]), [["rejected", "settings", "nosuch/x", "unknown-model"]]);
  h.f.fire("session_start", {}, c.ctx); // once per process
  assert.equal(c.notes.length, 1);
  assert.equal(forceLines(h).length, 1);
  assert.equal(await show(h, c), "task-router: no force; routing decides");
  assert.deepEqual(c.status, []);
});

test("settings force: a resolvable one is active from session_start; /force off clears only the command force", async () => {
  const { h, c } = start({ force: { model: "sonnet", thinkingLevel: "high" } });
  assert.deepEqual(c.notes, []);
  assert.deepEqual(c.status, [["task-router", `force ${SONNET} high`]]);
  assert.equal(await show(h, c), `task-router: force ${SONNET} high (settings)`);
  await force(h, "opus next", c.ctx);
  assert.equal(await show(h, c), "task-router: force anthropic/claude-opus-5-5 (1 left) (command)");
  await force(h, "off", c.ctx);
  assert.deepEqual(c.notes.at(-1), [`task-router: force cleared; the settings force ${SONNET} high applies`, "info"]);
  assert.deepEqual(c.status.at(-1), ["task-router", `force ${SONNET} high`]);
  const p = start({ force: { model: "other/model", thinkingLevel: "" } }); // provider/id through the registry
  assert.equal(await show(p.h, p.c), "task-router: force other/model (settings)");
});

test("routing off: /force says that no spawn is forced", async () => {
  const { h, c } = start({ routing: false });
  await force(h, "sonnet", c.ctx);
  assert.deepEqual(c.notes.at(-1), [`task-router: force ${SONNET} for the session; ${NOT_FORCED}; routing is off, so no spawn is forced`, "info"]);
  assert.equal(await show(h, c), `task-router: force ${SONNET} (command); routing is off, so no spawn is forced`);
});
