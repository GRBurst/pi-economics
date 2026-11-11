// The git guard as a tool guard (design §3.4.5, §2.2 item 3; plan D44): the composed `toolGuard` of every routed child (and the
// fixer) and the main session's `tool_call` hook use it. A `bash` or `powershell` call is classified in `cwd`, the session's
// directory; every other tool passes at once.
import type { Guard } from "../toolguard.ts";
import type { Git } from "./git.ts";
import { guardGit, hasGitToken, UNCLASSIFIED } from "./gitcmd.ts";

const SHELLS = new Set(["bash", "powershell"]);
/** `mains`: the merge gate's main branches; `branchOf`: the git port's (its 2 s timeout answers "unknown"). Total: a failure on a
 *  command with a git token blocks it (LD8). */
export const gitGuard = (mains: readonly string[], branchOf: Git["branchOf"], cwd: string): Guard => (tool, input) => {
  const cmd = (input as { command?: unknown } | null | undefined)?.command;
  if (!SHELLS.has(tool) || typeof cmd !== "string") return undefined;
  try {
    const r = guardGit(cmd, cwd, mains, branchOf);
    return r instanceof Promise ? r.catch(() => UNCLASSIFIED) : r;
  } catch { return hasGitToken(cmd) ? UNCLASSIFIED : undefined; }
};
