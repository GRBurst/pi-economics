// Local mode L3.T4 (design §3.0.3, AC-L2): the router's `hint` line — trip, stage and count, never the hint's text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ESCALATION, HINT_TEXT, block } from "../core/local/hints.ts";
import { TRIPS } from "../core/local/tripwires.ts";
import { createOutcomeLog } from "../core/log.ts";
import { hintEvent, serializeEvent } from "../core/outcome.ts";
import type { OutcomeEvent } from "../core/outcome.ts";
import { defaults } from "../core/settings.ts";

const NOW = new Date(Date.UTC(2026, 9, 2, 12, 0, 0));
const STAGES = ["hint", "steer", "parent"] as const;

test("hintEvent: trip and stage; count and sessionId only when given", () => {
  assert.deepEqual(hintEvent({ now: NOW, taskId: "main", trip: "identical-call", stage: "hint" }),
    { v: 1, ts: NOW.toISOString(), event: "hint", taskId: "main", trip: "identical-call", stage: "hint" });
  assert.deepEqual(hintEvent({ now: NOW, taskId: "c1", trip: "alternation", stage: "parent", count: 3, sessionId: "s-main" }),
    { v: 1, ts: NOW.toISOString(), event: "hint", taskId: "c1", trip: "alternation", stage: "parent", count: 3, sessionId: "s-main" });
});

test("AC-L2: every string value of a hint line is an enum value, the task id or the session id; no hint text reaches it", () => {
  const lines: OutcomeEvent[] = [];
  const log = createOutcomeLog({ append: (e) => void lines.push(e), now: () => NOW });
  const ids = ["main", "c1", "worker-2"];
  for (const taskId of ids) for (const trip of TRIPS) for (const stage of STAGES)
    for (const count of [undefined, 0, 1, 3]) for (const sessionId of [undefined, "s-main"]) log.hint(taskId, trip, stage, count, sessionId);
  assert.equal(lines.length, ids.length * TRIPS.length * STAGES.length * 4 * 2);
  const enums = new Set<string>(["hint", ...TRIPS, ...STAGES]);
  const d = defaults();
  const texts = [ESCALATION, ...TRIPS.map((t) => HINT_TEXT[t](d.hints, d.plans)), ...TRIPS.map((t) => block(t, 1, ""))];
  for (const l of lines) {
    assert.equal(l.event, "hint");
    assert.equal(l.ts, NOW.toISOString());
    for (const [k, v] of Object.entries(l)) {
      if (k === "ts" || typeof v !== "string") continue;
      assert.ok(enums.has(v) || (k === "taskId" && ids.includes(v)) || (k === "sessionId" && v === "s-main"), `${k}: ${v}`);
    }
    const s = serializeEvent(l);
    for (const t of texts) assert.ok(s.replaceAll(t, "") === s, `the line holds a hint text: ${s}`);
  }
});
