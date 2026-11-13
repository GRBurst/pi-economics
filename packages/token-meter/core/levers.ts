// Levers (design §5.3): the effective value of each lever, who decided it and whether it was read back.
// Pure; the shell writes the lines (meter log, `kind: "levers"`), the analyser reads them.

/** pi-economics assigned it | an extension chose it (own default or own experiment) | configuration or pi default */
export type Source = "pe" | "ext" | "fixed";
export type ReadBack = "confirmed" | "refused" | "unverified";
export type Value = string | number | boolean;
export type LeverState = {
  v: Value;              // effective value
  s: Source;
  a?: Value;             // assigned value, present iff pi-economics assigned one
  rb?: ReadBack;         // present iff `a` is present
  tier?: "seed" | "control" | "replace" | "shadow"; // how the add-on applied it (§7.4)
};
/** "<target>.<name>" | "pi.activeTool(<n>)" | "session-entry(<t>,<f>)" */
export type LeverId = string;

const SOURCES = ["pe", "ext", "fixed"];
const READBACKS = ["confirmed", "refused", "unverified"];
const TIERS = ["seed", "control", "replace", "shadow"];
/** A level name (`medium`, `streaming`, `short`): no text values on a levers line (§5.3). */
const LEVEL = /^[a-z][a-z0-9_-]{0,31}$/;

export const isValue = (x: unknown): x is Value =>
  typeof x === "boolean" || (typeof x === "number" && Number.isFinite(x)) || (typeof x === "string" && LEVEL.test(x));

/** The broken §5.3 invariants of one lever state; [] iff it holds them all. */
export function leverViolations(x: LeverState): string[] {
  const out: string[] = [];
  const has = x.a !== undefined;
  if (!SOURCES.includes(x.s)) out.push(`source ${String(x.s)} is not one of ${SOURCES.join(", ")}`);
  if (x.rb !== undefined && !READBACKS.includes(x.rb)) out.push(`read-back ${String(x.rb)} is unknown`);
  if (x.tier !== undefined && !TIERS.includes(x.tier)) out.push(`tier ${String(x.tier)} is not one of ${TIERS.join(", ")}`);
  if (!isValue(x.v)) out.push("v is not a level name, number or boolean");
  if (has && !isValue(x.a)) out.push("a is not a level name, number or boolean");
  if (!has && x.rb !== undefined) out.push("read-back without an assigned value");
  if (has && x.rb === undefined) out.push("assigned value without read-back");
  if (x.s === "pe" && !has) out.push("source pe without an assigned value");
  if (x.s === "pe" && has && x.rb !== "confirmed" && x.rb !== "unverified") out.push("source pe needs read-back confirmed or unverified");
  if (x.rb === "confirmed" && x.v !== x.a) out.push("confirmed but v ≠ a");
  if (x.rb === "refused" && x.v === x.a) out.push("refused but v = a");
  if (x.rb === "refused" && x.s === "pe") out.push("refused with source pe (the target's own choice is ext or fixed)");
  if (x.rb === "unverified" && x.v !== x.a) out.push("unverified but v ≠ a (v is the assumed a)");
  return out;
}

export type LeversLine = {
  v: 2; ts: string; sessionId: string; parentSessionId?: string; kind: "levers";
  arm?: string; design?: string; eligible: boolean; stratum?: string;
  levers: Record<LeverId, LeverState>;
};

/** The byte cap of a meter line (line.ts); a levers line over it is refused, not truncated. */
const MAX_BYTES = 4096;

export const serializeLevers = (l: LeversLine): string => JSON.stringify(l) + "\n";

/** A levers line in key order; throws on a state that breaks §5.3 or a line over 4096 bytes. */
export function leversLine(base: Omit<LeversLine, "v" | "kind">): LeversLine {
  for (const [id, st] of Object.entries(base.levers)) {
    const bad = leverViolations(st);
    if (bad.length) throw new Error(`levers: ${id}: ${bad.join("; ")}`);
  }
  const l = { v: 2, ts: base.ts, sessionId: base.sessionId } as LeversLine;
  if (base.parentSessionId !== undefined) l.parentSessionId = base.parentSessionId;
  l.kind = "levers";
  if (base.arm !== undefined) l.arm = base.arm;
  if (base.design !== undefined) l.design = base.design;
  l.eligible = base.eligible;
  if (base.stratum !== undefined) l.stratum = base.stratum;
  l.levers = base.levers;
  const bytes = Buffer.byteLength(serializeLevers(l));
  if (bytes > MAX_BYTES) throw new Error(`levers: line of ${bytes} bytes exceeds ${MAX_BYTES}`);
  return l;
}
