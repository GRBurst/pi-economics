// Local mode L7.T17 (design §3.5.2, §3.5.4; plan D40, D48): the `plan_request` and `amend_plan` tools. Registered while plans
// are active (worktrees and mergeGate active too); `submit_plan` is the plan author's child tool only. Through the tools a
// plan is made, a plan-bound branch started, merged and amended: the shell wires the plan store into start_branch,
// request_merge and the guards, and the flows log their plan lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AMEND_PLAN_SCHEMA, PLAN_REQUEST_SCHEMA, planText } from "../core/local/plantools.ts";
import type { Skeleton } from "../core/local/plan.ts";
import { harness } from "./harness.ts";
import { finding, REVISE, reviewRig } from "./merge-rig.ts";
import { tempRepo } from "./git-repo.ts";

const tools = (settings: Record<string, unknown>) => {
  const h = harness({ settings: settings as never, apiExt: true });
  h.f.fire("session_start", {}, { cwd: "/r" });
  return h.f.tools;
};

test("plan_request, amend_plan: registered while plans are active (D40), with the §3.5.2 and §3.5.4 schemas; submit_plan never", () => {
  for (const name of ["plan_request", "amend_plan"]) {
    assert.equal(tools({ mode: "local" }).has(name), true, name);
    assert.equal(tools({ mode: "local", mergeGate: { enabled: "off" } }).has(name), false, name);
    assert.equal(tools({ mode: "local", worktrees: { enabled: "off" } }).has(name), false, name);
    assert.equal(tools({ mode: "local", plans: { enabled: "off" } }).has(name), false, name);
    assert.equal(tools({}).has(name), false, name);
    assert.equal(tools({ plans: { enabled: "on" }, mergeGate: { enabled: "on" } }).has(name), false, name);
    assert.equal(tools({ plans: { enabled: "on" }, mergeGate: { enabled: "on" }, worktrees: { enabled: "on" } }).has(name), true, name);
  }
  assert.equal(tools({ mode: "local" }).has("submit_plan"), false);
  assert.deepEqual(tools({ mode: "local" }).get("plan_request")!.parameters, PLAN_REQUEST_SCHEMA);
  assert.deepEqual(tools({ mode: "local" }).get("amend_plan")!.parameters, AMEND_PLAN_SCHEMA);
  assert.deepEqual(PLAN_REQUEST_SCHEMA, { type: "object", additionalProperties: false, required: ["slug", "request", "acceptance", "files"],
    properties: {
      slug: { type: "string", pattern: "^[a-z0-9-]{1,40}$" },
      request: { type: "string", maxLength: 2000, description: "digest of the user's request" },
      acceptance: { type: "array", minItems: 1, maxItems: 10, items: { type: "string", maxLength: 200 } },
      files: { type: "array", minItems: 1, maxItems: 20, items: { type: "string" } },
      symbols: { type: "array", maxItems: 40, items: { type: "string", maxLength: 80 } },
    } });
  assert.deepEqual(AMEND_PLAN_SCHEMA, { type: "object", additionalProperties: false, required: ["slug", "trigger", "changes", "reason"],
    properties: {
      slug: { type: "string" },
      trigger: { type: "object", required: ["id"], properties: {
        id: { type: "string", description: "an open trigger id, or \"new\"" },
        kind: { enum: ["interface-break"] },
        evidenceCommand: { type: "string", maxLength: 300 } } },
      changes: { type: "array", minItems: 1, maxItems: 8, items: {
        type: "object", required: ["op"], properties: {
          op: { enum: ["add", "replace", "remove"] },
          id: { type: "string" }, after: { type: "string" },
          task: { type: "object", description: "a task object exactly as in submit_plan's tasks items" } } } },
      reason: { type: "string", maxLength: 500 },
    } });
});

test("planText: `status: <s> (<reason>)`, the detail, then one line per finding", () => {
  assert.equal(planText({ status: "approved", detail: "plan approved: p.md at abc1234" }), "status: approved\nplan approved: p.md at abc1234");
  assert.equal(planText({ status: "refused", reason: "grounding", detail: "d" }), "status: refused (grounding)\nd");
  assert.equal(planText({ status: "rejected", detail: "d", findings: ["F1 a", "F2 b"] }), "status: rejected\nd\nF1 a\nF2 b");
});

