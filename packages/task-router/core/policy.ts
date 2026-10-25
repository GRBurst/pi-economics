// The spawn policy (spec §5.2): task card → verified → routed plan → concrete model and effort.
import type { Caller, SpawnPolicy, SubagentsApiV1 } from "./api.ts";
import type { AttemptState } from "./attempts.ts";
import { briefAppend } from "./brief.ts";
import { parseCard } from "./card.ts";
import { effortAt, lvl, named, sameLadder } from "./members.ts";
import type { Named } from "./members.ts";
import type { MemberCounter } from "./counter.ts";
import type { Health } from "./health.ts";
import { importanceOf } from "./importance.ts";
import { planSpawn } from "./pipeline.ts";
import { profileFor, skillBlocks, skillNames } from "./profile.ts";
import { pickMember } from "./select.ts";
import type { MemberState } from "./select.ts";
import { cardRejection } from "./prompt.ts";
import type { SkillPort } from "./profile.ts";
import { toolsFor } from "./toolguard.ts";
import { resolveCwd, verifyT0 } from "./verify.ts";
import type { FsPort } from "./verify.ts";
import type { Card, Importance, Plan, Result, RouterSettings, ThinkingLevel } from "./types.ts";

/** What the router remembers about a child it spawned (keyed by child name = task id). */
/** `cwd` is the task's (card `cwd`, else the caller's); `unresolved`: relative card files missing under it. */
export type ChildBase = { parent: string; parentSession: string; card: Card; plan: Plan; cwd: string; importance: Importance; unresolved?: true };
/** `member`/`model`: the member it runs on (its slot, counter, window); `route`: that member's log label; `reservedUntil`: its
 *  slot is held until then, listed or not (mi11); `failover`: the leg's candidate names, the targets of a move (spec §4.8);
 *  `prev`: while a move's `retune` is in flight, where the child ran (restored if the retune throws). */
export type Child = ChildBase & {
  member: string; route: string; model: string; effort: ThinkingLevel; at: number; reservedUntil: number; failover: string[];
  prev?: { member: string; route: string; model: string; effort: ThinkingLevel; reservedUntil: number };
};
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
/** A spawned or moved child holds its slot this long, listed or not (mi11). */
export const PENDING_MS = 60_000;

/** A candidate's state at `now` (spec §4.5): up = its endpoint answers (no `health`: up), not blocked, under its daily cap;
 *  free = up, a slot left (running = listed `running` or reserved) and the probe not busy. */
export function memberState(d: PolicyDeps, m: Named, listed: Map<string, string>, now: number, h?: Health): MemberState {
  const blocked = (d.blocks.get(m.name) ?? 0) > now;
  const capped = m.dailyCap !== undefined && d.counter.today(m.name) >= m.dailyCap;
  const up = (m.health === undefined || h?.up === true) && !blocked && !capped;
  const running = [...d.children].filter(([n, c]) => c.member === m.name && (listed.get(n) === "running" || c.reservedUntil > now)).length;
  return { name: m.name, cost: m.cost, up, free: up && (m.slots === undefined || running < m.slots) && !(h?.busy ?? false) };
}

/** The selection of one leg (spec §4.5): probe the candidates with a `health` URL, pick (`pickMember`), else poll every
 *  POLL_MS until `queueMaxSec`. The effort: a pinned start keeps its own; else the requested effort when the member shares the
 *  planned member's ladder, else the member's effort at the leg's step. From the listing to the reservation the step is
 *  synchronous (AC3, RD5): the pick writes the child's entry before any other spawn or move can look, and it sweeps the
 *  ghosts, entries pi does not list whose reservation has ended (mi11; only with an API, whose listing is the evidence). */
export type Selected = { member: Named; effort: ThinkingLevel; waitMs: number; why: string };
export async function resolveLeg(d: PolicyDeps, x: {
  name: string; cands: Named[]; planned: Named; step: number; effort?: ThinkingLevel; pinned: boolean; failover: string[]; entry: ChildBase;
}): Promise<Result<Selected>> {
  const t0 = d.now(), deadline = t0 + d.settings.queueMaxSec * 1000;
  for (;;) {
    const health = await Promise.all(x.cands.map((m) => (m.health ? d.probe(m.health) : Promise.resolve(undefined))));
    // ---- one synchronous step from here to the reservation: no await (AC3, RD5) ----
    const now = d.now(), api = d.api();
    const listed = new Map((api?.list() ?? []).map((a) => [a.name, a.state]));
    if (api) for (const [n, c] of d.children) if (!listed.has(n) && c.reservedUntil <= now) d.children.delete(n);
    const p = pickMember(x.cands.map((m, i) => memberState(d, m, listed, now, health[i])), now >= deadline);
    if ("pick" in p) {
      const m = x.cands.find((c) => c.name === p.pick)!;
      const effort = x.pinned ? x.effort! : x.effort !== undefined && sameLadder(m, x.planned) ? x.effort : effortAt(m, x.step);
      const waitMs = now - t0;
      d.children.set(x.name, { ...x.entry, member: m.name, route: m.route, model: m.model, effort, at: now, reservedUntil: now + PENDING_MS, failover: x.failover });
      const why = `selection: ${m.name}${waitMs ? ` after ${Math.round(waitMs / 1000)} s` : ""}${m.name !== x.planned.name ? ` (planned ${x.planned.name})` : ""}`;
      return { ok: true, value: { member: m, effort, waitMs, why } };
    }
    if ("none" in p) return { ok: false, errors: [x.pinned
      ? `explicit model ${x.cands[0].model}: ${p.none === "no member up" ? "down" : `no free slot after ${d.settings.queueMaxSec} s`}; leave \`model\` unset to let the router choose`
      : `no member for this leg: ${p.none}`] };
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
    // The selection runs on the plan's candidates (D12); a pinned start (an explicit model) runs on its member alone.
    // A pinned start (an explicit model, D14) runs on its member alone, whose window never rejects (OD17: a reason instead),
    // and fails over only at or above it. The entry is written at the pick, inside resolveLeg; its plan gets the selection's reason after.
    const st = sp.value.start, leg = sp.value.cands.map((n) => named(s.models, n)!), M = named(s.models, st.member)!;
    const plan: Plan = { ...sp.value.plan, reasons: [...sp.value.plan.reasons] }, a = plan.ability, need = v.tokens ?? 0;
    const failover = (st.pinned ? leg.filter((m) => lvl(m, a) >= lvl(M, a)) : leg).map((m) => m.name);
    if (st.pinned && s.contextFit > 0 && need > s.contextFit * M.contextWindow)
      plan.reasons.push(`context: files need ~${Math.round(need)} tokens; explicit ${M.name} holds ${M.contextWindow}`);
    const to = await resolveLeg(d, {
      name: args.name, cands: st.pinned ? [M] : leg, planned: leg[0], step: plan.worker.step,
      effort: st.pinned ? st.effort : args.thinkingLevel, pinned: st.pinned, failover,
      entry: { parent: caller.name, parentSession: caller.sessionId, card, plan, cwd, importance, ...(v.unresolved ? { unresolved: true as const } : {}) },
    });
    if (!to.ok) return reject(to.errors);
    plan.reasons.push(to.value.why);
    return {
      model: to.value.member.model, thinkingLevel: to.value.effort, briefAppend: briefAppend(card, plan, v.t0.specified, prof.value, blocks.value, s.delegation.nudge !== "off"),
      ...toolsFor(prof.value, card, cwd, caller.cwd), meta: { taskId: args.name, importance },
    };
  };
}
