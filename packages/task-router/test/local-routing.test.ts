// Local mode L1.T4 (design §2.2 item 1, LD1, AC-R2): in local mode the main session's effort is no importance source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EFFORTS } from "../core/members.ts";
import type { Card } from "../core/types.ts";
import { accepted, card, harness } from "./harness.ts";

/** A caller at xhigh (the fake caller is typed at its own "high"). */
const XHIGH = { thinkingLevel: "xhigh" } as never;
const spawnLine = (h: ReturnType<typeof harness>, name: string) => {
  h.a.emit({ type: "spawn", name, by: "main", parent: "main", childSessionId: `s-${name}`, ts: 1 });
  return h.lines().find((l) => l.event === "spawn" && l.taskId === name)!;
};

test("AC-R2: local mode, a caller at xhigh, a write-0 card without importance → normal, one leg on qwen-local", async () => {
  const h = harness({ settings: { mode: "local" } });
  const r = accepted(await h.a.spawn({ name: "c1", task: card() }, XHIGH)) as any;
  assert.equal(r.meta.importance, "normal");
  assert.equal(r.model, "llama/qwen3.8");
  assert.ok(!r.briefAppend.includes("Review required"), r.briefAppend);
  const l = spawnLine(h, "c1");
  assert.equal(l.importance, "normal");
  assert.ok(!("reviewTier" in l), JSON.stringify(l));
});

test("AC-R2 default mode stays high", async () => {
  const h = harness();
  const r = accepted(await h.a.spawn({ name: "c1", task: card() }, XHIGH)) as any;
  assert.equal(r.meta.importance, "high");
  assert.equal(r.model, "llama/qwen3.8");
  assert.ok(r.briefAppend.includes("Review required"));
  assert.equal(spawnLine(h, "c1").reviewTier, "T1");
});

test("local mode: for every caller effort the importance equals the importance without one; the other sources still count", async () => {
  const importance = async (task: Card, c: Record<string, unknown>) =>
    ((accepted(await harness({ settings: { mode: "local", pathRules: [{ glob: "src/auth/**", level: "critical" }] } }).a.spawn({ name: "c1", task }, c))) as any).meta.importance;
  const cases: [Card, Record<string, unknown>, string][] = [
    [card(), {}, "normal"],
    [card({ importance: "high" }), {}, "high"],
    [card(), { policyMeta: { importance: "high" } }, "high"],
    [card({ files: ["src/auth/a.ts"] }), {}, "critical"],
  ];
  for (const [task, extra, want] of cases) {
    const base = await importance(task, { ...extra, thinkingLevel: undefined });
    assert.equal(base, want, JSON.stringify([task, extra]));
    for (const e of EFFORTS) assert.equal(await importance(task, { ...extra, thinkingLevel: e }), base, `${e} ${JSON.stringify([task.importance, task.files, extra])}`);
  }
});
