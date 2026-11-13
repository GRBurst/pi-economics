// The session-entry contract (redesign §7.4 "Contract tests per add-on", M7c): the engine's real code (experiments'
// core/shell.ts with the registered add-ons) and a target that adopts recorded values the way infinite-context does
// (entry-ext/index.ts) run in one fake runtime, the engine first as in pi-economics' load order. A level the target
// can adopt is read back as confirmed; a level it cannot (it draws and records its own) as refused with what it used;
// with no target loaded nothing contradicts the seed (the seed-tier limit, pinned here so that changing it is a
// decision). Like log-contract, the test fakes of the package stand in for pi.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onAssigned, type Levers } from "../../packages/experiments/core/channel.ts";
import { defaults } from "../../packages/experiments/core/settings.ts";
import { install } from "../../packages/experiments/core/shell.ts";
import { fakePi } from "../../packages/experiments/test/fake.ts";
import entryExt, { CUSTOM_TYPE, FIELD, RANGE, USED } from "./entry-ext/index.ts";

beforeEach(() => void delete (globalThis as { __piEconomicsWarned_v1?: unknown }).__piEconomicsWarned_v1);

const LEVER = `session-entry(${CUSTOM_TYPE},${FIELD})`;

function runtime(levels: [number, number], target: boolean) {
  const agentDir = mkdtempSync(join(tmpdir(), "session-entry-contract-"));
  const f = fakePi();
  const heard: Levers[] = [];
  const used: Array<{ sessionId: string; value: number }> = [];
  onAssigned(f.events, (l) => void heard.push(l));
  f.events.on(USED, (u) => void used.push(u));
  const settings = { ...defaults(), strata: { all: { match: {}, objective: "apiUsd", factors: [{ name: "nudge", lever: LEVER, levels }] } } };
  install(f.pi, { agentDir, settings, rng: () => 0.5, api: () => undefined }); // the engine registers first
  if (target) entryExt(f.pi);
  const ctx = { model: { provider: "openai", id: "gpt-5" }, sessionManager: { getSessionId: () => "s1", getSessionDir: () => join(agentDir, "sessions"), getSessionFile: () => join(agentDir, "sessions", "x_s1.jsonl"), getBranch: () => f.entries } };
  f.fire("session_start", { type: "session_start", reason: "startup" }, ctx);
  f.fire("before_agent_start", { type: "before_agent_start", prompt: "x" }, ctx);
  const last = heard.at(-1)!;
  return { ...f, heard, used, last, assigned: last.factors!.nudge.assigned as number, state: last.levers[LEVER] };
}

test("T7c.3 adopted: a level inside the target's range is what the target runs with, and the read-back confirms it", () => {
  const r = runtime([RANGE[0], RANGE[1]], true);
  assert.deepEqual(r.used, [{ sessionId: "s1", value: r.assigned }]);
  assert.deepEqual(r.state, { v: r.assigned, s: "pe", a: r.assigned, rb: "confirmed", tier: "seed" });
  assert.deepEqual(r.entries.filter((e) => e.customType === CUSTOM_TYPE).map((e) => e.data), [{ [FIELD]: r.assigned }], "the seed only: the target recorded nothing");
});

test("T7c.3 ignored: a level outside the target's range is redrawn by the target; the read-back is refused with the target's own value, source ext", () => {
  const r = runtime([RANGE[1] + 100, RANGE[1] + 200], true);
  const own = Math.round((RANGE[0] + RANGE[1]) / 2);
  assert.deepEqual(r.used, [{ sessionId: "s1", value: own }]);
  assert.deepEqual(r.state, { v: own, s: "ext", a: r.assigned, rb: "refused", tier: "seed" });
  assert.deepEqual(r.entries.filter((e) => e.customType === CUSTOM_TYPE).map((e) => e.data), [{ [FIELD]: r.assigned }, { [FIELD]: own }], "the seed, then the target's draw");
});

test("T7c.3 the seed is written before the target reads: the target's session_start finds it on the branch", () => {
  const r = runtime([RANGE[0], RANGE[1]], true);
  const types = r.entries.map((e) => e.customType);
  assert.ok(types.indexOf(CUSTOM_TYPE) > types.indexOf("pi-economics:assignment"));
  assert.equal(r.used[0].value, r.assigned, "adopted at its own session_start, not a later redraw");
});

test("T7c.3 no target loaded: nothing contradicts the seed, so the read-back confirms it (seed-tier limit: adoption is not observable)", () => {
  const r = runtime([RANGE[0], RANGE[1]], false);
  assert.deepEqual(r.used, []);
  assert.deepEqual(r.state, { v: r.assigned, s: "pe", a: r.assigned, rb: "confirmed", tier: "seed" });
});
