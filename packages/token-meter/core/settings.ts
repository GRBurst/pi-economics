// Settings live in <agentDir>/token-meter/settings.json. Every key has a
// default, so the extension runs with no file at all (plain `pi install`).
import { readFileSync } from "node:fs";
import { parsePlans, type Plans } from "./plans.ts";

export type Settings = {
  /** Write meter lines at all. */
  enabled: boolean;
  /** Log directory, relative to the agent dir unless absolute. */
  dir: string;
  /** Keep every anthropic-ratelimit-* header verbatim in `rawRatelimit`. */
  rawRatelimit: boolean;
  /** Billing class, quota windows and local rate per provider (core/plans.ts); none: every provider counts as "api". */
  plans: Plans;
};

export function defaults(): Settings {
  return { enabled: true, dir: "meter", rawRatelimit: true, plans: {} };
}

/** Missing or invalid file → defaults(); known keys of the right type override, others are ignored. */
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
    if (k === "plans") out.plans = parsePlans(v);
    else if (k in base && typeof v === typeof (base as Record<string, unknown>)[k]) out[k] = v;
  }
  return out as Settings;
}
