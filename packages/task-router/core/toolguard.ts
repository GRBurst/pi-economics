// Profile tools → spawn-policy `tools` allowlist and `toolGuard` (spec §5.2.3, T5.17).
import { isAbsolute, join, normalize } from "node:path";
import type { Card, Profile } from "./types.ts";

const READ_ONLY = ["read", "grep", "find", "ls", "bash"];
const WRITERS = ["write", "edit"];

/**
 * `all` → no restriction. `read-only` → read tools + bash. `read-only+files` → also write/edit, but only on card.files.
 * Card files resolve against the task's `cwd`; a tool call's path against the child's own cwd (`own`, the caller's).
 */
export function toolsFor(p: Profile, c: Card, cwd: string, own = cwd): { tools?: string[]; toolGuard?: (tool: string, input: unknown) => string | undefined } {
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
