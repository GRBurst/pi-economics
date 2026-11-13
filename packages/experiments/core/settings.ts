// Settings live in <agentDir>/experiments/settings.json. The file is the
// opt-in (spec D15): without it the extension is inert (plain `pi install`);
// with it, every key it lacks takes its default.
import { existsSync, readFileSync } from "node:fs";
import type { Factor, FactorSpec, Level } from "./design.ts";
// Type-only (plan P22): the import is erased at runtime, so the package ships without token-meter.
import type { Billing, Plans } from "../../token-meter/core/plans.ts";

export type Settings = {
  /** Arm selection mode; "off" always returns the baseline arm. */
  mode: "off" | "explore" | "exploit";
  /** Two-level factors to design the arms from. */
  factors: Factor[];
  /** Arm cap: full 2^k when 2^k <= maxArms, else the 2^(k-1) half fraction (k = 6: the 2^(k-2) quarter fraction when that is what fits). */
  maxArms: number;
  /** Share of the choice probability every enabled arm keeps in exploit mode (P-floor). */
  minExplore: number;
  /** Arm id returned in "off" mode; the default is the all-low arm id of the default factors. */
  baseline: string;
  /** Kill switch, evaluated by `meter-report --arms --posterior`, which runs on demand only (no timer): an arm with ≥ minSessions sessions whose verdict acceptance is below the baseline's by more than threshold (a fraction) is disabled. */
  guards: Guards;
  /** Source of the case-insensitive RegExp that marks a user message right after an assistant turn as a correction (guard). */
  correctionRegex: string;
};
/** Thresholds are "worse than the baseline's by more than": threshold = acceptance (fraction); the others are per-session (peeks after masking, corrections) or rating points. */
export type Guards = { minSessions: number; threshold: number; peekThreshold: number; correctionThreshold: number; ratingThreshold: number };

/**
 * The three online factors of design v4 (the full 2^3, 8 arms); values[0] is today's behaviour, so the all-low arm is the baseline.
 * v1 had five factors, v2 and v3 six (2^(6-2)): with them foldHint (infinite-context dropped its fold hint) and the router's
 * freshOnCold and delegationRule (no longer factors: the router's reads find its own settings).
 */
const ONLINE_FACTORS: Factor[] = [
  { name: "warmPolicy", values: ["native", "orchestrator-aware"] },
  { name: "mainCacheTtl", values: ["5m", "1h"] },
  { name: "maskOnCold", values: ["off", "on"] },
];

/** Design v4's factors as a stratum's factors over cache-lifecycle's levers (redesign §7.2): the default of the cloud strata (P12). */
export const V4_FACTORS: readonly FactorSpec[] = [
  { name: "warmPolicy", lever: "cache-lifecycle.warmPolicy", levels: ["native", "orchestrator-aware"] },
  { name: "mainCacheTtl", lever: "cache-lifecycle.mainCacheTtl", levels: ["5m", "1h"] },
  { name: "maskOnCold", lever: "cache-lifecycle.maskOnCold", levels: ["off", "on"] },
];

export function defaults(): Settings {
  return { mode: "explore", factors: ONLINE_FACTORS, maxArms: 16, minExplore: 0.1, baseline: "-".repeat(ONLINE_FACTORS.length), guards: { minSessions: 10, threshold: 0.2, peekThreshold: 1, correctionThreshold: 1, ratingThreshold: 0.5 }, correctionRegex: String.raw`\b(no|wrong|revert|undo|that's not)\b` };
}

const allowed: Record<string, readonly string[]> = {
  mode: ["off", "explore", "exploit"],
};

const isFactor = (f: unknown): f is Factor =>
  f !== null &&
  typeof f === "object" &&
  typeof (f as { name?: unknown }).name === "string" &&
  Array.isArray((f as { values?: unknown }).values) &&
  (f as { values: unknown[] }).values.length === 2 &&
  (f as { values: unknown[] }).values.every((v) => typeof v === "string");

/** The opt-in (spec D15): no file → undefined (experiments stays inert); a file → loadSettings(file). */
export function loadOptIn(file: string): Settings | undefined {
  return existsSync(file) ? loadSettings(file) : undefined;
}

/** Missing or invalid file → defaults(); known keys with a valid value override, others are ignored. */
export function loadSettings(file: string): Settings {
  const base = defaults();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return base;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(raw)) {
    if (!(k in base) || typeof v !== typeof (base as Record<string, unknown>)[k]) continue;
    if (k === "guards") {
      const g = v as Record<string, unknown>;
      out[k] = Object.fromEntries(Object.entries(base.guards).map(([key, d]) => [key, Number.isFinite(g[key]) && (g[key] as number) >= 0 ? g[key] : d]));
      continue;
    }
    if (k === "correctionRegex") {
      try { new RegExp(v as string, "i"); out[k] = v; } catch { /* keep the default */ }
      continue;
    }
    if (k === "factors") {
      if (Array.isArray(v) && v.every(isFactor)) out[k] = v;
      continue;
    }
    if (typeof v === "boolean" || (allowed[k] ? allowed[k].includes(v as string) : typeof v === "string" || (Number.isFinite(v) && (v as number) >= 0))) out[k] = v;
  }
  return out as Settings;
}

/**
 * What a stratum's experiment minimises per active hour (redesign §9.4): API-equivalent USD, cash USD, local cost,
 * wall time, or the 5 h / 7 d quota points. Defined here (the experiments setting); the analyser imports the type.
 */
