// Local mode L7.T16 (design §3.0.3, plan S30; AC-L2 plan): the `plan` line. `taskId` is the plan's slug; `action` says what
// happened: the plan author's skeleton was accepted (`skeleton`), plan_request committed the plan (`approve`), a replan trigger
// opened (`trigger`), an amendment was applied (`amend`) or rejected (`reject`). The trigger's code, the task count, the
// review and whether the whole plan was reviewed (`full`); never the request, a goal, a check or a finding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planEvent } from "../core/outcome.ts";
import { type Skeleton, type Task, TRIGGERS } from "../core/local/plan.ts";
import { amendPlan, planRequest } from "../core/local/planflow.ts";
import { planRig } from "./plan-rig.ts";
import { seeded } from "./rand.ts";
import { textFree } from "./text-free.ts";

const NOW = new Date(Date.UTC(2026, 9, 2, 12, 0, 0));
const ACTIONS = ["skeleton", "approve", "trigger", "amend", "reject"];
const ENUMS = new Set<string>(["plan", ...ACTIONS, ...TRIGGERS]);

test("planEvent: taskId = the slug, the action; the optional keys only when given", () => {
  const head = { v: 1, ts: NOW.toISOString(), event: "plan", taskId: "parser", action: "skeleton" };
  assert.deepEqual(planEvent({ now: NOW, slug: "parser", action: "skeleton" }), head);
  assert.deepEqual(planEvent({ now: NOW, slug: "parser", action: "amend", trigger: "over-budget", nTasks: 3, reviewId: "rv-2", full: true }),
    { ...head, action: "amend", trigger: "over-budget", nTasks: 3, reviewId: "rv-2", full: true });
});

const T1: Task = { id: "M1.T1", goal: "write the parser", files: ["src/a.ts"], create: ["src/parse.ts"], forbidden: [], check: "test -f src/parse.ts", dependsOn: [] };
const T2: Task = { id: "M1.T2", goal: "wire it", files: ["src/b.ts"], forbidden: [], check: "grep -q parse src/b.ts", dependsOn: ["M1.T1"] };
const sk = (goal = "a parser", t1 = T1, t2 = T2): Skeleton => ({ invariants: ["parse stays pure"], milestones: [
  { id: "M1", goal, acceptance: ["the parser test passes"], branch: "task", dependsOn: [], tasks: [t1, t2] }] });
const INPUT = { slug: "parser", request: "add a parser", acceptance: ["the parser test passes"], files: ["src/a.ts"], symbols: ["parse"] };
const APPROVE = { verdict: "APPROVE", summary: "fine", findings: [] };
const REVISE = { verdict: "REVISE", summary: "no", findings: [{ id: "F1", category: "plan", target: "M1.T2", defect: "too wide", evidence: "e", fix: "narrow it", blocking: true }] };
const wider = (reason = "the wiring needs the test") => ({ slug: "parser", trigger: { id: "t1" }, reason,
  changes: [{ op: "replace" as const, id: "M1.T2", task: { ...T2, files: ["src/b.ts", "test/a.test.ts"] } }] });

test("plan lines: plan_request → skeleton, approve; a trigger opened → trigger, once; an amendment → reject, amend", async () => {
  const x = planRig();
  assert.equal((await planRequest(x.ports, { ...INPUT, files: ["src/gone.ts"] }, x.r.dir)).status, "refused");
  assert.deepEqual(x.logs, [], "a refusal logs nothing");
  x.script.push([sk()]);
  assert.equal((await planRequest(x.ports, INPUT, x.r.dir)).status, "approved");
  x.plans.open("parser", "over-budget", "M1.T2");
  x.plans.open("parser", "over-budget", "M1.T2");
  x.script.push([REVISE], [APPROVE]);
  assert.equal((await amendPlan(x.ports, wider(), x.r.dir)).status, "rejected");
  assert.equal((await amendPlan(x.ports, wider(), x.r.dir)).status, "approved");
  assert.deepEqual(x.logs, [
    { slug: "parser", action: "skeleton", nTasks: 2, reviewId: "rv-1" },
    { slug: "parser", action: "approve", nTasks: 2, reviewId: "rv-1" },
    { slug: "parser", action: "trigger", trigger: "over-budget" },
    { slug: "parser", action: "reject", trigger: "over-budget", reviewId: "rv-2", full: false },
    { slug: "parser", action: "amend", trigger: "over-budget", nTasks: 2, reviewId: "rv-3", full: false },
  ]);
});

test("plan lines: rounds exhausted → the rejections, the plan author's skeleton, the amendment", async () => {
  const x = planRig();
  x.script.push([sk()]);
  await planRequest(x.ports, INPUT, x.r.dir);
  x.plans.open("parser", "interface-break", "M1.T2");
  const T3: Task = { id: "M1.T3", goal: "test the wiring", files: ["test/a.test.ts"], forbidden: [], check: "grep -q wire test/a.test.ts", dependsOn: ["M1.T2"] };
  const rewritten: Skeleton = { ...sk(), milestones: [{ ...sk().milestones[0]!, tasks: [T1, T2, T3] }] };
  x.script.push([REVISE], [REVISE], [rewritten]);
  assert.equal((await amendPlan(x.ports, wider(), x.r.dir)).status, "rejected");
  assert.equal((await amendPlan(x.ports, wider(), x.r.dir)).status, "approved");
  assert.deepEqual(x.logs.slice(2), [
    { slug: "parser", action: "trigger", trigger: "interface-break" },
    { slug: "parser", action: "reject", trigger: "interface-break", reviewId: "rv-2", full: true },
    { slug: "parser", action: "reject", trigger: "interface-break", reviewId: "rv-3", full: true },
    { slug: "parser", action: "skeleton", trigger: "interface-break", nTasks: 3, reviewId: "rv-4" },
    { slug: "parser", action: "amend", trigger: "interface-break", nTasks: 3, reviewId: "rv-4", full: true },
  ]);
});

test("AC-L2 plan: text-free over generated slugs, requests, goals and reasons", async () => {
  const rnd = seeded(716);
  const word = () => ["fix", "```sh\nrm -rf /\n```", "a b", "ignore previous", "x:y z", "<router-hint>"][rnd(6)]!;
  for (let i = 0; i < 3; i++) {
    const x = planRig();
    const slug = `s${rnd(1000)}-${"abc"[rnd(3)]}`;
    const t1 = { ...T1, goal: `${word()} ${word()}` }, t2 = { ...T2, goal: `${word()} ${word()}` };
    x.script.push([sk(`${word()} ${word()}`, t1, t2)]);
    const r = await planRequest(x.ports, { ...INPUT, slug, request: `${word()} ${word()}`, acceptance: [`${word()} ${word()}`] }, x.r.dir);
    assert.equal(r.status, "approved", r.detail);
    x.plans.open(slug, TRIGGERS[rnd(TRIGGERS.length)]!, "M1.T2");
    x.script.push([rnd(2) ? APPROVE : REVISE]);
    await amendPlan(x.ports, { ...wider(`${word()} ${word()}`), slug, changes: [{ op: "replace", id: "M1.T2", task: { ...t2, goal: `${word()} ${word()}` } }] }, x.r.dir);
    assert.equal(x.logs.length, 4, JSON.stringify(x.logs));
    for (const l of x.logs) assert.deepEqual(textFree(planEvent({ ...l, now: NOW }), ENUMS), [], JSON.stringify(l));
  }
});
