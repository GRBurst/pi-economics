// Levers (design §6.1 item 4, §5.3, §7.4): per lever the observed value distribution, its sources and the refusal rate.
// Unit = a session of the period (a meter line in it); its state = its last levers line up to the period's end, so a
// session that began before the period keeps the line written at its start (levers lines are written on change only).
import { type LeverState } from "../levers.ts";
import { byTs, countBy, isLine, push, type Period } from "./logs.ts";

export type LeverRow = { lever: string; sessions: number; values: Record<string, number>; sources: Record<string, number>;
  assigned: number; refused: number; unverified: number; refusalRate: number };
export type LeversSection = { sessions: number; withLevers: number; eligible: number; children: number; inert: number; levers: LeverRow[] };

const isLevers = (l: any): boolean => l?.kind === "levers" && typeof l.sessionId === "string" && !!l.levers && typeof l.levers === "object";
/** infinite-context cancels every native compaction (design D18): its other levers are then inert, not analysed (§5.3). */
const icOff = (ls: Record<string, LeverState>): boolean => ls["pi.compaction.enabled"]?.s === "ext" && ls["pi.compaction.enabled"]?.v === false;
const inert = (id: string): boolean => id.startsWith("pi.compaction.") && id !== "pi.compaction.enabled";

/** `all` = the whole meter log (a session's levers line may precede the period), `period` = its lines in the period. */
export function levers(all: any[], period: any[], p: Period = {}): LeversSection {
  const units = new Set(period.filter((l) => typeof l?.sessionId === "string").map((l) => l.sessionId as string));
  const last = new Map<string, any>();
  for (const l of all.filter((l) => isLine(l) && isLevers(l) && units.has(l.sessionId) && (p.until === undefined || l.ts.slice(0, 10) <= p.until)).sort(byTs)) last.set(l.sessionId, l);
  const lines = [...last.values()];
  const states = new Map<string, LeverState[]>();
  for (const l of lines) {
    const off = icOff(l.levers);
    for (const [id, s] of Object.entries(l.levers as Record<string, LeverState>)) if (!(off && inert(id))) push(states, id, s); // linear: never copy the list
  }
  const SOURCE_ORDER = ["pe", "ext", "fixed"];
  return {
    sessions: units.size,
    withLevers: lines.length,
    eligible: lines.filter((l) => l.eligible === true).length,
    children: lines.filter((l) => typeof l.parentSessionId === "string").length,
    inert: lines.filter((l) => icOff(l.levers)).length,
    levers: [...states.keys()].sort().map((lever) => {
      const xs = states.get(lever)!;
      const assigned = xs.filter((s) => s.a !== undefined).length;
      const refused = xs.filter((s) => s.rb === "refused").length;
      const sources = countBy(xs, (s) => String(s.s));
      return { lever, sessions: xs.length, values: countBy(xs, (s) => String(s.v)),
        sources: Object.fromEntries(Object.entries(sources).sort(([a], [b]) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b))),
        assigned, refused, unverified: xs.filter((s) => s.rb === "unverified").length, refusalRate: assigned ? refused / assigned : NaN };
    }),
  };
}

/** The last levers line of each session up to the period's end (a session that began earlier keeps the line written at its start): session → its levers. */
export function leverStates(all: any[], p: Period = {}): Map<string, Record<string, LeverState>> {
  const out = new Map<string, Record<string, LeverState>>();
  for (const l of all.filter((l) => isLine(l) && isLevers(l) && (p.until === undefined || l.ts.slice(0, 10) <= p.until)).sort(byTs)) out.set(l.sessionId, l.levers);
  return out;
}
