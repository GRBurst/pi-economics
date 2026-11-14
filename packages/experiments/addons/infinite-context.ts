// The add-on of infinite-context's fold-reminder limit (redesign §7.4, M7a): tier seed. The patched extension keeps the
// limit its branch's latest `infinite-context:settings` record holds when the record's range is the one of the rule that
// matches the session's model and the value lies in it (a draw otherwise, which it appends). The engine writes that
// record first, in its own session_start (and again at model_select), with the level's value in the rule's range, so
// the extension adopts it; its record after its own handlers is the read-back. A rule without a range (a fixed number)
// draws nothing and ignores records: refused up front. The target is loaded when its tools are (the engine asks pi),
// the extension never asks the channel (it does not know pi-economics, G5). `matchRule` and `parseIcRules` follow the
// extension's selectRule/parseSettings for nudgeAtTokens; the check ic-seed-contract holds them equal.
import type { Level } from "../core/design.ts";
import type { Lever, ModelRef, Observed, SessionCtx } from "./types.ts";

/** A token limit: a fixed number, or a range [min, max] the extension draws a branch's limit from. */
export type Nudge = number | readonly [number, number];
/** The settings file's nudgeAtTokens: the top level and the rules keyed by `<provider>` or `<provider>/<id>`. */
export type IcRules = { top?: Nudge; overrides: Readonly<Record<string, { nudgeAtTokens?: Nudge }>> };
/**
 * The record the extension keeps its branch's settings in. The engine seeds its fields nudgeAtTokens, nudgeAtTokensRange and
 * rule; the extension completes the record with nudgeAtPercent, which the seed never has (what tells the extension's record
 * from the engine's own).
 */
export type IcRecord = { nudgeAtTokens: number; nudgeAtPercent?: number; nudgeAtTokensRange?: readonly [number, number]; rule?: string };

export const IC_ENTRY = "infinite-context:settings";
/** The tool the extension registers; the engine takes it as the sign that the extension is loaded. */
export const IC_TOOL = "context_fold";
/** The extension's own limit when no rule and no top level sets one (its DEFAULT_SETTINGS; the contract check holds it equal). */
export const IC_DEFAULT_NUDGE = 150_000;
export const IC_TARGET = "infinite-context";
const TARGET = IC_TARGET;

const positiveInt = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : 0);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Two positive whole token counts, the first smaller; else a positive whole number; else nothing (the field is left out). */
function nudgeOf(v: unknown): Nudge | undefined {
  if (Array.isArray(v) && v.length === 2) {
    const [min, max] = v.map(positiveInt);
    return min > 0 && min < max ? [min, max] : undefined;
  }
  return positiveInt(v) || undefined;
}

/** The nudgeAtTokens of the settings file's text, parsed fail-open per field like the extension's (undefined: no file). */
export function parseIcRules(json: string | undefined): IcRules {
  let value: unknown;
  try { value = json === undefined ? undefined : JSON.parse(json); } catch { /* an unparseable file reads as an empty one */ }
  const file = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const top = nudgeOf(file.nudgeAtTokens);
  const raw = isObject(file.overrides) ? file.overrides : {};
  const rules = Object.entries(raw).flatMap(([key, rule]): Array<[string, { nudgeAtTokens: Nudge }]> => {
    const nudge = isObject(rule) ? nudgeOf(rule.nudgeAtTokens) : undefined;
    return nudge === undefined ? [] : [[key, { nudgeAtTokens: nudge }]];
  });
  return { ...(top === undefined ? {} : { top }), overrides: Object.fromEntries(rules) };
}

