// Settings live in <agentDir>/token-meter/settings.json. Every key has a
// default, so the extension runs with no file at all (plain `pi install`).
import { readFileSync } from "node:fs";

export type Settings = {
  /** Write meter lines at all. */
  enabled: boolean;
  /** Log directory, relative to the agent dir unless absolute. */
  dir: string;
  /** Keep every anthropic-ratelimit-* header verbatim in `rawRatelimit`. */
  rawRatelimit: boolean;
};

export function defaults(): Settings {
  return { enabled: true, dir: "meter", rawRatelimit: true };
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
    if (k in base && typeof v === typeof (base as Record<string, unknown>)[k]) out[k] = v;
  }
  return out as Settings;
}
