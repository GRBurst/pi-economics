// Settings live in <agentDir>/cache-lifecycle/settings.json. Every key has a
// default, so the extension runs with no file at all (plain `pi install`).
import { readFileSync } from "node:fs";

export type Settings = {
  /** native: pi's own idle-warming rule; orchestrator-aware: keep a main with running children and a child awaiting a reply warm. */
  warmPolicy: "native" | "orchestrator-aware";
  /** Cache TTL requested for the main session (children always use the default 5m). */
  mainCacheTtl: "5m" | "1h";
  /** What the first request after cache expiry elides outside the protected tail. */
  maskOnCold: "off" | "tools" | "tools+thinking";
  /** Newest tokens of the transcript that are never elided. */
  protectedTailTokens: number;
  /** Keep message identity stable across projections so pi 1.0.0 cache warming survives custom messages. */
  identityShim: boolean;
};

export function defaults(): Settings {
  return { warmPolicy: "orchestrator-aware", mainCacheTtl: "5m", maskOnCold: "off", protectedTailTokens: 20000, identityShim: true };
}

const allowed: Record<string, readonly string[]> = {
  warmPolicy: ["native", "orchestrator-aware"],
  mainCacheTtl: ["5m", "1h"],
  maskOnCold: ["off", "tools", "tools+thinking"],
};

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
    if (typeof v === "boolean" || (allowed[k] ? allowed[k].includes(v as string) : Number.isFinite(v) && (v as number) >= 0)) out[k] = v;
  }
  return out as Settings;
}
