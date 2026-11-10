// Tripwires (design §3.1.1, plan S10): pure, total detectors over a ring of call records. The main session's records
// carry results and file hashes; a child's (§3.1.3) only its calls. No text is kept: a call is its tool and key.
import { createHash } from "node:crypto";
import type { HintSettings } from "../types.ts";

export const TRIPS = ["identical-call", "no-change-writes", "alternation", "repeated-error", "churn", "check-failing",
  "over-size", "risky-path", "context-soft", "context-stall"] as const;
export type Trip = (typeof TRIPS)[number];
/** One tool call (§3.1.1): `hashBefore`/`hashAfter` are the target file's hashes around a write (undefined = the hash failed,
 *  or a missing file before a write); `turn` is the main session's turn number. */
export type CallRecord = { tool: string; key: string; isWrite: boolean; path?: string; hashBefore?: string; hashAfter?: string;
  isError?: boolean; errSig?: string; turn: number };

/** The ring's length (§3.1.1). */
export const windowSize = (h: HintSettings): number => 4 * h.identicalCalls + 8;
/** JSON with object keys sorted at every level (undefined members dropped, as JSON does). */
export const stableJson = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : stableJson(x))).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
};
/** A call's key (plan D16): the tool and a hash of its stable JSON input, so a ring of `write` calls stays small. */
export const callKey = (tool: string, input: unknown): string => `${tool}:${createHash("sha1").update(stableJson(input)).digest("hex")}`;
/** An error's signature (§3.1.1): lowercased, digits → #, whitespace collapsed, the first 500 characters. */
export const errSig = (text: string): string => text.toLowerCase().replace(/[0-9]/g, "#").replace(/\s+/g, " ").trim().slice(0, 500);
const trigrams = (s: string): Set<string> => {
  const t = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) t.add(s.slice(i, i + 3));
  return t;
};
/** Character-trigram Jaccard similarity; two strings too short for a trigram are similar only when equal. */
export const trigramJaccard = (a: string, b: string): number => {
  const A = trigrams(a), B = trigrams(b);
  let both = 0;
  for (const t of A) if (B.has(t)) both++;
  const union = A.size + B.size - both;
  return union === 0 ? (a === b ? 1 : 0) : both / union;
};
/** A tree change (plan D15): a write whose file hash changed; a new file counts, a failed hash after does not. */
export const changed = (r: CallRecord): boolean => r.isWrite && r.hashAfter !== undefined && r.hashAfter !== r.hashBefore;
/** The ring with `r` appended, cut to the last `windowSize(h)` records. */
export const push = (ring: CallRecord[], r: CallRecord, h: HintSettings): CallRecord[] => [...ring, r].slice(-windowSize(h));

type Changed = (r: CallRecord) => boolean;
/** The same key `identicalCalls` times since the last tree change before the last record (the change itself included). */
const identicalCall = (r: CallRecord[], h: HintSettings, ch: Changed): boolean => {
  const n = r.length, last = r[n - 1];
  let b = 0;
  for (let i = n - 2; i >= 0; i--) if (ch(r[i])) { b = i; break; }
  let c = 0;
  for (let i = b; i < n; i++) if (r[i].key === last.key) c++;
  return c >= h.identicalCalls;
};
/** The last `noChangeWrites` hashed writes left their file unchanged; the last record is one of them (a failed hash does not
 *  count, §3.1.4). */
const noChangeWrites = (r: CallRecord[], h: HintSettings): boolean => {
  const hashed = (x: CallRecord) => x.isWrite && x.hashBefore !== undefined && x.hashAfter !== undefined;
  if (!hashed(r[r.length - 1])) return false;
  const w = r.filter(hashed).slice(-h.noChangeWrites);
  return w.length >= h.noChangeWrites && w.every((x) => x.hashBefore === x.hashAfter);
};
/** The last 2·alternations keys are A, B, A, B, … (A ≠ B) with no tree change among them. */
const alternation = (r: CallRecord[], h: HintSettings, ch: Changed): boolean => {
  const m = 2 * h.alternations, n = r.length;
  if (n < m) return false;
  const t = r.slice(n - m), a = t[0].key, b = t[1].key;
  return a !== b && t.every((x, j) => x.key === (j % 2 ? b : a)) && !t.some(ch);
};

/** The trips the main session's ring fires after its last record, in `TRIPS` order. */
export function callTrips(ring: CallRecord[], h: HintSettings): Trip[] {
  if (!ring.length) return [];
  const out: Trip[] = [];
  if (identicalCall(ring, h, changed)) out.push("identical-call");
  if (noChangeWrites(ring, h)) out.push("no-change-writes");
  if (alternation(ring, h, changed)) out.push("alternation");
  return out;
}
