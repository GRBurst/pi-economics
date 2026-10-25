// The spawn policy (spec §5.2): task card → verified → routed plan → concrete model and effort.
import type { Caller, SpawnPolicy, SubagentsApiV1 } from "./api.ts";
import type { AttemptState } from "./attempts.ts";
import { briefAppend } from "./brief.ts";
import { parseCard } from "./card.ts";
import { pickQwen } from "./chain.ts";
import { isRoute, routeMember } from "./members.ts";
import type { Named, Route } from "./members.ts";
import type { MemberCounter } from "./counter.ts";
import type { Health } from "./health.ts";
import { importanceOf } from "./importance.ts";
import { planSpawn } from "./pipeline.ts";
import { profileFor, skillBlocks, skillNames } from "./profile.ts";
import { cardRejection } from "./prompt.ts";
import type { SkillPort } from "./profile.ts";
import { toolsFor } from "./toolguard.ts";
import { resolveCwd, verifyT0 } from "./verify.ts";
import type { FsPort } from "./verify.ts";
import type { Card, Importance, Plan, RouterSettings, ThinkingLevel } from "./types.ts";

export type { Route };
/** What the router remembers about a child it spawned (keyed by child name = task id). */
/** `cwd` is the task's (card `cwd`, else the caller's); `unresolved`: relative card files missing under it.
 *  `member`/`model`: the member it runs on (its counter and its window); `route` still drives the chain until T3.4. */
export type Child = { parent: string; parentSession: string; member: string; model: string; route: Route; effort: ThinkingLevel; card: Card; plan: Plan; cwd: string; importance: Importance; at: number; unresolved?: true };
export type PolicyDeps = {
  settings: RouterSettings; api: () => SubagentsApiV1 | undefined; fs: FsPort;
  /** The health of a member's server by its `health` URL; `counter`: requests per member and day; `blocks`: member → blocked until (ms). */
  probe: (url: string) => Promise<Health>; counter: MemberCounter; blocks: Map<string, number>;
  sleep: (ms: number) => Promise<void>; now: () => number; attempts: AttemptState; children: Map<string, Child>;
  skills: () => SkillPort | undefined;
  /** Random source in [0, 1) for randomize / spot checks; `home` expands `~` in a card cwd. */
  rng: () => number; home: string;
};

const POLL_MS = 2000;
const PENDING_MS = 60_000; // a child not (yet) in api.list() holds its slot this long
const ROUTE_OF = { T1: "T1", T2: "T2" } as const;

/** Concrete model for a leg; for Qwen: the chain (free cloud → local → cloud), queueing up to queueMaxSec, then Sonnet. */
/** The model of a member the M1 runtime needs and the settings blanked: the spawn is rejected, naming the tier (T3.4 replaces this by the selection). */
export class NotConfigured extends Error {
  constructor(tier: string) { super(`no model is configured for ${tier} (its member is blank in the router settings)`); }
}
const memberOf = (m: RouterSettings["models"], route: string): Named => {
  const x = routeMember(m, route);
  if (!x) throw new NotConfigured(route);
  return x;
};

/** A start leg: its tier label and effort; `member` (T2.9) = the accepted member. Not Qwen → that member's model and route at once
 *  (no member: the tier's bridge member); Qwen → the chain (T3.4 replaces both by the selection). */
