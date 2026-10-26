// The oracle side of the golden grid: composes the frozen copies under test/oracle/ the way today's policy does, and, for the
// default deltas that are active (T5.1, spec §8.2 "Default delta"), the expectation wrappers of r4's grid.mts: `wrapPlan` for D12
// and D1, `respawnRead` for D15, the explicit expectation for D3 and D11. `fired` names the deltas that changed the last call.
import { baseRoute } from "../oracle/legacy-route.ts";
import { planFor, acceptExplicit } from "../oracle/legacy-plan.ts";
import { randomize } from "../oracle/legacy-randomize.ts";
import { onRespawn } from "../oracle/legacy-attempts.ts";
import { profileFor } from "../oracle/legacy-profile.ts";
import { defaults } from "../oracle/legacy-settings.ts";
import { MODELS, drawOf, spawns } from "./grid.ts";
import type { Case, First, Router, Variant } from "./grid.ts";
import type { ThinkingLevel } from "../../core/types.ts";

/** The five default deltas of spec §8.2 (HS §9 M5): D12 read row 2 critical, D1 the read-only rule, D15 read escalation through
 *  Haiku, D11 an explicit Haiku, D3 the free cloud empty. */
export type Delta = "D12" | "D1" | "D15" | "D11" | "D3";
export type OracleRouter = Router & { fired(): Set<Delta> };

const fmt = (p: any): string => [p.base, p.worker.tier, p.worker.effort, p.review?.tier, p.review?.effort].join("/");
const EFF = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const er = (e: string): number => EFF.indexOf(e);
const LAD: Record<string, string[]> = { qwen: ["xhigh"], haiku: ["medium", "high"], T1: ["high", "xhigh"], T2: ["high", "xhigh"] };

/** The new-shape facts of a profile that the wrappers read (r4 model.mts BUILTIN and profileOf): ability, table, tools, and
 *  whether it pins a level (a built-in `level`, or a legacy `tier`). */
type Shape = { ability: string; table?: string; tools: string; pinned: boolean };
const BUILTIN: Record<string, Omit<Shape, "pinned"> & { pinned?: boolean }> = {
  scout: { ability: "read", tools: "read-only" },
  mechanical: { ability: "write", tools: "all" },
  implement: { ability: "write", tools: "all" },
  "debug-design": { ability: "write", tools: "all" },
  review: { ability: "read", table: "review", tools: "read-only" },
  plan: { ability: "write", tools: "read-only+files", pinned: true },
};
function shapeOf(kind: string, legacy: Record<string, any>): Shape {
  const b = BUILTIN[kind] ?? { ability: "write", tools: "all" }, o = legacy[kind] ?? {};
  return { ...b, tools: o.tools ?? b.tools, pinned: Boolean(b.pinned || o.tier) };
}

function wrapPlan(pl: any, np: Shape, imp: string, ds: Set<Delta>, fired: Set<Delta>): any {
  let p = pl;
  const readTable = np.ability === "read" && (np.table ?? "read") === "read";
  if (ds.has("D12") && readTable && p.base === "T1" && imp === "critical") {
    const { review, ...r } = p;
    p = { ...r, worker: { tier: "T1", effort: "xhigh" } };
    if (fmt(p) !== fmt(pl)) fired.add("D12");
  }
  if (ds.has("D1") && np.tools === "read-only" && imp === "critical" && p.review) {
    const lad = LAD[p.worker.tier], i = lad.indexOf(p.worker.effort);
    const { review, ...r } = p;
    if (i < lad.length - 1) { p = { ...r, worker: { tier: p.worker.tier, effort: lad[i + 1] } }; fired.add("D1"); }
    else if (!np.pinned && p.worker.tier !== "T2") {
      const ord = np.ability === "read" ? ["qwen", "haiku", "T1", "T2"] : ["qwen", "T1", "T2"];
      const nt = ord[ord.indexOf(p.worker.tier) + 1];
      p = { ...r, worker: { tier: nt, effort: LAD[nt][0] } };
      fired.add("D1");
    }
  }
  return p;
}