/** The limit of a model's rule: the exact `<provider>/<id>` rule, then the provider's, then the top level, then upstream's default. */
export function matchRule(
  overrides: Readonly<Record<string, { nudgeAtTokens?: Nudge }>>,
  top: Nudge | undefined,
  provider: string | undefined,
  id: string | undefined,
): { rule?: string; nudge: Nudge } {
  const keys = !provider ? [] : id ? [`${provider}/${id}`, provider] : [provider];
  for (const key of keys) {
    const nudge = Object.hasOwn(overrides, key) ? overrides[key].nudgeAtTokens : undefined;
    if (nudge !== undefined) return { rule: key, nudge };
  }
  return { nudge: top ?? IC_DEFAULT_NUDGE };
}

/** The limit the fraction `q` of a range stands for: whole tokens, `min` at 0 and `max` at 1. */
export const tokensAt = (range: readonly [number, number], q: number): number => Math.round(range[0] + q * (range[1] - range[0]));

const isFraction = (l: Level): l is number => typeof l === "number" && l >= 0 && l <= 1;
const isRange = (n: Nudge): n is readonly [number, number] => typeof n !== "number";

/** The extension's latest well-formed settings record on a branch (the one it resolves from, and the read-back). */
function latestRecord(branch: readonly unknown[]): IcRecord | undefined {
  for (let i = branch.length - 1; i >= 0; i--) {
    const e = branch[i];
    const d = isObject(e) && e.type === "custom" && e.customType === IC_ENTRY ? e.data : undefined;
    if (isObject(d) && typeof d.nudgeAtTokens === "number" && Number.isFinite(d.nudgeAtTokens)) return d as IcRecord;
  }
  return undefined;
}
const sameRange = (a: unknown, b: readonly [number, number]): boolean => Array.isArray(a) && a.length === 2 && a[0] === b[0] && a[1] === b[1];

/** The lever of infinite-context's limit; `rules` reads the settings file the extension reads (the module writes it). */
export function infiniteContext(rules: () => IcRules): readonly Lever[] {
  const matched = (model: ModelRef | undefined) => {
    const r = rules();
    return matchRule(r.overrides, r.top, model?.provider, model?.id);
  };
  const nudge: Lever = {
    id: `${TARGET}.nudgeAtTokens`, target: TARGET, scope: "session", tier: "seed", readBackAt: "before_agent_start", follow: "model",
    // Levels are fractions q of the matched rule's range, so one level set fits every rule that has one (§7.4).
    feasible: (env, levels) => (isRange(matched(env.model).nudge) ? levels.filter(isFraction) : []),
    valueFor(ctx: SessionCtx, level: Level): Level {
      const { nudge: n } = matched(ctx.model);
      return isRange(n) && isFraction(level) ? tokensAt(n, level) : level;
    },
    apply(ctx: SessionCtx, level: Level): void {
      const { rule, nudge: n } = matched(ctx.model);
      if (!isRange(n) || !isFraction(level)) return;
      const record: IcRecord = { nudgeAtTokens: tokensAt(n, level), nudgeAtTokensRange: n, ...(rule === undefined ? {} : { rule }) };
      // The branch already holds it (a resumed session, a switch within one range): the extension keeps it; no second record.
      const held = latestRecord(ctx.branch?.() ?? []);
      if (held?.nudgeAtTokens === record.nudgeAtTokens && sameRange(held.nudgeAtTokensRange, n)) return;
      ctx.appendEntry?.(IC_ENTRY, record);
    },
    observe(ctx: SessionCtx): Observed {
      const d = latestRecord(ctx.branch?.() ?? []);
      // The extension's record has nudgeAtPercent, the engine's seed has not: a latest record without it is the engine's own
      // write, not yet adopted (a target that is listed but never ran, a misordered load): nothing to read back.
      if (d === undefined || typeof d.nudgeAtPercent !== "number" || !Number.isFinite(d.nudgeAtPercent)) return undefined;
      // A range: the extension drew it (its own experiment); none: a number the configuration fixed.
      return { v: d.nudgeAtTokens, s: d.nudgeAtTokensRange === undefined ? "fixed" : "ext" };
    },
  };
  return [nudge];
}
