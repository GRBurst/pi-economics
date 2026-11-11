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

/** Local mode with every component that adds section lines off (plan X31: the L1 literal stays, its input changes). */
const BARE = { mode: "local", worktrees: { enabled: "off" }, mergeGate: { enabled: "off" }, plans: { enabled: "off" } } as never;

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
  const text = fire(harness({ settings: BARE }));
  assert.equal(text, PINNED(cardSchema(defaults())));
  assert.equal(text, localSection(parseSettings({ mode: "local" }).settings));
  assert.ok(text.includes(cardSchema(defaults())));
  assert.ok(!text.includes(ORCHESTRATOR_RULE));
  assert.equal(fire(harness({ settings: BARE })), text, "stable across sessions (cache)");
});

test("LD3: delegationRule on, local → localSection", () => {
  g.__piExperimentsApi_v1 = { version: 1, flag: (n: string, d: string) => (n === "delegationRule" ? "on" : d) };
  const text = fire(harness({ settings: BARE }));
  assert.equal(text, PINNED(cardSchema(defaults())));
  assert.ok(!text.includes(ORCHESTRATOR_RULE));
});

const BRANCH_ONLY = "Code changes happen on branches: start_branch, then edit and commit in its worktree (absolute paths).";
/** PINNED with the worktrees line after the sentence about the child's report. */
const WITH_BRANCH = (schema: string) => PINNED(schema).replace("the child's report wakes you.\n", `the child's report wakes you.\n${BRANCH_ONLY}\n`);

test("AC-R3 worktrees: with worktrees active (local mode) the section holds the branch line after the child sentence, nothing else changes", () => {
  const text = fire(harness({ settings: { mode: "local", mergeGate: { enabled: "off" }, plans: { enabled: "off" } } as never }));
  assert.equal(text, WITH_BRANCH(cardSchema(defaults())));
  assert.equal(text, localSection(parseSettings({ mode: "local" }).settings, { worktrees: true, mergeGate: false, plans: false }));
  assert.ok(text.includes(BRANCH_ONLY));
  assert.ok(!text.includes("request_merge") && !text.includes("plan_request"), "no line about a tool that is not there");
  assert.equal(localSection(parseSettings({ mode: "local" }).settings), PINNED(cardSchema(defaults())), "no active set: today's literal");
});

test("the section follows the active set: worktrees and mergeGate off → no branch line; default-mode settings with worktrees on → the card section", () => {
  assert.equal(fire(harness({ settings: { mode: "local", worktrees: { enabled: "off" }, mergeGate: { enabled: "off" } } as never })), PINNED(cardSchema(defaults())));
  assert.equal(fire(harness({ settings: { worktrees: { enabled: "on" } } as never })), cardSection(defaults(), false));
});

// L6.T13 (plan S25, Q17): the merge gate's lines.
const BRANCH_FULL = `Code changes happen on branches: start_branch, then edit and commit in its worktree (absolute paths),
then request_merge. You cannot merge, push or commit to a main branch; the router blocks it.`;
const GATE_ONLY = "Merge into a main branch only with request_merge. You cannot merge, push or commit to a main branch; the router blocks it.";
const WITH = (schema: string, line: string) => PINNED(schema).replace("the child's report wakes you.\n", `the child's report wakes you.\n${line}\n`);

test("AC-R3 worktrees+mergeGate: the full branch line (design §2.3)", () => {
  const text = fire(harness({ settings: { mode: "local", plans: { enabled: "off" } } as never }));
  assert.equal(text, WITH(cardSchema(defaults()), BRANCH_FULL));
  assert.equal(text, localSection(parseSettings({ mode: "local" }).settings, { worktrees: true, mergeGate: true, plans: false }));
  assert.ok(!text.includes(BRANCH_ONLY + "\n"));
});

// L7.T17 (plan S25, Q17): the plans line after the branch line.
const PLANS = `A request that needs more than one branch starts with plan_request. Follow the plan file, tick only your
task's checkbox, and change the plan only with amend_plan.`;

test("AC-R3 all: worktrees, mergeGate and plans active → the full branch line, then the plans line (design §2.3)", () => {
  const text = fire(harness({ settings: { mode: "local" } as never }));
  assert.equal(text, WITH(cardSchema(defaults()), `${BRANCH_FULL}\n${PLANS}`));
  assert.equal(text, localSection(parseSettings({ mode: "local" }).settings, { worktrees: true, mergeGate: true, plans: true }));
  assert.ok(!fire(harness({ settings: { mode: "local", plans: { enabled: "off" } } as never })).includes("plan_request"));
});

test("AC-R3 mergeGate only: the gate line", () => {
  const text = fire(harness({ settings: { mode: "local", worktrees: { enabled: "off" } } as never }));
  assert.equal(text, WITH(cardSchema(defaults()), GATE_ONLY));
  assert.ok(!text.includes("start_branch"));
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
