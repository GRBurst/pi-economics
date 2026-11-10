// Local mode L1.T5 (design §2.3, LD3, AC-R3, AC-N3): a local main gets the short local section; default mode keeps today's.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ORCHESTRATOR_RULE, cardSchema, cardSection, localSection } from "../core/prompt.ts";
import { defaults, parseSettings } from "../core/settings.ts";
import { harness } from "./harness.ts";

const g = globalThis as { __piExperimentsApi_v1?: unknown };
afterEach(() => void delete g.__piExperimentsApi_v1);
const MAIN = { sessionManager: { getSessionId: () => "s-main" } };
const fire = (h: ReturnType<typeof harness>, ctx: unknown = MAIN) => {
  const options = { sections: {} as Record<string, string>, skills: [] };
  h.f.fire("session_start", {}, ctx);
  h.f.fire("before_agent_start", { systemPromptOptions: options }, ctx);
  return options.sections.task_cards;
};

/** The section as a model reads it (design §2.3 without the branch and plan lines, plan D4); the schema is spliced. */
const PINNED = (schema: string) => `## Local mode

You do most of the work yourself. Spawn a subagent only when a task needs more ability than yours
(design, security, concurrency, an unknown root cause) or when a <router-hint> says so. After spawning,
end your turn; the child's report wakes you.
<router-hint> notes report what the router measured. Act on them.

Task card (spawn_subagent \`task\`; do not set model or thinkingLevel):
${schema}
{"kind":"debug-design","files":["src/a.ts"],"check":"npm test -- a","acceptance":["a() handles empty input"],"t0":{"bounded":true,"specified":true,"verifiable":true,"lowRisk":true,"small":true,"linear":true},"t2":[]}`;

test("AC-R3 pinned text: local mode sets task_cards to the local section", () => {
  const text = fire(harness({ settings: { mode: "local" } }));
  assert.equal(text, PINNED(cardSchema(defaults())));
  assert.equal(text, localSection(parseSettings({ mode: "local" }).settings));
  assert.ok(text.includes(cardSchema(defaults())));
  assert.ok(!text.includes(ORCHESTRATOR_RULE));
  assert.equal(fire(harness({ settings: { mode: "local" } })), text, "stable across sessions (cache)");
});

test("LD3: delegationRule on, local → localSection", () => {
  g.__piExperimentsApi_v1 = { version: 1, flag: (n: string, d: string) => (n === "delegationRule" ? "on" : d) };
  const text = fire(harness({ settings: { mode: "local" } }));
  assert.equal(text, PINNED(cardSchema(defaults())));
  assert.ok(!text.includes(ORCHESTRATOR_RULE));
});

test("default mode section", () => {
  const s = defaults();
  assert.equal(fire(harness()), cardSection(s, false));
  assert.equal(fire(harness({ settings: { delegation: { ...s.delegation, rule: "on" } } })), cardSection(s, true));
});

test("child in local mode: cardSection without the rule (plan D5)", () => {
  const h = harness({ settings: { mode: "local" } });
  h.a.agents.push({ name: "c1", parent: "main", sessionId: "s-c1", model: "llama/qwen3.8", thinkingLevel: "xhigh", state: "running" });
  assert.equal(fire(h, { sessionManager: { getSessionId: () => "s-c1" } }), cardSection(defaults(), false));
});
