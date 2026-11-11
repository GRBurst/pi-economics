// Profile tools → spawn-policy `tools` allowlist and `toolGuard` (spec §5.2.3, T5.17).
import { isAbsolute, join, normalize } from "node:path";
import type { Card, Profile } from "./types.ts";

// pi 1.4's `tools` allowlist covers extension tools too, so a read-only child must
// name the non-mutating extension tools it keeps: the search pair and infinite-context's
// context tools. (A denylist of writers would need `excludeTools`, which actor-subagents does not pass.)
const READ_ONLY = ["read", "grep", "find", "ls", "bash", "web_search", "web_fetch", "context_fold", "context_map", "context_peek", "context_search"];
const WRITERS = ["write", "edit"];

/** A spawn policy's `toolGuard` (core/api.ts `PolicyResult`): a string blocks the child's call with that reason. */
export type Guard = (tool: string, input: unknown) => string | undefined | Promise<string | undefined>;
/** A guard that answers at once (profile tools, trip wires); `composeGuards` keeps a composition of them synchronous. */
export type SyncGuard = (tool: string, input: unknown) => string | undefined;
/** Guards in order (design §2.2.3, plan D19): each runs until one blocks; that block wins. No guard → undefined. D44: a guard may
 *  answer with a Promise; the answer stays synchronous until a guard returns one, which turns the rest of the chain into a Promise. */
export function composeGuards(...gs: (SyncGuard | undefined)[]): SyncGuard | undefined;
export function composeGuards(...gs: (Guard | undefined)[]): Guard | undefined;
export function composeGuards(...gs: (Guard | undefined)[]): Guard | undefined {
  const xs = gs.filter((g): g is Guard => g !== undefined);
  if (!xs.length) return undefined;
  return (t, i) => {
    const from = (k: number): string | undefined | Promise<string | undefined> => {
      for (let j = k; j < xs.length; j++) {
        const r = xs[j]!(t, i);
        if (r instanceof Promise) return r.then((v) => (v !== undefined ? v : from(j + 1)));
        if (r !== undefined) return r;
      }
      return undefined;
    };
    return from(0);
  };
}

/**
 * `all` → no restriction. `read-only` → read tools + bash + the non-mutating extension tools above.
 * `read-only+files` → also write/edit, but only on card.files (it derives from READ_ONLY, so it keeps them too).
 * Card files resolve against the task's `cwd`; a tool call's path against the child's own cwd (`own`, the caller's).
 */
export function toolsFor(p: Profile, c: Card, cwd: string, own = cwd): { tools?: string[]; toolGuard?: SyncGuard } {
  if (p.tools === "all") return {};
  if (p.tools === "read-only") return { tools: READ_ONLY };
  const abs = (f: string, base = own) => normalize(isAbsolute(f) ? f : join(base, f));
  const allowed = c.files.map((f) => abs(f, cwd));
  return {
    tools: [...READ_ONLY, "edit", "write"],
    toolGuard(tool, input) {
      if (!WRITERS.includes(tool)) return undefined;
      const path = (input as { path?: unknown } | null)?.path;
      if (typeof path === "string" && allowed.includes(abs(path))) return undefined;
      return `${tool} is limited to the files of your task card: ${allowed.join(", ") || "(none)"}. ${typeof path === "string" ? path : "This call has no path"} is not one of them; return a request to your parent instead.`;
    },
  };
}