export type Objective = (typeof OBJECTIVES)[number];
const OBJECTIVES = ["apiUsd", "cashUsd", "localCost", "wallMs", "points5h", "points7d"] as const;
/** Every billing class of core/plans.ts, in the default strata's order: tsc fails here when plans.ts gains or loses one. */
const BILLING_CLASSES = { subscription: true, api: true, free: true, local: true } satisfies Record<Billing, true>;
const BILLINGS = Object.keys(BILLING_CLASSES) as Billing[];

/**
 * A setup whose mains share one design (§7.3): it matches a main by billing class (from `plans`) and/or
 * `<provider>/<id>` globs, every given condition must hold; an empty match matches every main.
 */
export type StratumSpec = { match: { billing?: Billing[]; models?: string[] }; objective: Objective; factors: FactorSpec[] };
/** The strata in key order, and why a stratum was dropped or the setting ignored (to surface once per session). */
export type Strata = { strata: Record<string, StratumSpec>; warnings: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isLevel = (v: unknown): v is Level => typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
const nonEmptyListOf = <T>(v: unknown, is: (x: unknown) => x is T): v is T[] => Array.isArray(v) && v.length > 0 && v.every(is);
/** The first key of `o` not in `known` (a misspelt key would otherwise widen the stratum or drop its factors). */
const unknownKey = (o: Record<string, unknown>, known: readonly string[]): string | undefined => Object.keys(o).find((k) => !known.includes(k));

/**
 * The `strata` setting. Absent (or of a wrong type, with a warning): plan P12's defaults, one stratum per billing
 * class of `plans` and "api" (a provider without a plan bills as api), each named after its class; the cloud
 * classes get `legacy` (the v4 factors) and objective apiUsd, "local" gets no factors (OQ3) and localCost. Given:
 * each stratum as written, its objective defaulting to localCost for a local-only match and apiUsd otherwise; a
 * malformed stratum (an unknown key included) is dropped whole (never repaired into a design nobody asked for) with
 * a warning.
 */
export function parseStrata(raw: unknown, plans: Plans, legacy: readonly FactorSpec[]): Strata {
  if (raw !== undefined && raw !== null && !isRecord(raw)) {
    return { strata: defaultStrata(plans, legacy), warnings: ["experiments strata is not an object; the default strata apply"] };
  }
  if (!isRecord(raw)) return { strata: defaultStrata(plans, legacy), warnings: [] };
  const strata: [string, StratumSpec][] = [];
  const warnings: string[] = [];
  for (const [name, s] of Object.entries(raw)) {
    const parsed = parseStratum(s);
    if (typeof parsed === "string") warnings.push(`experiments stratum ${name} dropped: ${parsed}`);
    else strata.push([name, parsed]);
  }
  // fromEntries defines own keys: a stratum named "__proto__" stays one.
  return { strata: Object.fromEntries(strata), warnings };
}

function defaultStrata(plans: Plans, legacy: readonly FactorSpec[]): Record<string, StratumSpec> {
  const present = new Set<Billing>(["api", ...Object.values(plans).map((p) => p.billing)]);
  return Object.fromEntries(BILLINGS.filter((b) => present.has(b)).map((b): [string, StratumSpec] => [b, b === "local"
    ? { match: { billing: [b] }, objective: "localCost", factors: [] }
    : { match: { billing: [b] }, objective: "apiUsd", factors: [...legacy] }]));
}

/** A stratum, or why it is dropped. */
function parseStratum(s: unknown): StratumSpec | string {
  if (!isRecord(s)) return "not an object";
  const extra = unknownKey(s, ["match", "objective", "factors"]);
  if (extra !== undefined) return `unknown key ${extra}`;
  if (!isRecord(s.match)) return "match is not an object";
  const extraMatch = unknownKey(s.match, ["billing", "models"]);
  if (extraMatch !== undefined) return `unknown key match.${extraMatch}`;
  const match: StratumSpec["match"] = {};
  if (s.match.billing !== undefined) {
    if (!nonEmptyListOf(s.match.billing, (b): b is Billing => BILLINGS.includes(b as Billing))) return "match.billing is not a non-empty list of billing classes";
    match.billing = [...s.match.billing];
  }
  if (s.match.models !== undefined) {
    if (!nonEmptyListOf(s.match.models, (m): m is string => typeof m === "string")) return "match.models is not a non-empty list of strings";
    match.models = [...s.match.models];
  }
  const local = match.billing?.every((b) => b === "local") ?? false;
  const objective = s.objective ?? (local ? "localCost" : "apiUsd");
  if (!OBJECTIVES.includes(objective as Objective)) return `objective ${String(objective)} is not one of ${OBJECTIVES.join(", ")}`;
  const raw = s.factors ?? [];
  if (!Array.isArray(raw)) return "factors is not a list";
  const factors: FactorSpec[] = [];
  for (const [i, f] of raw.entries()) {
    if (!isRecord(f) || typeof f.name !== "string" || typeof f.lever !== "string" || !Array.isArray(f.levels) || f.levels.length !== 2 || !f.levels.every(isLevel)) {
      return `factor ${i + 1} needs a name, a lever and two levels`;
    }
    const extraFactor = unknownKey(f, ["name", "lever", "levels"]);
    if (extraFactor !== undefined) return `factor ${i + 1}: unknown key ${extraFactor}`;
    if (f.levels[0] === f.levels[1]) return `factor ${i + 1} has two equal levels`;
    if (factors.some((g) => g.name === f.name)) return `factor name ${f.name} repeated`;
    if (factors.some((g) => g.lever === f.lever)) return `lever ${f.lever} repeated`;
    factors.push({ name: f.name, lever: f.lever, levels: [f.levels[0], f.levels[1]] });
  }
  if (factors.length > 6) return `${factors.length} factors, at most 6`;
  return { match, objective: objective as Objective, factors };
}
