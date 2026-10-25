import { test } from "node:test";
import assert from "node:assert/strict";
import { briefAppend } from "../core/brief.ts";
import { planFor as tierPlanFor, type TierPlan } from "./tier-plan.ts";
import { profileFor } from "../core/profile.ts";
import { defaults } from "../core/settings.ts";
import type { Card, Plan, Profile } from "../core/types.ts";

// The fixtures are tier plans (test/tier-plan.ts); briefAppend reads only what both shapes share.
const planFor = (...a: Parameters<typeof tierPlanFor>): Plan => tierPlanFor(...a) as unknown as Plan;

const T0 = { bounded: true, specified: true, verifiable: true, lowRisk: true, small: true, linear: true };
const card = (o: Partial<Card> = {}): Card => ({ kind: "implement", files: ["a.ts", "b.md"], acceptance: ["x"], t0: T0, t2: [], ...o });
const prof = (k: string): Profile => {
  const r = profileFor(k, defaults());
  if (!r.ok) throw new Error(r.errors.join());
  return r.value;
};
const plan = (base: TierPlan["base"] = "qwen", i: TierPlan["importance"] = "normal", kind = "implement"): Plan => planFor(base, i, kind);

const HANDSHAKE = "Start immediately; no understanding/questions reply.";
const LIMIT = "Report in ≤ 300 words plus file paths; put details in a file.";
const GATE =
  "Skill approval gates: your parent stands in for the human. Return open questions to your parent and stop; do not wait for the human.";

test("default profile, complete card: exact text (agent-facing text is the criterion)", () => {
  assert.equal(briefAppend(card(), plan(), true, prof("implement")), `${HANDSHAKE}\n${LIMIT}`);
});

test("incomplete card: no handshake skip", () => {
  const b = briefAppend(card(), plan(), false, prof("implement"));
  assert.ok(!b.includes("Start immediately"));
  assert.ok(b.includes(LIMIT));
});

test("report limit is in every brief", () => {
  for (const k of ["scout", "implement", "review", "plan", "debug-design"]) {
    for (const complete of [true, false]) assert.ok(briefAppend(card({ kind: k }), plan("T1", "normal", k), complete, prof(k)).includes(LIMIT), k);
  }
});

test("review obligation iff plan.review", () => {
  const OBL = "Review required: a fresh T1 high agent reviews your diff and report before your parent accepts it. List the changed files, the check command and its result.";
  assert.ok(briefAppend(card(), plan("qwen", "high"), true, prof("implement")).includes(OBL));
  assert.ok(briefAppend(card(), plan("T2", "critical"), true, prof("implement")).includes(OBL.replace("T1 high", "T2 xhigh")));
  assert.ok(!briefAppend(card(), plan("qwen", "normal"), true, prof("implement")).includes("Review required"));
  assert.ok(!briefAppend(card(), plan("T1", "high"), true, prof("implement")).includes("Review required"));
});

test("scout template: read-only, answer first", () => {
  const b = briefAppend(card({ kind: "scout" }), plan("qwen", "normal", "scout"), true, prof("scout"));
  assert.ok(b.includes("Read-only task: do not modify any file."));
  assert.ok(b.includes("Report: the answer first, then the supporting file paths with line numbers."));
});

test("plan template: read-only except card.files, report pinned", () => {
  const b = briefAppend(card({ kind: "plan" }), plan("T2", "normal", "plan"), true, prof("plan"));
  assert.ok(b.includes("Read-only task except these files, which you may write: a.ts, b.md."));
  assert.ok(b.includes("Report: the plan file path, the open questions, and a summary of ≤ 300 words."));
});

test("review template: findings with file and line", () => {
  const b = briefAppend(card({ kind: "review" }), plan("T1", "normal", "review"), true, prof("review"));
  assert.ok(b.includes("Read-only task: do not modify any file."));
  assert.ok(b.includes("Report: findings by severity, each with file path and line, then a verdict: accept or reject."));
});

test("implement has no read-only line", () => {
  assert.ok(!briefAppend(card(), plan(), true, prof("implement")).includes("Read-only"));
});

test("skills: blocks first, then the gate rule, then the rest", () => {
  const blocks = '<skill name="a" location="/s/a/SKILL.md">\nReferences are relative to /s/a.\n\nbody\n</skill>';
  const b = briefAppend(card({ kind: "debug-design" }), plan("T1", "normal", "debug-design"), true, prof("debug-design"), blocks);
  assert.ok(b.startsWith(`${blocks}\n\n${GATE}\n\n`), b);
  assert.ok(b.indexOf(GATE) < b.indexOf(HANDSHAKE));
  assert.ok(!briefAppend(card(), plan(), true, prof("implement")).includes(GATE));
});
