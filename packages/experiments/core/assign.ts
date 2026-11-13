// Pure parts of the v2 engine (redesign M5b.1, §7.3): a main's stratum and eligibility, the explore blocks, the exploit
// draw. Pure: all randomness comes in as `rand`, so tests seed it deterministically.
import type { Design, Level, LeverId } from "./design.ts";
import type { StratumSpec } from "./settings.ts";
// Type-only (plan P22): the import is erased at runtime, so the package ships without token-meter.
import type { Billing, Plans } from "../../token-meter/core/plans.ts";

export type Mode = "off" | "explore" | "exploit";

/**
 * A line of <agentDir>/experiments/assignments.jsonl, v2 (§5.4): one per main session at its first session_start.
 * `stratum` = the setup its model matched (none: ineligible), `design` = that stratum's design id (always with an arm);
 * an eligible session has `arm` (the bits of its levels, factor order) and `factors` (by factor name: the lever and
 * the level assigned to it); an ineligible one has neither. `parentSessionId` is channel-only (a child's Assigned):
 * the engine writes no child rows.
 */
export type AssignmentV2 = { v: 2; ts: string; sessionId: string; parentSessionId?: string; design?: string; mode: Mode;
  eligible: boolean; stratum?: string; arm?: string; factors?: Record<string, { lever: LeverId; assigned: Level }> };

/** token-meter's billingOf, restated (no value import across packages): a provider without a plan bills as api. */
const billingOf = (plans: Plans, provider: string): Billing => (Object.hasOwn(plans, provider) ? plans[provider].billing : "api");
/** A `<provider>/<id>` glob: `*` any run of characters (a slash included), `?` one character, everything else literal. */
const globMatches = (glob: string, s: string): boolean =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "s").test(s);

/** The stratum of a main (§7.3): the first in key order whose every given condition holds for its model at session_start. */
export function stratumOf(strata: Record<string, StratumSpec>, plans: Plans, provider: string, model: string): string | undefined {
  const billing = billingOf(plans, provider);
  return Object.keys(strata).find((name) => {
    const m = strata[name].match;
    return (m.billing === undefined || m.billing.includes(billing)) && (m.models === undefined || m.models.some((g) => globMatches(g, `${provider}/${model}`)));
  });
}

/** §7.3: only a main (never a child) whose model falls in a stratum takes part, and only while the mode is not off. */
export const eligibleFor = (isChild: boolean, stratum: string | undefined, mode: Mode): boolean => !isChild && stratum !== undefined && mode !== "off";

/**
 * The explore queues, persisted in <agentDir>/experiments/blocks.json: the arm names left in the current block, by
 * blockKey. Two strata with the same factors share a design id but never a queue (strata are never pooled, Q1).
 */
export type BlockState = Record<string, { queue: string[] }>;
/**
 * blocks.json as read (review m1): every block whose `queue` is a list of strings; any other block is dropped, so it is
 * rebuilt by the next draw (`bad` = something was dropped). A missing file (undefined) is no fault.
 */
export function parseBlocks(raw: unknown): { blocks: BlockState; bad: boolean } {
  if (raw === undefined) return { blocks: {}, bad: false };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { blocks: {}, bad: true };
  const blocks: BlockState = {};
  let bad = false;
  for (const [k, v] of Object.entries(raw)) {
    const q = v !== null && typeof v === "object" ? (v as { queue?: unknown }).queue : undefined;
    if (Array.isArray(q) && q.every((x) => typeof x === "string")) blocks[k] = { queue: q };
    else bad = true;
  }
  return { blocks, bad };
}

/** `<design id>/<stratum>`: the id is 12 hex, so the first slash separates them. */
export const blockKey = (d: Design): string => `${d.id}/${d.stratum}`;

/**
 * Explore (§7.3): permuted blocks. The next arm of the design's queue; an empty queue is refilled with a Fisher–Yates
 * shuffle of the enabled arms, so after m·|arms| draws every arm was drawn exactly m times. A disabled arm is skipped,
 * also when it was queued before it was disabled; none enabled: no arm. Pure: `state` is not changed.
 */
export function nextArm(state: BlockState, d: Design, rand: () => number, disabled: readonly string[] = []): { arm: string | undefined; state: BlockState } {
  const enabled = d.arms.map((a) => a.name).filter((n) => !disabled.includes(n));
  if (enabled.length === 0) return { arm: undefined, state };
  const key = blockKey(d);
  let queue = (state[key]?.queue ?? []).filter((n) => enabled.includes(n));
  if (queue.length === 0) {
    queue = [...enabled];
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1)) % (i + 1);
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
  }
  return { arm: queue[0], state: { ...state, [key]: { queue: queue.slice(1) } } };
}

export type Posterior = Record<string, { mean: number; sd: number }>;
/**
 * One design of one stratum in <agentDir>/experiments/state.json, under `designs.<design id>.<stratum>`: the posterior
 * REWARD by arm name and the arms the kill switch disabled. The flat `posterior`/`disabled` beside it belong to
 * designs v1–v4 (arm ids like "-+-") and are never read for a v2 design.
 */
export type DesignState = { posterior?: Posterior; disabled: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const own = (o: unknown, k: string): unknown => (isRecord(o) && Object.hasOwn(o, k) ? o[k] : undefined);

export function designState(raw: unknown, d: Design): DesignState {
  const s = own(own(own(raw, "designs"), d.id), d.stratum);
  const disabled = own(s, "disabled");
  const posterior = own(s, "posterior");
  return {
    ...(isRecord(posterior) ? { posterior: posterior as Posterior } : {}),
    disabled: Array.isArray(disabled) ? disabled.filter((x): x is string => typeof x === "string") : [],
  };
}

/**
 * An eligible main's arm (§7.3). explore: nextArm's permuted blocks. exploit: with probability minExplore a uniform
 * enabled arm (P-floor: every enabled arm keeps ≥ minExplore/|A|), else Thompson sampling over this design's posterior in
 * this stratum, argmax of the sampled rewards; no posterior for any enabled arm yet: the blocks, as in explore. No
 * enabled arm: none. `blocks` is the new queue state (unchanged unless the blocks drew).
 */
export function draw(mode: "explore" | "exploit", d: Design, blocks: BlockState, ds: DesignState, rand: () => number, minExplore: number): { arm: string | undefined; blocks: BlockState } {
  const enabled = d.arms.map((a) => a.name).filter((n) => !ds.disabled.includes(n));
  const post = ds.posterior;
  if (mode === "explore" || enabled.length === 0 || !enabled.some((n) => post !== undefined && Object.hasOwn(post, n))) {
    const r = nextArm(blocks, d, rand, ds.disabled);
    return { arm: r.arm, blocks: r.state };
  }
  if (rand() < minExplore) return { arm: enabled[Math.floor(rand() * enabled.length) % enabled.length], blocks };
  const sample = (n: string): number => {
    const p = post !== undefined && Object.hasOwn(post, n) ? post[n] : undefined;
    if (!p || !(p.sd > 0)) return Number.isFinite(p?.mean) ? p!.mean : 0;
    // Box–Muller normal from two rand draws.
    const u1 = Math.max(rand(), 1e-12);
    const u2 = rand();
    return p.mean + p.sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  let best = enabled[0];
  let bestSample = sample(best);
  for (const n of enabled.slice(1)) {
    const s = sample(n);
    if (s > bestSample) [best, bestSample] = [n, s];
  }
  return { arm: best, blocks };
}
