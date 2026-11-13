// The pi settings that are process-scope levers (redesign §8.1 "bench", §10, M9): lever id → its path in settings.json
// and the kind of level. No imports: the bench ships this file beside design.ts, and the add-on (addons/pi-process.ts)
// reads the same table, so both sides name the same keys.

export const PROCESS_SETTINGS: Readonly<Record<string, { path: readonly string[]; kind: "boolean" | "tokens" }>> = {
  "pi.compaction.enabled": { path: ["compaction", "enabled"], kind: "boolean" },
  "pi.compaction.reserveTokens": { path: ["compaction", "reserveTokens"], kind: "tokens" },
  "pi.compaction.keepRecentTokens": { path: ["compaction", "keepRecentTokens"], kind: "tokens" },
};
