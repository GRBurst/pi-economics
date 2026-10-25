// The oracle side of the golden grid: composes the frozen copies under test/oracle/ the way today's policy does.
import { baseRoute } from "../oracle/legacy-route.ts";
import { planFor, acceptExplicit } from "../oracle/legacy-plan.ts";
import { randomize } from "../oracle/legacy-randomize.ts";
import { onRespawn } from "../oracle/legacy-attempts.ts";
import { profileFor } from "../oracle/legacy-profile.ts";
import { defaults } from "../oracle/legacy-settings.ts";
import { drawOf, spawns } from "./grid.ts";
import type { Case, First, Router, Variant } from "./grid.ts";
import type { ThinkingLevel } from "../../core/types.ts";

const fmt = (p: any): string => [p.base, p.worker.tier, p.worker.effort, p.review?.tier, p.review?.effort].join("/");

function run(v: Variant, c: Case): { labels: string[]; first: any; s: any } {
  const s: any = defaults();
  s.profiles = v.profiles;
  s.randomize = { enabled: true, share: 0.5 };
  const prof = (profileFor(c.kind, s) as any).value;
  const st = new Map();
  const labels: string[] = [];
  let first: any;
  for (const sp of spawns(c)) {
    const card: any = { kind: c.kind, files: [], acceptance: [], t0: c.t0, t2: sp.t2 ? ["security"] : [], attemptOf: sp.attemptOf };
    const { base } = baseRoute(card, { t0: c.t0, forceT2: c.t2m === "force", reasons: [] }, prof);
    const routed = planFor(base, c.imp, c.kind, prof);
    const planned = sp.attemptOf !== undefined || prof.tier || c.rnd === "off" ? routed : randomize(routed, s.randomize, () => drawOf(c.rnd));
    const r: any = onRespawn(st, sp.id, sp.attemptOf, planned);
    if (sp.attemptOf === undefined) first = r.ok ? r.value : undefined;
    labels.push(r.ok ? fmt(r.value) : "REJECT");
  }
  return { labels, first, s };
}

export const oracleRouter = (): Router => ({
  seq: (v, c) => run(v, c).labels.join(" | "),
  explicit(v: Variant, c: First, model?: string, effort?: ThinkingLevel) {
    const { first, s } = run(v, { ...c, rnd: "off", seq: 0 });
    if (!first) return "REJECT";
    const r: any = acceptExplicit(first, model, effort, s);
    return r.ok ? `${r.value.tier}/${r.value.effort}` : "REJECT";
  },
});
