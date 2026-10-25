// Profiles (spec §5.2.3): a card kind names a profile; skills are inlined into the brief.
import { BUILTIN_PROFILES } from "./settings.ts";
import type { Profile, Result, RouterSettings } from "./types.ts";

// The built-ins are defaults: they live in core/settings.ts (MP1) and are re-exported here.
export { BUILTIN_PROFILES };

const BASE: Profile = { tools: "all", skills: [], report: "default" };

/** Settings override a built-in field by field and may add kinds; unknown kind → err listing the known ones. */
export function profileFor(kind: string, s: RouterSettings): Result<Profile> {
  const over = s.profiles[kind] as Partial<Profile> | undefined;
  const builtin = BUILTIN_PROFILES[kind];
  if (!over && !builtin) {
    const known = [...new Set([...Object.keys(BUILTIN_PROFILES), ...Object.keys(s.profiles)])];
    return { ok: false, errors: [`unknown kind "${kind}"; known kinds: ${known.join(", ")}`] };
  }
  const p: Profile = { ...BASE, ...builtin, ...over };
  // An override of the ability brings that ability's table, not the built-in's (spec S1; review G2 m3).
  if (over?.ability !== undefined && over.ability !== builtin?.ability && over.table === undefined) delete p.table;
  return { ok: true, value: p };
}

export type SkillPort = {
  find(name: string): { filePath: string; baseDir: string } | undefined;
  read(path: string): string;
};

export function skillBlocks(names: string[], port: SkillPort): Result<string> {
  const found = names.map((n) => ({ n, s: port.find(n) }));
  const missing = found.filter((f) => !f.s).map((f) => `unknown skill "${f.n}"`);
  if (missing.length) return { ok: false, errors: missing };
  const blocks = found.map(({ n, s }) =>
    `<skill name="${n}" location="${s!.filePath}">\nReferences are relative to ${s!.baseDir}.\n\n${port.read(s!.filePath)}\n</skill>`);
  return { ok: true, value: blocks.join("\n\n") };
}

/** Skills inlined into the brief: profile's then the card's, deduplicated, order kept (P-profile). */
export function skillNames(p: Profile, c: { skills?: string[] }): string[] {
  return [...new Set([...p.skills, ...(c.skills ?? [])])];
}
