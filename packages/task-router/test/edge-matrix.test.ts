// Review G2 (M1, M2 (b)): every config the loader accepts routes or rejects cleanly; the guards and capToTable stay in front
// of the selection (plan router-g3-g7 F3.0, D11). CONFIGS = the review's matrix (blank members, a short custom table, an
// ability override): 6 configs × kinds × 3 importances × {no t2, t2} = 186 cells.
import { test } from "node:test";
import assert from "node:assert/strict";
import { card, harness, provideSkills } from "./harness.ts";
import { defaults, parseSettings } from "../core/settings.ts";

const mine = structuredClone(defaults().importanceTable.write);
const CONFIGS: Record<string, Record<string, any>> = {
  opus: { models: { opus: { model: "" } } },
  sonnet: { models: { sonnet: { model: "" } } },
  both: { models: { sonnet: { model: "" }, opus: { model: "" } } },
  cap381: { importanceTable: { mine }, profiles: { x: { ability: "read", table: "mine" } } },
  revWrite: { profiles: { review: { ability: "write" } } },
  opusToday: { models: { opus: { model: "" } }, importanceTable: structuredClone(defaults().importanceTable) },
};
const SK = ["systematic-debugging", "code-reviewer", "tdd-implementation-planner"];
const IMPS = [undefined, "high", "critical"] as const;
const T2S: string[][] = [[], ["security"]];

const spawnIn = async (raw: Record<string, any>, kind: string, imp: (typeof IMPS)[number], t2: string[]): Promise<any> => {
  const h = harness({ settings: raw as never });
  provideSkills(h, SK);
  return h.a.spawn({ name: "a", task: card({ kind, ...(imp ? { importance: imp } : {}), t2: t2 as never }) });
};

for (const [cn, raw] of Object.entries(CONFIGS))
  test(`edge matrix ${cn}: no spawn throws; an accepted spawn names an enabled member`, async () => {
    const models = Object.values(parseSettings(raw).settings.models).map((m) => m.model).filter((m) => m !== "");
    for (const kind of ["implement", "debug-design", "scout", "review", "plan", ...(raw.profiles?.x ? ["x"] : [])])
      for (const imp of IMPS) for (const t2 of T2S) {
        const r = await spawnIn(raw, kind, imp, t2); // a throw fails the test by itself
        if (!("reject" in r)) assert.ok(models.includes(r.model), `${cn} ${kind} ${imp} t2=${t2.length}: ${r.model}`);
      }
  });

// The per-table cap (review G2 M2 (b)): profile x plans read on the short table `mine` (rows 0..2), so Opus' read 3 is capped
// to 2 for this plan and the t2 leg stays on Sonnet; Opus would be the first member above it without the cap.
test("edge matrix cap381: x with t2 → Sonnet (high; xhigh at critical)", async () => {
  for (const [imp, effort] of [[undefined, "high"], ["critical", "xhigh"]] as const) {
    const r = await spawnIn(CONFIGS.cap381, "x", imp, ["security"]);
    assert.ok(!("reject" in r), `cap381 x ${imp}: ${r.reject}`);
    assert.equal(r.model, "anthropic/claude-sonnet-5-5", `cap381 x ${imp}`);
    assert.equal(r.thinkingLevel, effort, `cap381 x ${imp}`);
  }
});

// The requirement check (review G2 M1): a built-in floor above top(a) rejects the spawn at the requirement, naming it, in every
// importance; without the check, planLegs' worker check would reject a critical card at its cell's level instead.
test("edge matrix both: scout and review (floor read 2, top read 0) are rejected at the requirement", async () => {
  for (const kind of ["scout", "review"]) for (const imp of IMPS) {
    const r = await spawnIn(CONFIGS.both, kind, imp, []);
    assert.match(r.reject ?? "", /^no enabled member reaches read level 2 \(the top of read is 0;/, `both ${kind} ${imp}`);
  }
});
