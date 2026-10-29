// T5.22: spot-check reviews. An `accepted` verdict is drawn for a spot check with probability
// `spotCheck.share`: the router logs a `spotcheck` event and the task_verdict result tells the
// parent to spawn a fresh `review` card with `reviewOf`. The review child's spawn and verdict lines
// carry `reviewOf`, so analysis can compare the original verdict with the review's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCard } from "../core/card.ts";
import { accepted, card, harness, provideSkills } from "./harness.ts";

const rig = (spotCheck: { enabled: boolean; share: number }, rng = () => 0) => {
  const h = harness({ settings: { spotCheck }, extra: { rng } as never });
  provideSkills(h, ["code-reviewer"]);
  return h;
};
const spawn = async (h: ReturnType<typeof harness>, name: string, task = card()) => {
  accepted(await h.a.spawn({ name, task }));
  h.a.emit({ type: "spawn", name, by: "main", parent: "main", childSessionId: `s-${name}`, ts: 1 });
};
const verdict = (h: ReturnType<typeof harness>, name: string, v = "accepted") => h.f.callTool("task_verdict", { name, verdict: v });
const text = (r: any): string => r.content.map((c: { text: string }) => c.text).join("\n");
const spots = (h: ReturnType<typeof harness>) => h.lines().filter((l) => l.event === "spotcheck");

test("parseCard keeps a string reviewOf and rejects another type", () => {
  const c = { ...card(), reviewOf: "q1" };
  assert.deepEqual(parseCard(c), { ok: true, value: c });
  const bad = parseCard({ ...card(), reviewOf: 3 });
  assert.ok(!bad.ok && bad.errors.some((e) => e.startsWith("reviewOf")));
});

test("drawn accepted verdict → spotcheck event + instruction in the tool result", async () => {
  const h = rig({ enabled: true, share: 1 });
  await spawn(h, "q1");
  const r = await verdict(h, "q1");
  assert.ok(!r.isError);
  assert.match(text(r), /^verdict accepted recorded for q1/);
  assert.ok(text(r).includes('Spot check: spawn a fresh `review` card with `reviewOf: "q1"` for this task\'s diff/report before moving on.'), text(r));
  const [e] = spots(h);
  assert.deepEqual({ event: e.event, taskId: e.taskId, requested: e.requested, v: e.v }, { event: "spotcheck", taskId: "q1", requested: true, v: 1 });
});

test("property: share 0 or disabled never spot-checks; share 1 only on accepted", async () => {
  for (const x of [0, 0.5, 0.999]) {
    for (const s of [{ enabled: true, share: 0 }, { enabled: false, share: 1 }]) {
      const h = rig(s, () => x);
      await spawn(h, "q1");
      assert.doesNotMatch(text(await verdict(h, "q1")), /Spot check/);
      assert.equal(spots(h).length, 0);
    }
    const h = rig({ enabled: true, share: 1 }, () => x);
    await spawn(h, "p1");
    await spawn(h, "r1");
    for (const [n, v] of [["p1", "partial"], ["r1", "rejected"]]) assert.doesNotMatch(text(await verdict(h, n, v)), /Spot check/);
    assert.equal(spots(h).length, 0);
  }
});

test("rng < share decides", async () => {
  const yes = rig({ enabled: true, share: 0.1 }, () => 0.09);
  await spawn(yes, "q1");
  await verdict(yes, "q1");
  assert.equal(spots(yes).length, 1);
  const no = rig({ enabled: true, share: 0.1 }, () => 0.1);
  await spawn(no, "q1");
  await verdict(no, "q1");
  assert.equal(spots(no).length, 0);
});

test("the review child's spawn and verdict lines carry reviewOf; accepting a review never draws another spot check", async () => {
  const h = rig({ enabled: true, share: 1 });
  await spawn(h, "q1");
  await verdict(h, "q1");
  await spawn(h, "rev-q1", card({ kind: "review", reviewOf: "q1" }));
  const r = await verdict(h, "rev-q1", "rejected");
  assert.ok(!r.isError);
  const sp = h.lines().find((l) => l.event === "spawn" && l.taskId === "rev-q1")!;
  const vd = h.lines().find((l) => l.event === "verdict" && l.taskId === "rev-q1")!;
  assert.equal(sp.reviewOf, "q1");
  assert.equal(vd.reviewOf, "q1");
  await spawn(h, "rev2", card({ kind: "review" }));
  await spawn(h, "rev3", card({ reviewOf: "q1" }));
  for (const n of ["rev2", "rev3"]) assert.doesNotMatch(text(await verdict(h, n)), /Spot check/);
  assert.deepEqual(spots(h).map((l) => l.taskId), ["q1"]);
  assert.equal(h.lines().find((l) => l.event === "verdict" && l.taskId === "q1")!.reviewOf, undefined);
});
