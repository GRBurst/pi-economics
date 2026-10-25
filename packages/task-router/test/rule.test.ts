// T8.9: the orchestrator rule of the card section, switched by delegation.rule ("off" | "on", default off),
// read through the experiments factor `delegationRule` (the flag API). Main session only; off = section unchanged.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFlags } from "../core/flags.ts";
import { cardSection, ORCHESTRATOR_RULE } from "../core/prompt.ts";
import { defaults, loadSettings } from "../core/settings.ts";
import { harness } from "./harness.ts";

type G = { __piExperimentsApi_v1?: unknown };
const g = globalThis as G;
afterEach(() => void delete g.__piExperimentsApi_v1);
const arm = (flags: Record<string, string>) => {
  const calls: unknown[][] = [];
  g.__piExperimentsApi_v1 = { version: 1, flag: (n: string, d: string, s?: string) => (calls.push([n, d, s]), flags[n] ?? d) };
  return calls;
};
const MAIN = { sessionManager: { getSessionId: () => "s-main" } };
const KID = { sessionManager: { getSessionId: () => "s-kid" } };
const ruleOn = { delegation: { ...defaults().delegation, rule: "on" } };
const section = (h: ReturnType<typeof harness>, ctx: unknown = MAIN) => {
  const options = { sections: {} as Record<string, string>, skills: [] };
  h.f.fire("session_start", {}, ctx);
  h.f.fire("before_agent_start", { systemPromptOptions: options }, ctx);
  return options.sections.task_cards;
};
const withKid = (h: ReturnType<typeof harness>) =>
  h.a.agents.push(
    { name: "main", parent: "main", sessionId: "s-main", model: "m", thinkingLevel: "high", state: "running" },
    { name: "kid", parent: "main", sessionId: "s-kid", model: "m", thinkingLevel: "high", state: "running" },
  );

// A model reads this text: pinned literally, ≤ 60 words.
const RULE = "You are the orchestrator: plan, split the work into task cards, delegate implementation and research, then integrate and review. Work inline only for small fixes or when the handoff would cost more than the work.";

test("the rule text is pinned (a model reads it) and short", () => {
  assert.equal(ORCHESTRATOR_RULE, RULE);
  assert.ok(RULE.split(/\s+/).length <= 60);
});

test("defaults: delegation.rule is off; a settings file can switch it on", () => {
  assert.equal(defaults().delegation.rule, "off");
  const f = join(mkdtempSync(join(tmpdir(), "task-router-")), "settings.json");
  writeFileSync(f, JSON.stringify({ delegation: { rule: "on" } }));
  assert.deepEqual(loadSettings(f).delegation, { ...defaults().delegation, rule: "on" });
});

test("cardSection: the rule is the only addition (off = the section as before)", () => {
  const s = defaults();
  const off = cardSection(s);
  assert.ok(!off.includes("orchestrator"));
  assert.equal(cardSection(s, false), off);
  const on = cardSection(s, true);
  assert.ok(on.includes(RULE));
  assert.equal(on.replace(`${RULE}\n\n`, ""), off);
  assert.ok(on.startsWith("## Task cards\n\n"));
});

test("main session: delegation.rule on → the section has the rule; off (default) → it does not", () => {
  assert.ok(section(harness({ settings: ruleOn })).includes(RULE));
  assert.ok(!section(harness()).includes("orchestrator"));
});

test("experiments flag delegationRule overrides the own setting both ways; the session id goes with it", () => {
  const calls = arm({ delegationRule: "on" });
  assert.ok(section(harness()).includes(RULE));
  assert.deepEqual(calls.at(-1), ["delegationRule", "off", "s-main"]);
  arm({ delegationRule: "off" });
  assert.ok(!section(harness({ settings: ruleOn })).includes("orchestrator"));
  arm({ delegationRule: "maybe" }); // anything but "on" is off
  assert.ok(!section(harness({ settings: ruleOn })).includes("orchestrator"));
});

test("never in a child session, even when the child inherits an arm with the rule on", () => {
  arm({ delegationRule: "on" });
  const h = harness({ settings: ruleOn });
  withKid(h);
  const kid = section(h, KID);
  assert.ok(!kid || !kid.includes("orchestrator"), "the child's prompt has the rule");
  assert.ok(section(h, MAIN).includes(RULE), "the main session still has it");
});

test("withFlags: delegation is a live view with rule from the flag, the rest untouched", () => {
  const s = defaults();
  let flags: Record<string, string> = {};
  const v = withFlags(s, (n, d) => flags[n] ?? d);
  assert.deepEqual(v.delegation, s.delegation);
  flags = { delegationRule: "on" };
  assert.deepEqual(v.delegation, { ...s.delegation, rule: "on" });
  assert.equal(v.delegation.nudge, "on");
});

test("routing off → no card section and so no rule", () => {
  assert.equal(section(harness({ settings: { ...ruleOn, routing: false } })), undefined);
});
