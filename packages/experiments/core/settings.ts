// Settings live in <agentDir>/experiments/settings.json. The file is the
// opt-in (spec D15): without it the extension is inert (plain `pi install`);
// with it, every key it lacks takes its default.
import { existsSync, readFileSync } from "node:fs";
import type { FactorSpec, Level } from "./design.ts";
// Type-only (plan P22): the import is erased at runtime, so the package ships without token-meter.
import type { Billing, Plan, Plans } from "../../token-meter/core/plans.ts";

export type Settings = {
  /** Arm selection mode; "off": no session is eligible (every lever keeps its extension's own setting). */
  mode: "off" | "explore" | "exploit";
  /** Share of the choice probability every enabled arm keeps in exploit mode (P-floor). */
  minExplore: number;
  /** Kill switch, evaluated by `meter-report --arms --posterior`, which runs on demand only (no timer): an arm with ≥ minSessions sessions whose verdict acceptance is below the baseline's by more than threshold (a fraction) is disabled. */
  guards: Guards;
  /** Source of the case-insensitive RegExp that marks a user message right after an assistant turn as a correction (guard). */
  correctionRegex: string;
  /** The setups and their designs (§7.2, §7.3), as written: parseStrata validates them (absent: one stratum per billing class). */
  strata?: unknown;
};
/** Thresholds are "worse than the baseline's by more than": threshold = acceptance (fraction); the others are per-session (peeks after masking, corrections) or rating points. */
export type Guards = { minSessions: number; threshold: number; peekThreshold: number; correctionThreshold: number; ratingThreshold: number };

/** Design v4's factors as a stratum's factors over cache-lifecycle's levers (redesign §7.2): the default of the cloud strata (P12). */
export const V4_FACTORS: readonly FactorSpec[] = [
  { name: "warmPolicy", lever: "cache-lifecycle.warmPolicy", levels: ["native", "orchestrator-aware"] },
  { name: "mainCacheTtl", lever: "cache-lifecycle.mainCacheTtl", levels: ["5m", "1h"] },
  { name: "maskOnCold", lever: "cache-lifecycle.maskOnCold", levels: ["off", "on"] },
];

export function defaults(): Settings {
  return { mode: "explore", minExplore: 0.1, guards: { minSessions: 10, threshold: 0.2, peekThreshold: 1, correctionThreshold: 1, ratingThreshold: 0.5 }, correctionRegex: String.raw`\b(no|wrong|revert|undo|that's not)\b` };
}

const allowed: Record<string, readonly string[]> = {
  mode: ["off", "explore", "exploit"],
};

/** The opt-in (spec D15): no file → undefined (experiments stays inert); a file → loadSettings(file). */
export function loadOptIn(file: string): Settings | undefined {
  return existsSync(file) ? loadSettings(file) : undefined;
}

/**
 * Missing or invalid file → defaults(); known keys with a valid value override, others are ignored (the v1 engine's
 * factors, maxArms and baseline among them: designs come from `strata`). `strata` is kept as written.
 */
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
    if (k === "strata") {
      out[k] = v;
      continue;
    }
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
    if (typeof v === "boolean" || (allowed[k] ? allowed[k].includes(v as string) : typeof v === "string" || (Number.isFinite(v) && (v as number) >= 0))) out[k] = v;
  }
  return out as Settings;
}

/**
 * The `plans` of token-meter's settings file (<agentDir>/token-meter/settings.json, where Nix's tokenMeter.plans and a
 * hand-written file put them): the providers with a known billing class. The strata match by class only; a plan
 * token-meter would reject for its other keys still names its class here. No file, no plans: every provider bills as api.
 */
export function readPlans(file: string): Plans {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, "utf8")); } catch { return {}; }
  const plans = isRecord(raw) ? raw.plans : undefined;
  if (!isRecord(plans)) return {};
  const out: [string, Plan][] = [];
  for (const [provider, p] of Object.entries(plans)) {
    if (!isRecord(p) || !BILLINGS.includes(p.billing as Billing)) continue;
    const windows = Array.isArray(p.windows) ? p.windows.filter((w): w is Plan["windows"][number] => w === "5h" || w === "7d") : [];
    out.push([provider, { billing: p.billing as Billing, windows }]);
  }
  return Object.fromEntries(out);
}

/**
 * What a stratum's experiment minimises per active hour (redesign §9.4): API-equivalent USD, cash USD, local cost,
 * wall time, or the 5 h / 7 d quota points. Defined here (the experiments setting); token-meter's analyser keeps its
 * own copy of the literal set (core/analyse/experiment.ts, no cross-import); the checks iface-objective-* keep them equal.
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