export type StartLeg = { tier: string; effort: ThinkingLevel; member?: string };
export type Leg = { member: string; model: string; route: Route; effort: ThinkingLevel; why?: string };
export async function resolveLeg(d: PolicyDeps, leg: StartLeg, o: { failover?: boolean } = {}): Promise<Leg> {
  const m = d.settings.models;
  const on = (x: Named, route: Route, effort: ThinkingLevel, why?: string): Leg => ({ member: x.name, model: x.model, route, effort, ...(why ? { why } : {}) });
  if (leg.tier !== "qwen") {
    const x = leg.member !== undefined ? m[leg.member] : undefined;
    if (x && isRoute(x.route)) return on({ ...x, name: leg.member! }, x.route, leg.effort); // the loader drops other routes (m4)
    return on(memberOf(m, leg.tier), ROUTE_OF[leg.tier as keyof typeof ROUTE_OF], leg.effort);
  }
  const deadline = d.now() + d.settings.queueMaxSec * 1000;
  for (;;) {
    const listed = new Map((d.api()?.list() ?? []).map((a) => [a.name, a.state]));
    const running = (r: Route) =>
      [...d.children].filter(([n, c]) => c.route === r && (listed.get(n) === "running" || (!listed.has(n) && d.now() - c.at < PENDING_MS))).length;
    const cloud = routeMember(m, "cloud"); // a blank cloud is a cloud that is never selected: cap 0
    const local = routeMember(m, "local");
    const h = local ? await d.probe(local.health ?? "") : { up: false, busy: false };
    const localRunning = running("local");
    const pick = pickQwen({
      localRunning, cloudRunning: running("cloud"), localAvailable: !o.failover && local !== undefined && h.up && (localRunning > 0 || !h.busy),
      cloudToday: cloud ? d.counter.today(cloud.name) : 0, cloudDailyCap: cloud ? (cloud.dailyCap ?? Infinity) : 0,
      cloudBlockedUntil: cloud ? d.blocks.get(cloud.name) : undefined, now: d.now(),
    });
    if (pick.route === "cloud" || pick.route === "local") return on(memberOf(m, pick.route), pick.route, leg.effort, `qwen chain: ${pick.route}`);
    const why = pick.route === "sonnet" ? pick.reason : `qwen slots busy for ${d.settings.queueMaxSec} s`;
    if (pick.route === "sonnet" || o.failover || d.now() >= deadline) return on(memberOf(m, "T1"), "T1", "high", `qwen chain → Sonnet: ${why}`);
    await d.sleep(POLL_MS);
  }
}

export function createPolicy(d: PolicyDeps): SpawnPolicy {
  const s = d.settings;
  const reject = (errors: string[]) => ({ reject: errors.join("; ") });
  return async (args, caller: Caller) => {
    if (!s.routing) return { model: args.model ?? caller.model, thinkingLevel: args.thinkingLevel ?? caller.thinkingLevel ?? "medium" };
    if (args.task === undefined) return { reject: cardRejection(s, "spawn_subagent needs a task card.") };
    const parsed = parseCard(args.task);
    if (!parsed.ok) return { reject: cardRejection(s, `Task card rejected: ${parsed.errors.join("; ")}.`) };
    const card = parsed.value;
    const prof = profileFor(card.kind, s);
    if (!prof.ok) return reject(prof.errors);
    const cwd = resolveCwd(card.cwd, caller.cwd, d.home);
    const v = verifyT0(card, cwd, d.fs, s);
    const parent = (caller.policyMeta as { importance?: Importance } | undefined)?.importance;
    const importance = importanceOf({ mainEffort: caller.thinkingLevel, parent, pathRules: s.pathRules, files: card.files, card: card.importance });
    const sp = planSpawn(d, { taskId: args.name, card, verified: v, profile: prof.value, importance, model: args.model, effort: args.thinkingLevel });
    if (!sp.ok) return reject(sp.errors);
    const names = skillNames(prof.value, card);
    const blocks = names.length ? skillBlocks(names, d.skills() ?? { find: () => undefined, read: () => "" }) : { ok: true as const, value: "" };
    if (!blocks.ok) return reject(blocks.errors);
    let to: Leg;
    const st = sp.value.start;
    try { to = await resolveLeg(d, { tier: st.tier, effort: st.effort, member: st.member }); } catch (e) {
      if (e instanceof NotConfigured) return reject([e.message]);
      throw e;
    }
    const plan: Plan = { ...sp.value.plan, reasons: [...sp.value.plan.reasons, ...(to.why ? [to.why] : [])] };
    d.children.set(args.name, {
      parent: caller.name, parentSession: caller.sessionId, at: d.now(), member: to.member, model: to.model, route: to.route, effort: to.effort, card, plan, cwd, importance,
      ...(v.unresolved ? { unresolved: true as const } : {}),
    });
    return {
      model: to.model, thinkingLevel: to.effort, briefAppend: briefAppend(card, plan, v.t0.specified, prof.value, blocks.value, s.delegation.nudge !== "off"),
      ...toolsFor(prof.value, card, cwd, caller.cwd), meta: { taskId: args.name, importance },
    };
  };
}
