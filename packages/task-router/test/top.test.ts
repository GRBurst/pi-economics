// Legs and floors above top(a) (review G2: M1, M2, m3, m4). Spec §5.4 "never a crash": a requirement or a worker leg above
// top(a) rejects the spawn cleanly, as the tier pipeline did when its tier's member was blank; a review leg above top(a) is
// lowered to it (the tier pipeline kept a blank tier's review as a label and routed). The member cap is per table (owner, M2 (b)).
import { test } from "node:test";
import assert from "node:assert/strict";
import { card, harness, provideSkills } from "./harness.ts";
import { profileFor } from "../core/profile.ts";
import { defaults, parseSettings } from "../core/settings.ts";
import type { Importance } from "../core/types.ts";

const SONNET = "anthropic/claude-sonnet-5-5", OPUS = "anthropic/claude-opus-5-5", FREE = "openrouter/qwen/qwen3.8-27b:free";
const SK = ["systematic-debugging", "code-reviewer", "tdd-implementation-planner"];
const KINDS = ["implement", "mechanical", "debug-design", "scout", "review", "plan"];
const OPUS_BLANK = { models: { opus: { model: "" } } };
const BOTH_BLANK = { models: { sonnet: { model: "" }, opus: { model: "" } } };
/** The configuration of settings.test.ts "cap: … a custom read table to row 2": a custom read profile on a write-shaped table. */
const SHORT = () => ({ importanceTable: { mine: structuredClone(defaults().importanceTable.write) }, profiles: { x: { ability: "read", table: "mine" } } });

async function spawn(settings: object, kind: string, importance?: Importance, t2: string[] = []): Promise<string> {
  const h = harness({ settings: settings as never });
  provideSkills(h, SK);
  const r = await h.a.spawn({ name: "a", task: card({ kind, ...(importance ? { importance } : {}), t2 } as never) });
  return "reject" in r ? `REJECT ${r.reject}` : `${r.model} ${r.thinkingLevel}`;
}

test("M1: no spawn throws when a leg or a floor lies above top(a): opus blank, sonnet+opus blank, a short custom table, review on write", async () => {
  const configs: [string, object, string[]][] = [
    ["opus blank", OPUS_BLANK, KINDS], ["sonnet+opus blank", BOTH_BLANK, KINDS], ["short table", SHORT(), [...KINDS, "x"]],
    ["review on write", { profiles: { review: { ability: "write" } } }, KINDS],
  ];
  for (const [name, settings, kinds] of configs) for (const kind of kinds) for (const imp of [undefined, "high", "critical"] as const)
    for (const t2 of [[], ["security"]]) {
      const got = await spawn(settings, kind, imp, t2);
      assert.doesNotMatch(got, /Cannot read|undefined|spawn policy failed/, `${name} ${kind} ${imp} t2=${t2.length}`);
    }
});

test("M1: opus blank at critical — a review above top(write) is lowered (Sonnet routes, as base did); a worker above it rejects cleanly", async () => {
  assert.equal(await spawn(OPUS_BLANK, "implement", "critical"), `${SONNET} high`);
  assert.match(await spawn(OPUS_BLANK, "implement", "critical", ["security"]), /^REJECT no enabled member reaches write level 2 \(the top of write is 1/);
  assert.match(await spawn(OPUS_BLANK, "scout", "critical"), /^REJECT no enabled member reaches read level 3 \(the top of read is 2/);
  assert.match(await spawn(OPUS_BLANK, "review", "critical", ["security"]), /^REJECT no enabled member reaches read level 3/);
});

test("M1: sonnet+opus blank — Qwen routes with its review lowered; a raised worker and the read floors reject cleanly", async () => {
  assert.equal(await spawn(BOTH_BLANK, "implement", "high"), `${FREE} xhigh`);
  assert.match(await spawn(BOTH_BLANK, "implement", "critical"), /^REJECT no enabled member reaches write level 1 \(the top of write is 0/);
  for (const kind of ["scout", "review"]) for (const imp of [undefined, "high", "critical"] as const)
    assert.match(await spawn(BOTH_BLANK, kind, imp), /^REJECT no enabled member reaches read level 2 \(the top of read is 0/, `${kind} ${imp}`);
  assert.match(await spawn(BOTH_BLANK, "debug-design", "high"), /^REJECT no enabled member reaches write level 1/);
});

test("M2 (b): a short custom table caps its own profile only — built-in scout/review with t2 stay on Opus, the custom profile on Sonnet", async () => {
  for (const kind of ["scout", "review"]) for (const imp of [undefined, "high", "critical"] as const) {
    assert.equal(await spawn(SHORT(), kind, imp, ["security"]), `${OPUS} ${imp ? "xhigh" : "high"}`, `${kind} t2 ${imp}`);
  }
  assert.equal(await spawn(SHORT(), "scout", "critical"), `${OPUS} xhigh`);
  assert.equal(await spawn(SHORT(), "review", "critical"), `${OPUS} xhigh`);
  // x: read on `mine` (rows 0..2): opus read 3 is clamped to 2 for x, so Sonnet (cheaper, read 2) meets the t2 level.
  assert.equal(await spawn(SHORT(), "x", "high", ["security"]), `${SONNET} xhigh`);
  assert.equal(await spawn(SHORT(), "x", "critical", ["security"]), `${SONNET} xhigh`);
  assert.equal(parseSettings(SHORT()).settings.models.opus.abilities.read, 3, "the member's own level is not lowered");
});

test("m3: a profile that overrides its ability plans on that ability's table, not the built-in's", async () => {
  const s = parseSettings({ profiles: { review: { ability: "write" } } });
  assert.deepEqual(s.problems, []);
  const p = profileFor("review", s.settings);
  assert.ok(p.ok && p.value.ability === "write" && p.value.table === undefined, JSON.stringify(p));
  // The built-in floor minLevel 2 now reads on write: Opus; the write table's row 2 critical is W2·1 + R2·1 (no leg above 2).
  assert.equal(await spawn({ profiles: { review: { ability: "write" } } }, "review", "high"), `${OPUS} xhigh`);
  assert.equal(await spawn({ profiles: { review: { ability: "write" } } }, "review", "critical"), `${OPUS} xhigh`);
  // An override naming the same ability, or a table, keeps the table it names (built-in or given).
  const same = profileFor("review", parseSettings({ profiles: { review: { ability: "read" } } }).settings);
  assert.ok(same.ok && same.value.table === "review");
});

// T3.4 (HP m4): the selection routes by member, so a new member's route is a label: kept, and selected by its cost.
test("a user-added member with any route label is kept without a problem and selected in (cost, order, name) order", async () => {
  const extra = { model: "x/y", tier: "x", route: "x", abilities: { write: 1, read: 2 }, efforts: ["high"], contextWindow: 1000000, cost: 2 };
  const r = parseSettings({ models: { extra } });
  assert.deepEqual(r.settings.models.extra, extra);
  assert.deepEqual(r.problems, []);
  const miss = { bounded: false, specified: false, verifiable: true, lowRisk: true, small: true, linear: true };
  const h = harness({ settings: { models: { extra } } as never });
  const got = await h.a.spawn({ name: "a", task: card({ t0: miss }) });
  assert.ok(!("reject" in got) && got.model === "x/y" && got.thinkingLevel === "high", JSON.stringify(got)); // cost 2 < Sonnet's 3
  const ok = parseSettings({ models: { extra: { ...extra, route: "T1" } } });
  assert.deepEqual([ok.problems, ok.settings.models.extra.route], [[], "T1"]);
});
