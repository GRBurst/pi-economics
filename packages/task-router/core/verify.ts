// Code verifies the card's t0 claims; it can only lower them (spec §5.2.4, P-verify).
import { dirname, isAbsolute, join, normalize } from "node:path";
import { globMatch } from "./glob.ts";
import type { Card, RouterSettings, T0, T2 } from "./types.ts";

export interface FsPort { exists(p: string): boolean; size(p: string): number; isDir(p: string): boolean }
/** `unresolved`: a relative file's directory is missing under the cwd (wrong cwd?); bounded stays lowered, analysis can exclude it. */
export type Verified = { t0: T0; forceT2: boolean; reasons: string[]; unresolved?: true };

/** The task's working directory: the card's `cwd` (`~` expanded) or the caller's. */
export function resolveCwd(cardCwd: string | undefined, callerCwd: string, home: string): string {
  if (cardCwd === undefined) return callerCwd;
  const p = cardCwd === "~" ? home : cardCwd.startsWith("~/") ? join(home, cardCwd.slice(2)) : cardCwd;
  return normalize(p).replace(/(.)\/$/, "$1");
}

const BYTES_PER_TOKEN = 3.6;
const hit = (words: string[], text: string) => words.find((w) => text.includes(w.toLowerCase()));

export function verifyT0(c: Card, cwd: string, fs: FsPort, s: RouterSettings): Verified {
  const t0 = { ...c.t0 };
  const reasons: string[] = [];
  const lower = (k: keyof T0, why: string) => { t0[k] = false; reasons.push(`${k}=false: ${why}`); };

  const abs = c.files.map((f) => (isAbsolute(f) ? f : join(cwd, f)));
  // A file that does not exist yet is new (0 bytes) if its directory exists; only a missing directory lowers bounded.
  const isNew = abs.map((p) => !fs.exists(p));
  const stray = c.files.filter((_, i) => isNew[i] && !fs.isDir(dirname(abs[i])));
  const relative = stray.filter((f) => !isAbsolute(f));
  const absolute = stray.filter((f) => isAbsolute(f));
  if (relative.length) lower("bounded", `files unresolved under ${cwd}: ${relative.join(", ")}`);
  if (absolute.length) lower("bounded", `no such directory for: ${absolute.join(", ")}`);
  if (c.files.length > s.t0Limits.files) lower("small", `${c.files.length} files > ${s.t0Limits.files}`);
  const tokens = abs.reduce((n, p, i) => n + (isNew[i] ? 0 : fs.size(p)), 0) / BYTES_PER_TOKEN;
  if (tokens > s.t0Limits.tokens) lower("small", `~${Math.round(tokens)} tokens > ${s.t0Limits.tokens}`);
  if (!c.check?.trim()) lower("verifiable", "no check");
  if (c.acceptance.length < 1) lower("specified", "no acceptance criteria");

  const risky = c.files.filter((f) => s.riskGlobs.some((g) => globMatch(g, f)));
  if (risky.length) lower("lowRisk", `risk glob: ${risky.join(", ")}`);
  const text = [...c.files, c.check ?? "", ...c.acceptance].join("\n").toLowerCase();
  const word = hit(s.riskKeywords, text);
  if (word) lower("lowRisk", `risk keyword "${word}"`);
  let forceT2 = false;
  for (const [cat, words] of Object.entries(s.t2Keywords) as [T2, string[]][]) {
    const w = hit(words, text);
    if (w) { forceT2 = true; lower("lowRisk", `${cat} keyword "${w}"`); }
  }
  return { t0, forceT2, reasons, ...(relative.length ? { unresolved: true as const } : {}) };
}
