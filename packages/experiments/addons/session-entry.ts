// The data-only seed kind `session-entry(<customType>,<field>)` (redesign §7.4 seed tier, §12; M7c): for any extension
// that adopts a value recorded on the session branch the way infinite-context does (it keeps the latest entry of its
// own customType when the value is acceptable, else draws and records its own). Apply appends the custom entry
// `{ [field]: level }` before the target reads (the engine's session_start precedes the target's); read-back at
// before_agent_start is the latest entry of the customType: the seed itself when the target adopted it, the
// target's own record (source `ext`) when it drew another value. A target that is not loaded, or ignores the seed
// without recording anything, leaves the seed latest: the read-back cannot tell that from an adoption (seed-tier
// limit; the target is not named, no consumer code is loaded). Children inherit: the child's branch is seeded with
// its root's level, and a target loaded there adopts or redraws as in a main.
import type { Kind, Lever, Observed } from "./types.ts";
import type { Level } from "../core/design.ts";

/** What the add-on uses of pi's ExtensionAPI. */
export type Appender = { appendEntry(customType: string, data?: unknown): void };

/** A customType or field: no parentheses, commas, space, tab or line break (an id stays one token on a levers line; modules/experiments.nix says the same). */
const NAME = "[^(), \\t\\r\\n]+";
const ID = new RegExp(`^session-entry\\((${NAME}),(${NAME})\\)$`);

/** The customType and field an id `session-entry(<customType>,<field>)` names; undefined when the id is not of that form. */
export function parseSessionEntry(id: string): { customType: string; field: string } | undefined {
  const m = ID.exec(id);
  return m === null ? undefined : { customType: m[1], field: m[2] };
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isLevel = (v: unknown): v is Level => typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));

function sessionEntry(pi: Appender, customType: string, field: string): Lever {
  return {
    id: `session-entry(${customType},${field})`, target: "pi", scope: "session", tier: "seed", readBackAt: "before_agent_start",
    feasible: (_env, levels) => levels,
    apply: (_ctx, level) => pi.appendEntry(customType, { [field]: level }),
    observe(ctx): Observed {
      let branch: readonly unknown[];
      try { branch = ctx.branch?.() ?? []; } catch { return undefined; }
      for (let i = branch.length - 1; i >= 0; i--) {
        const e = branch[i];
        if (!isRecord(e) || e.type !== "custom" || e.customType !== customType) continue;
        const v = isRecord(e.data) ? e.data[field] : undefined;
        return isLevel(v) ? { v, s: "ext" } : undefined; // the latest entry of the type decides, whatever it holds
      }
      return undefined;
    },
  };
}

/** The lever kind of `session-entry(<customType>,<field>)` ids. */
export const sessionEntryKind = (pi: Appender): Kind => (id) => {
  const p = parseSessionEntry(id);
  return p === undefined ? undefined : sessionEntry(pi, p.customType, p.field);
};
