// (a) cost, fold ledger: the ledger (ledger.ts) grouped by design and foldHint level.
import { foldLedger, summarise, type LedgerSection } from "../ledger.ts";
import { designOf } from "./designs.ts";

/** Fold ledger (ledger.ts), grouped by `design foldHint-level`: v2 and v3 give foldHint different meanings, so they are never pooled; v4 has no foldHint ("–"). */
export function foldsOf(lines: any[], flags: Record<string, Record<string, string>>, rows: Map<string, any>): LedgerSection {
  const entries = foldLedger(lines, { flags });
  const group = (e: { root: string; arm: string }): string => (e.arm ? `${designOf(e.arm, rows.get(e.root))} ${flags[e.arm]?.foldHint ?? "–"}` : "(no arm)");
  return summarise(entries, group);
}
