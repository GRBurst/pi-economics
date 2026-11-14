// The pi settings that are process-scope levers (redesign §8.1 "bench", §10, M9): lever id → its path in settings.json,
// the kind of level and pi 1.4's default (what runs when no settings file sets it). No imports: the bench ships this
// file beside design.ts, and the add-on (addons/pi-process.ts) reads the same table, so both sides name the same keys.

export const PROCESS_SETTINGS: Readonly<Record<string, { path: readonly string[]; kind: "boolean" | "tokens"; default: boolean | number }>> = {
  "pi.compaction.enabled": { path: ["compaction", "enabled"], kind: "boolean", default: true },
  "pi.compaction.reserveTokens": { path: ["compaction", "reserveTokens"], kind: "tokens", default: 16384 },
  "pi.compaction.keepRecentTokens": { path: ["compaction", "keepRecentTokens"], kind: "tokens", default: 20000 },
};

/** A token count pi accepts: a safe, non-negative integer. */
export const isCount = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
