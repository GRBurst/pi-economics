// Local mode L4.T8–T9 (design §3.2.2, plan S20, D27–D30, D34; AC-O3, AC-O4, AC-O5 run part): running an overseer. The
// router spawns it through the API extension with a ticket, awaits its submit tool (resubmits for invalid input), kills it,
// and retries once on the fallback member. Driven by a scripted poll: each `sleep` runs the next scripted child action.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PolicyResult } from "../core/api.ts";
import { createOverseer, PROMPT, verdictSubmit, type Budget, type OverseerDeps, type Role } from "../core/local/overseer.ts";
import type { Verdict } from "../core/local/verdict.ts";
import type { OverseerSettings } from "../core/types.ts";
import { harness } from "./harness.ts";

type Ok = Exclude<PolicyResult, { reject: string }>;
type Step = () => unknown;
const OPUS = "anthropic/claude-opus-5-5";
const VALID: Verdict = { verdict: "APPROVE", summary: "fine", findings: [] };
const finding = (id: string) => ({ id, category: "correctness", target: "src/a.ts:1", defect: "d", evidence: "e", fix: "f", blocking: false });

function rig(o: { overseer?: Partial<OverseerSettings>; budget?: Partial<Budget> } = {}) {
  const h = harness({ settings: { mode: "local", ...(o.overseer && { overseer: o.overseer }) } as never, apiExt: true });
  const script: Step[] = [];
  const entries: Array<{ type: string; data: any }> = [];
  let k = 0, polls = 0;
  const d: OverseerDeps = {
    api: () => h.a.api, settings: h.router.settings, tickets: h.router.tickets,
    hex: (n) => (++k).toString(16).padStart(2 * n, "0"),
    now: () => h.clock.t,
    sleep: async (ms) => {
      if (++polls > 10_000) throw new Error("runaway poll loop");
      h.clock.t += ms;
      await script.shift()?.();
    },
    budget: { opusUsed: 0, steerUsed: 0, ...o.budget },
    append: (type, data) => entries.push({ type, data }),
  };
  const ov = createOverseer(d);
  /** The submit tool of the i-th spawn (the last by default). */
  const tool = (i = -1) => (h.a.apiSpawns.at(i)!.policy as Ok).childTools![0]!;
  const run = (x: { role?: Role; signal?: AbortSignal } = {}) =>
    ov.run({ role: "merge", input: "review this", cwd: "/wt", submit: verdictSubmit(), ...x });
  return { h, d, ov, script, entries, tool, run };
}

test("happy: one quiet spawn by main with a 32-hex ticket; a valid submit is recorded, the child killed, one review entry", async () => {
  const r = rig();
  const out: unknown[] = [];
  r.script.push(async () => out.push(await r.tool().execute(VALID)));
  const res = await r.run();
  assert.equal(r.h.a.apiSpawns.length, 1);
  const s = r.h.a.apiSpawns[0]!;
  assert.equal(s.args.name, "ovs-merge-1");
  assert.equal(s.args.systemPrompt, PROMPT.merge);
  assert.equal(s.args.message, "review this");
  assert.match((s.args.task as { ticket: string }).ticket, /^[0-9a-f]{32}$/);
  assert.deepEqual(s.opts, { by: "main", quiet: true });
  const p = s.policy as Ok;
  assert.equal(p.model, OPUS);
  assert.equal(p.thinkingLevel, "high");
  assert.equal(p.cwd, "/wt");
  assert.deepEqual(p.tools, r.h.router.settings.overseer.tools);
  assert.deepEqual(p.childTools!.map((t) => t.name), ["submit_verdict"]);
  assert.equal(p.toolGuard!("bash", {}), "overseer: bash is not available; report with submit_verdict");
  assert.deepEqual(out, [{ text: "recorded", terminate: true }]);
  assert.ok(res.ok);
  assert.deepEqual(res.value, VALID);
  assert.match(res.reviewId, /^rv-[0-9a-f]{8}$/);
  assert.deepEqual([res.member, res.model], ["opus", OPUS]);
  assert.deepEqual((p.meta as { taskId: string }).taskId, res.reviewId);
  assert.deepEqual(r.h.a.killed, ["ovs-merge-1"]);
  assert.deepEqual(r.entries.map((e) => e.type), ["task-router/review"]);
  assert.deepEqual(r.entries[0]!.data, { reviewId: res.reviewId, role: "merge", member: "opus", verdict: VALID, approved: true, ts: r.h.clock.t });
  assert.equal(r.h.router.tickets.owner("ovs-merge-1"), undefined);
});

test("AC-O3: a fenced summary or a duplicate id is rejected for resubmission; the run stays open until a valid submit", async () => {
  const r = rig();
  const out: Array<{ text: string; isError?: boolean; terminate?: boolean }> = [];
  r.script.push(async () => out.push(await r.tool().execute({ ...VALID, summary: "see ```x```" })));
  r.script.push(async () => {
    assert.deepEqual(r.h.a.killed, []);
    out.push(await r.tool().execute({ verdict: "REVISE", summary: "s", findings: [finding("F1"), finding("F1")] }));
  });
  r.script.push(async () => out.push(await r.tool().execute(VALID)));
  const res = await r.run();
  assert.ok(res.ok);
  assert.equal(r.h.a.apiSpawns.length, 1);
  assert.deepEqual(out.map((x) => [x.isError, x.terminate]), [[true, undefined], [true, undefined], [undefined, true]]);
  assert.equal(out[0]!.text, "invalid: $.summary: contains a code fence; resubmit");
  assert.equal(out[1]!.text, "invalid: duplicate id F1; resubmit");
});

test("AC-O3 property: with resubmits r ∈ 0…3, submissions 1…r get '; resubmit', the (r+1)-th terminates the attempt as invalid", async () => {
  for (const resubmits of [0, 1, 2, 3]) {
    const r = rig();
    r.h.router.settings.overseer.resubmits = resubmits; // the settings rule admits positive counts only; the run takes 0 too
    const out: Array<{ text: string; isError?: boolean; terminate?: boolean }> = [];
    for (let i = 0; i <= resubmits; i++) r.script.push(async () => out.push(await r.tool().execute({ verdict: "APPROVE" })));
    const res = await r.run({ role: "steer" }); // one attempt (D28), so the run's outcome is the attempt's
    assert.equal(out.length, resubmits + 1, `r=${resubmits}`);
    for (const x of out.slice(0, -1)) assert.deepEqual([x.text, x.isError, x.terminate], ["invalid: $.summary: is required; $.findings: is required; resubmit", true, undefined]);
    assert.deepEqual(out.at(-1), { text: "invalid: $.summary: is required; $.findings: is required; no resubmits left", isError: true, terminate: true });
    assert.deepEqual(res, { ok: false, outcome: "invalid" }, `r=${resubmits}`);
    assert.deepEqual(r.h.a.killed, ["ovs-steer-1"]);
    assert.deepEqual(r.entries, []);
  }
});
