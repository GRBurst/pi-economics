import { test } from "node:test";
import assert from "node:assert/strict";
import { T0_KEYS, T2_VALUES } from "../core/card.ts";
import { BUILTIN_PROFILES } from "../core/profile.ts";
import { CARD_FIELDS, cardSchema } from "../core/prompt.ts";
import { harness } from "./harness.ts";

const fire = (h: ReturnType<typeof harness>) => {
  const options = { sections: {} as Record<string, string>, skills: [] };
  h.f.fire("before_agent_start", { systemPromptOptions: options }, {});
  return options.sections;
};

test("before_agent_start adds the task card section: format, one example, every t0 key, t2 value and kind", () => {
  const text = fire(harness()).task_cards;
  assert.ok(text);
  assert.match(text, /spawn_subagent/);
  assert.match(text, /`task`/);
  for (const k of T0_KEYS) assert.match(text, new RegExp(`\\b${k}\\b`));
  for (const v of T2_VALUES) assert.ok(text.includes(v), v);
  for (const k of Object.keys(BUILTIN_PROFILES)) assert.ok(text.includes(k), k);
  const json = /```json\n([\s\S]*?)\n```/.exec(text);
  assert.ok(json, "one JSON example");
  const ex = JSON.parse(json[1]);
  assert.equal(typeof ex.kind, "string");
  assert.ok(Array.isArray(ex.acceptance));
  assert.equal((text.match(/```json/g) ?? []).length, 1);
});

test("the section is stable (cache) and lists custom profile kinds; routing=false → no section", () => {
  const a = fire(harness({ settings: { profiles: { docs: { tools: "all", skills: [], report: "default" } } } })).task_cards;
  assert.ok(a.includes("docs"));
  const b = fire(harness({ settings: { profiles: { docs: { tools: "all", skills: [], report: "default" } } } })).task_cards;
  assert.equal(a, b);
  assert.equal(fire(harness({ settings: { routing: false } })).task_cards, undefined);
});

// A spawning subagent never sees the card section (forChildren=false): rejections carry the schema themselves.
test("rejections are self-contained: every schema field, t0 key, t2 value and kind appears (no card, bad card)", async () => {
  const h = harness({ settings: { profiles: { docs: { tools: "all", skills: [], report: "default" } } } });
  const none = await h.a.spawn({ name: "c1" });
  const bad = await h.a.spawn({ name: "c2", task: { kind: "implement" } });
  for (const r of [none, bad]) {
    assert.ok("reject" in r);
    for (const w of [...CARD_FIELDS, ...T0_KEYS, ...T2_VALUES, ...Object.keys(BUILTIN_PROFILES), "docs"]) {
      assert.ok(r.reject.includes(w), `${w} in: ${r.reject}`);
    }
  }
  assert.match((bad as { reject: string }).reject, /files: missing/);
});

test("the injected section and the rejection share one schema text (cannot drift)", () => {
  const s = harness().router.settings;
  assert.ok(fire(harness()).task_cards.includes(cardSchema(s)));
});

// T5.9 (spec §9 M5): agent-facing text says "level", not "tier"; attemptOf escalates above the model the attempt ran on (D7);
// an explicit model waits for its own slot and is never replaced (D14, OD19).
test("T5.9 wording: the t2 and attemptOf lines and the section's last paragraph", () => {
  const text = fire(harness()).task_cards;
  const lines = text.split("\n");
  assert.deepEqual(lines.filter((l: string) => l.startsWith("- t2: ")), [`- t2: triggers that force the top level: ${T2_VALUES.join(", ")}; [] if none`]);
  assert.ok(text.includes("attemptOf: the name of a failed child (optional, escalates one level above the model it ran on)"));
  assert.ok(text.endsWith("\n\nA rejected card comes back with the reason. Passing model/thinkingLevel is only accepted at or above the routed level; an explicit model waits for its own slot and is never replaced by another."));
  assert.ok(!/\btier\b/.test(text), "no \"tier\" in the section");
});
