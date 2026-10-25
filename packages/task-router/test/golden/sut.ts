// The production side of the golden grid and the host replay: the only place that maps the production pipeline onto the
// oracle's vocabulary (labels, tiers, efforts). When production signatures change, only this file changes, never the oracle.
import { planSpawn } from "../../core/pipeline.ts";
import type { AttemptState } from "../../core/attempts.ts";
import { profileFor } from "../../core/profile.ts";
import { parseSettings } from "../../core/settings.ts";
import { TODAY_RAW } from "../harness.ts";
import { spawns } from "./grid.ts";
import type { Case, First, Router, Variant } from "./grid.ts";
import type { Card, Importance, RouterSettings, T0, ThinkingLevel } from "../../core/types.ts";

export type SpawnX = {
  taskId: string; kind: string; t0: T0; t2: boolean; force: boolean; need: number; imp: Importance;
  draw: boolean; attemptOf?: string; model?: string; effort?: ThinkingLevel;
};
const fmt = (p: any): string => [p.base, p.worker.tier, p.worker.effort, p.review?.tier, p.review?.effort].join("/");

/** One spawn through `planSpawn`. `draw` true → the randomization draw hits (rng 0). A rejection (profile, attempts or an explicit
 *  model) has label "REJECT" and no `start`. */
export function sutSpawn(ctx: { settings: RouterSettings; attempts: AttemptState }, x: SpawnX): { label: string; start?: string; reasons: string[] } {
  const prof = profileFor(x.kind, ctx.settings);
  if (!prof.ok) return { label: "REJECT", reasons: prof.errors };
  const card: Card = { kind: x.kind, files: [], acceptance: [], t0: x.t0, t2: x.t2 ? ["security"] : [], ...(x.attemptOf !== undefined ? { attemptOf: x.attemptOf } : {}) };
  const r = planSpawn(
    { settings: ctx.settings, attempts: ctx.attempts, rng: () => (x.draw ? 0 : 0.99) },
    { taskId: x.taskId, card, verified: { t0: x.t0, forceT2: x.force, reasons: [], tokens: x.need }, profile: prof.value, importance: x.imp, model: x.model, effort: x.effort },
  );
  if (!r.ok) return { label: "REJECT", reasons: r.errors };
  // The start's tier is read off its member (review G2, m1): `resolveLeg` routes a non-Qwen start by `start.member`, so the
  // oracle's tier must be that member's, not the label `acceptModel` set beside it.
  const st = r.value.start, tier = ctx.settings.models[st.member]?.tier ?? `?${st.member}`;
  return { label: fmt(r.value.plan), start: `${tier}/${st.effort}`, reasons: r.value.plan.reasons };
}

const cache = new Map<string, RouterSettings>(); // parsed once per (variant, randomize): the grid has 150k cases
const settingsOf = (v: Variant, rnd: boolean): RouterSettings => {
  const key = `${v.name} ${rnd}`;
  if (!cache.has(key)) cache.set(key, parseSettings({ ...TODAY_RAW, profiles: v.profiles, randomize: { enabled: rnd, share: 0.5 } }).settings);
  return cache.get(key)!;
};

export const sutRouter = (): Router => ({
  seq(v: Variant, c: Case) {
    const ctx = { settings: settingsOf(v, c.rnd !== "off"), attempts: new Map() as AttemptState };
    return [...spawns(c)]
      .map((sp) => sutSpawn(ctx, { taskId: sp.id, kind: c.kind, t0: c.t0, t2: sp.t2, force: c.t2m === "force", need: 0, imp: c.imp, draw: c.rnd === "hit", ...(sp.attemptOf ? { attemptOf: sp.attemptOf } : {}) }).label)
      .join(" | ");
  },
  explicit(v: Variant, c: First, model?: string, effort?: ThinkingLevel) {
    const ctx = { settings: settingsOf(v, false), attempts: new Map() as AttemptState };
    const r = sutSpawn(ctx, { taskId: "t0", kind: c.kind, t0: c.t0, t2: c.t2m === "t2", force: c.t2m === "force", need: 0, imp: c.imp, draw: false, ...(model !== undefined ? { model } : {}), ...(effort !== undefined ? { effort } : {}) });
    return r.start ?? "REJECT";
  },
});
