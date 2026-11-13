// The Levers section (redesign M3b, design §6.1 item 4, §7.4): per lever the observed value distribution, the sources and the
// refusal rate, over the sessions of the period, each with its last levers line up to the period's end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse, renderAnalysis, renderLevers, type Logs } from "../core/analyse.ts";
import { levers } from "../core/analyse/levers.ts";
import { leversLine, type LeverState } from "../core/levers.ts";
import { iso, MIN, T0, turn } from "./world.ts";

const DAY = 24 * 60 * MIN;
const PERIOD = { since: "2026-10-05", until: "2026-10-05" };
const lv = (sessionId: string, at: number, state: Record<string, LeverState>, extra: { parentSessionId?: string; arm?: string; eligible?: boolean } = {}) =>
  leversLine({ ts: iso(at), sessionId, eligible: false, ...extra, levers: state }) as unknown as Record<string, unknown>;
const think = (s: LeverState) => ({ "pi.defaultThinkingLevel": s });

/** a: eligible main that changed its level (pe, confirmed); b: eligible main, refused; c: child of a; d: no levers line;
 *  e: its levers line comes after the period; f: its levers line came the day before the period. */
function world(): Logs {
  const meter: Record<string, unknown>[] = [
    lv("a", T0, think({ v: "medium", s: "fixed" }), { arm: "---", eligible: true }),
    lv("a", T0 + 60 * MIN, think({ v: "high", s: "pe", a: "high", rb: "confirmed" }), { arm: "---", eligible: true }),
    turn("a", T0 + 61 * MIN, { arm: "---" }),
    lv("b", T0, think({ v: "medium", s: "ext", a: "high", rb: "refused" }), { arm: "+--", eligible: true }),
    turn("b", T0 + MIN, { arm: "+--" }),
    lv("c", T0 + 70 * MIN, think({ v: "medium", s: "fixed" }), { parentSessionId: "a", arm: "---" }),
    turn("c", T0 + 71 * MIN, { arm: "---", parentSessionId: "a" }),
    turn("d", T0 + MIN),
    turn("e", T0 + MIN),
    lv("e", T0 + DAY, think({ v: "low", s: "fixed" })),
    lv("f", T0 - DAY, think({ v: "medium", s: "fixed" })),
    turn("f", T0 + MIN),
  ];
  return { meter, outcomes: [], assignments: [], guards: [], files: [] };
}

test("levers: per session its last levers line up to the period's end; values, sources, refusal rate per lever", () => {
  const all = world();
  const s = analyse(all, PERIOD).levers;
  assert.deepEqual({ ...s, levers: [] }, { sessions: 6, withLevers: 4, eligible: 2, children: 1, inert: 0, levers: [] });
  assert.deepEqual(s.levers, [{ lever: "pi.defaultThinkingLevel", sessions: 4, values: { high: 1, medium: 3 }, sources: { pe: 1, ext: 1, fixed: 2 },
    assigned: 2, refused: 1, unverified: 0, refusalRate: 0.5 }]);
});

test("levers: with infinite-context loaded (pi.compaction.enabled false, source ext) the other pi.compaction.* levers are inert, left out", () => {
  const ic = { "pi.compaction.enabled": { v: false, s: "ext" }, "pi.compaction.reserveTokens": { v: 16384, s: "fixed" } } as Record<string, LeverState>;
  const native = { "pi.compaction.enabled": { v: true, s: "fixed" }, "pi.compaction.reserveTokens": { v: 16384, s: "fixed" } } as Record<string, LeverState>;
  const meter = [lv("g", T0, ic), lv("h", T0, native)];
  const s = levers(meter, meter, PERIOD);
  assert.equal(s.inert, 1);
  assert.deepEqual(s.levers.map((r) => [r.lever, r.sessions, r.values]), [["pi.compaction.enabled", 2, { false: 1, true: 1 }], ["pi.compaction.reserveTokens", 1, { 16384: 1 }]]);
  assert.ok(Number.isNaN(s.levers[0].refusalRate), "no assignment: no refusal rate");
});

test("levers: render a row per lever, values by count; the report places the section after Cost", () => {
  const a = analyse(world(), PERIOD);
  const text = renderLevers(a.levers);
  const lines = text.split("\n");
  assert.ok(lines.includes("| lever | sessions | values (sessions) | sources | assigned | refused | unverified | refusal rate |"), text);
  assert.ok(lines.includes("| `pi.defaultThinkingLevel` | 4 | `medium` 3, `high` 1 | pe 1, ext 1, fixed 2 | 2 | 1 | 0 | 50% |"), text);
  const report = renderAnalysis(a, new Date(T0)).split("\n");
  const at = (h: string) => report.indexOf(h);
  assert.ok(at("## Cost") < at("## Levers") && at("## Levers") < at("## Experiment"), "Levers between Cost and Experiment (design §6.1 order)");
});

test("levers: no levers line in the period renders the empty state", () => {
  const s = levers([turn("d", T0)], [turn("d", T0)], PERIOD);
  assert.deepEqual([s.sessions, s.withLevers, s.levers], [1, 0, []]);
  assert.ok(renderLevers(s).startsWith("_no data in the period_"));
});
