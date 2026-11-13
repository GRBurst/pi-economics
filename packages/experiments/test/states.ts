// The §5.3 invariants of a lever state, shared by the add-on tests.
import type { LeverState } from "../addons/types.ts";

/**
 * The §5.3 invariants of a lever state, as token-meter's leverViolations (core/levers.ts, their one definition: its
 * writer refuses a line that breaks one) states them; a copy here because a package test reads only its own package.
 */
export function violations(x: LeverState): string[] {
  const out: string[] = [];
  const has = x.a !== undefined;
  const value = (v: unknown) => typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(v));
  if (!["pe", "ext", "fixed"].includes(x.s)) out.push("source");
  if (!value(x.v)) out.push("v");
  if (has && !value(x.a)) out.push("a");
  if (has !== (x.rb !== undefined)) out.push("a ⇔ rb");
  if (x.s === "pe" && !(has && (x.rb === "confirmed" || x.rb === "unverified"))) out.push("pe needs a and rb confirmed|unverified");
  if (x.rb === "confirmed" && x.v !== x.a) out.push("confirmed ⇒ v = a");
  if (x.rb === "refused" && (x.v === x.a || x.s === "pe")) out.push("refused ⇒ v ≠ a, s ∈ {ext, fixed}");
  if (x.rb === "unverified" && x.v !== x.a) out.push("unverified ⇒ v = a");
  return out;
}
