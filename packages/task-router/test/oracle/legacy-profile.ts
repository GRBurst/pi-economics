// FROZEN ORACLE — copy of core/profile.ts at d79921d, imports rewritten; never edit (spec §8.2; plan T0.3).
// Profiles (spec §5.2.3): a card kind names a profile; skills are inlined into the brief.
import type { Profile, Result, RouterSettings } from "./legacy-types.ts";

export const BUILTIN_PROFILES: Record<string, Profile> = {
  scout: { minTier: "T1", tools: "read-only", skills: [], report: "answer" },
  mechanical: { tools: "all", skills: [], report: "default" },
  implement: { tools: "all", skills: [], report: "default" },
  "debug-design": { minTier: "T1", tools: "all", skills: ["systematic-debugging"], report: "default" },
  review: { minTier: "T1", tools: "read-only", skills: ["code-reviewer"], report: "review" },
  plan: { tier: "T2", tools: "read-only+files", skills: ["tdd-implementation-planner"], report: "plan" },
};

const BASE: Profile = { tools: "all", skills: [], report: "default" };

/** Settings override a built-in field by field and may add kinds; unknown kind → err listing the known ones. */
export function profileFor(kind: string, s: RouterSettings): Result<Profile> {
  const over = s.profiles[kind] as Partial<Profile> | undefined;
  const builtin = BUILTIN_PROFILES[kind];
  if (!over && !builtin) {
    const known = [...new Set([...Object.keys(BUILTIN_PROFILES), ...Object.keys(s.profiles)])];
    return { ok: false, errors: [`unknown kind "${kind}"; known kinds: ${known.join(", ")}`] };
  }
  return { ok: true, value: { ...BASE, ...builtin, ...over } };
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