const SK: Skeleton = { invariants: ["parse stays pure"], milestones: [{ id: "M1", goal: "a parser", acceptance: ["the parser exists"], branch: "task",
  dependsOn: [], tasks: [
    { id: "M1.T1", goal: "write the parser", files: ["src/a.ts"], create: ["src/parse.ts"], forbidden: [], check: "test -f src/parse.ts", dependsOn: [] },
    { id: "M1.T2", goal: "wire it", files: ["src/b.ts"], forbidden: [], check: "grep -q parse src/b.ts", dependsOn: ["M1.T1"] }] }] };

function rig() {
  const r = tempRepo();
  r.commit("src/a.ts", "export function parse(s: string) { return s; }\n");
  r.commit("src/b.ts", "export const wire = 1;\n");
  const m = reviewRig({ repo: r });
  const call = async (name: string, params: unknown) => m.h.f.tools.get(name)!.execute("t1", params, undefined, undefined, m.ctx);
  const write = async (path: string) =>
    (await Promise.all(m.h.f.fire("tool_call", { toolName: "write", toolCallId: `w${Math.random()}`, input: { path, content: "x" } }, m.ctx))).filter((v) => v !== undefined);
  return { ...m, call, write };
}

test("plans through the tools: plan_request, start_branch {plan}, request_merge of the task, then amend_plan on a trigger", async () => {
  const m = rig();
  m.verdicts.push(SK as never); // the plan author's submit_plan
  const p = await m.call("plan_request", { slug: "parser", request: "add a parser", acceptance: ["the parser exists"], files: ["src/a.ts"], symbols: ["parse"] });
  const pd = p.details as { status: string; next?: unknown };
  assert.equal(pd.status, "approved", JSON.stringify(pd));
  assert.equal(p.isError, undefined);
  assert.deepEqual(pd.next, { slug: "parser", id: "M1.T1" });
  assert.match(p.content[0]!.text, /^status: approved\nplan approved: docs\/plans\/parser\.md at [0-9a-f]{7}/);

  const s1 = await m.call("start_branch", { plan: { slug: "parser", id: "M1.T1" } });
  assert.ok(!s1.isError, JSON.stringify(s1.details));
  const wt1 = (s1.details as { worktree: string }).worktree;
  assert.deepEqual((s1.details as { files: string[] }).files, ["src/a.ts", "src/parse.ts"]);
  m.r.commit("src/parse.ts", "export const p = 1;\n", "parse", wt1);
  const plan = readFileSync(join(wt1, "docs/plans/parser.md"), "utf8");
  m.r.commit("docs/plans/parser.md", plan.replace("- [ ] M1.T1:", "- [x] M1.T1:"), "tick M1.T1", wt1);
  const g = await m.call("request_merge", { summary: "adds the parser" });
  assert.equal((g.details as { status: string }).status, "merged", JSON.stringify(g.details));

  const s2 = await m.call("start_branch", { plan: { slug: "parser", id: "M1.T2" } });
  assert.ok(!s2.isError, JSON.stringify(s2.details));
  const wt2 = (s2.details as { worktree: string }).worktree;
  assert.equal((await m.write(join(wt2, "src/c.ts"))).length, 1, "outside the task's files: blocked, t1 opened");
  m.verdicts.push({ ...REVISE, findings: [finding("F1", true, "src/b.ts")] });
  const change = { slug: "parser", trigger: { id: "t1" }, reason: "the wiring needs a module",
    changes: [{ op: "replace", id: "M1.T2", task: { ...SK.milestones[0]!.tasks[1]!, create: ["src/c.ts"] } }] };
  const no = await m.call("amend_plan", change);
  assert.equal((no.details as { status: string }).status, "rejected", JSON.stringify(no.details));
  assert.equal(no.isError, undefined);
  assert.match(no.content[0]!.text, /^status: rejected\n.*\nF1 \[blocking\]/);
  const yes = await m.call("amend_plan", change);
  assert.equal((yes.details as { status: string }).status, "approved", JSON.stringify(yes.details));
  assert.deepEqual(await m.write(join(wt2, "src/c.ts")), [], "the branch's whitelist follows the amendment");
  assert.deepEqual(m.h.lines().filter((l) => l.event === "plan").map((l) => l.action), ["skeleton", "approve", "trigger", "reject", "amend"]);
});

test("plan_request: invalid input is refused before anything runs (isError)", async () => {
  const m = rig();
  const r = await m.call("plan_request", { slug: "Parser!", request: "r", acceptance: [], files: ["src/a.ts"] });
  assert.equal(r.isError, true);
  assert.match(r.content[0]!.text, /^invalid input: /);
  assert.equal(m.h.a.apiSpawns.length, 0);
  const a = await m.call("amend_plan", { slug: "parser", trigger: {}, changes: [], reason: "r" });
  assert.equal(a.isError, true);
});