/** D15: a read-ability re-spawn escalates qwen → haiku → T1 → T2 (Haiku at medium), one retry at T2. */
function respawnRead(st: Map<string, any>, taskId: string, attemptOf: string | undefined, plan: any, fired: Set<Delta>): any {
  const ORD = ["qwen", "haiku", "T1", "T2"], rank = (t: string) => ORD.indexOf(t), esc = (t: string) => (t === "T2" ? "T2" : ORD[rank(t) + 1]);
  if (attemptOf === undefined) { st.set(taskId, { tier: plan.worker.tier, retriesAtTier: 0 }); return { ok: true, value: plan }; }
  const prev = st.get(attemptOf) ?? { tier: plan.worker.tier, retriesAtTier: 0 };
  const target = esc(prev.tier);
  if (target === prev.tier && prev.retriesAtTier >= 1) return { ok: false };
  if (rank(plan.worker.tier) > rank(target)) { st.set(taskId, { tier: plan.worker.tier, retriesAtTier: 0 }); return { ok: true, value: plan }; }
  st.set(taskId, { tier: target, retriesAtTier: target === prev.tier ? prev.retriesAtTier + 1 : 0 });
  if (target === "haiku" || prev.tier === "haiku") fired.add("D15");
  return { ok: true, value: { ...plan, worker: { tier: target, effort: target === "haiku" ? "medium" : "high" } } };
}

function run(v: Variant, c: Case, ds: Set<Delta>, fired: Set<Delta>): { labels: string[]; first: any; s: any; np: Shape } {
  const s: any = defaults();
  s.profiles = v.profiles;
  s.randomize = { enabled: true, share: 0.5 };
  const prof = (profileFor(c.kind, s) as any).value;
  const np = shapeOf(c.kind, v.profiles);
  const st = new Map();
  const labels: string[] = [];
  let first: any;
  for (const sp of spawns(c)) {
    const card: any = { kind: c.kind, files: [], acceptance: [], t0: c.t0, t2: sp.t2 ? ["security"] : [], attemptOf: sp.attemptOf };
    const { base } = baseRoute(card, { t0: c.t0, forceT2: c.t2m === "force", reasons: [] }, prof);
    const routed = wrapPlan(planFor(base, c.imp, c.kind, prof), np, c.imp, ds, fired);
    const planned = sp.attemptOf !== undefined || prof.tier || c.rnd === "off" ? routed : randomize(routed, s.randomize, () => drawOf(c.rnd));
    const r: any = ds.has("D15") && np.ability === "read" ? respawnRead(st, sp.id, sp.attemptOf, planned, fired) : onRespawn(st, sp.id, sp.attemptOf, planned);
    if (sp.attemptOf === undefined) first = r.ok ? r.value : undefined;
    labels.push(r.ok ? fmt(r.value) : "REJECT");
  }
  return { labels, first, s, np };
}

/** The oracle under the deltas `ds` (default none: today's routing, AC1). */
export const oracleRouter = (ds: Set<Delta> = new Set()): OracleRouter => {
  let fired = new Set<Delta>();
  return {
    fired: () => fired,
    seq(v, c) {
      fired = new Set();
      return run(v, c, ds, fired).labels.join(" | ");
    },
    explicit(v: Variant, c: First, model?: string, effort?: ThinkingLevel) {
      fired = new Set();
      const { first, s, np } = run(v, { ...c, rnd: "off", seq: 0 }, ds, fired);
      if (!first) return "REJECT";
      if (ds.has("D3") && model === MODELS.free) { fired.add("D3"); return "REJECT"; }
      if (ds.has("D11") && model === MODELS.haiku) {
        fired.add("D11");
        const ok = effort !== "max" && first.worker.tier === "qwen" && (np.ability === "read" || effort === undefined || er(effort) >= er("medium"));
        return ok ? `haiku/${effort ?? "medium"}` : "REJECT";
      }
      const r: any = acceptExplicit(first, model, effort, s);
      return r.ok ? `${r.value.tier}/${r.value.effort}` : "REJECT";
    },
  };
};
