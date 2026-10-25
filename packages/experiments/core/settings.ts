// Settings live in <agentDir>/experiments/settings.json. Every key has a
// default, so the extension runs with no file at all (plain `pi install`).
import { readFileSync } from "node:fs";
import type { Factor } from "./design.ts";

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

/** The six online factors (designs v2 and v3: 2^(6-2), 16 arms, the arm ids are the same in both; v1 had the first five); values[0] is today's behaviour, so the all-low arm is the baseline. */
const ONLINE_FACTORS: Factor[] = [
  { name: "warmPolicy", values: ["native", "orchestrator-aware"] },
  { name: "mainCacheTtl", values: ["5m", "1h"] },
  { name: "foldHint", values: ["fixed", "cache-aware"] },
  { name: "maskOnCold", values: ["off", "on"] },
  { name: "freshOnCold", values: ["off", "advise"] },
  { name: "delegationRule", values: ["off", "on"] },
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
