// The data-only seed kind `session-entry(<customType>,<field>)` (redesign §7.4 seed tier, §12; M7c): for any extension
// that adopts a value recorded on the session branch the way infinite-context does (it keeps the latest entry of its
// own customType when the value is acceptable, else draws and records its own). Apply appends the custom entry
// `{ [field]: level }` before the target reads (the engine's session_start precedes the target's); read-back at
// before_agent_start is the latest entry of the customType: the seed itself when the target adopted it, the
// target's own record (source `ext`) when it drew another value. A target that is not loaded, or ignores the seed
// without recording anything, leaves the seed latest: the read-back cannot tell that from an adoption (seed-tier
// limit; the target is not named, no consumer code is loaded). Children inherit: the child's branch is seeded with
// its root's level, and a target loaded there adopts or redraws as in a main.
import type { Kind, Lever, Observed, SessionCtx } from "./types.ts";
import type { Level } from "../core/design.ts";

/** What the add-on uses of pi's ExtensionAPI: the entry writer, and the listings that show a target is loaded (tools, commands). */
export type Appender = {
  appendEntry(customType: string, data?: unknown): void;
  getAllTools(): ReadonlyArray<{ name: string }>;
  getCommands(): ReadonlyArray<{ name: string }>;
};

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

/** The index and data of the latest entry of `customType` on a branch (oldest first), or undefined. */
function latest(branch: readonly unknown[], customType: string): { at: number; data: unknown } | undefined {
  for (let i = branch.length - 1; i >= 0; i--) {
    const e = branch[i];
    if (isRecord(e) && e.type === "custom" && e.customType === customType) return { at: i, data: e.data };
  }
  return undefined;
}
const entries = (ctx: SessionCtx): readonly unknown[] | undefined => {
  try { return ctx.branch?.(); } catch { return undefined; }
};

function sessionEntry(pi: Appender, customType: string, field: string, target: string | undefined): Lever {
  // Per session: where the engine's seed sits on the branch, when the type already had a record before it (review F1: a
  // target that ran before the engine drew and recorded its own value, so the seed that follows is no evidence of anything).
  const seeded = new Map<string, { level: Level; at: number; recordBefore: boolean }>();
  // Review F1b: the seed is no evidence, a target pi lists is: a tool or a command of its name (read at each read-back).
  const listed = (): boolean => {
    if (target === undefined) return false;
    const has = (names: () => ReadonlyArray<{ name: string }>) => { try { return names().some((x) => x.name === target); } catch { return false; } };
    return has(() => pi.getAllTools()) || has(() => pi.getCommands());
  };
  return {
    id: `session-entry(${customType},${field})`, target: "pi", scope: "session", tier: "seed", readBackAt: "before_agent_start",
    feasible: (_env, levels) => levels,
    apply(ctx, level) {
      const branch = entries(ctx);
      const prior = branch === undefined ? undefined : latest(branch, customType);
      const at = branch?.length ?? -1; // where the seed will sit
      if (prior !== undefined && isRecord(prior.data) && prior.data[field] === level) {
        seeded.set(ctx.sessionId, { level, at, recordBefore: false }); // already the latest record (a reload; or the target ran first and used it)
        return;
      }
      pi.appendEntry(customType, { [field]: level });
      seeded.set(ctx.sessionId, { level, at, recordBefore: prior !== undefined });
    },
    observe(ctx): Observed {
      const branch = entries(ctx);
      const l = branch === undefined ? undefined : latest(branch, customType);
      if (l === undefined) return undefined;
      const seed = seeded.get(ctx.sessionId);
      if (seed?.recordBefore && l.at <= seed.at) return undefined; // the latest record is our own seed, over another one: nothing from the target yet
      const v = isRecord(l.data) ? l.data[field] : undefined;
      if (!isLevel(v) || (v === seed?.level && !listed())) return undefined; // what would confirm needs the target listed; a contradiction refuses either way
      return { v, s: "ext" }; // the latest entry of the type decides, whatever it holds
    },
  };
}

/** The lever kind of `session-entry(<customType>,<field>)` ids. */
export const sessionEntryKind = (pi: Appender): Kind => ({
  name: "session-entry",
  arity: 2,
  make(id, factor) {
    const p = parseSessionEntry(id);
    return p === undefined ? undefined : sessionEntry(pi, p.customType, p.field, factor?.target);
  },
});
