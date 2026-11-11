// Steer overseer (design §3.1.2, §3.2; plan D31, D32): a persistent trip in the main session runs an overseer of role
// `steer` while its budget has room. Its input is the trip and the last call records (no bodies); its findings reach the
// main session as a steer message. Advisory: one at a time, and a failure sends the fixed escalation instead (D31).
import type { RouterSettings } from "../types.ts";
import { ESCALATION, block } from "./hints.ts";
import { pickMember, verdictSubmit } from "./overseer.ts";
import type { createOverseer } from "./overseer.ts";
import type { CallRecord, Trip } from "./tripwires.ts";
import { findingLine } from "./verdict.ts";
import type { Git } from "./git.ts";

export const STEER_TYPE = "task-router/steer";
/** The call records a steer sees (design §3.1.2). */
export const STEER_RECORDS = 12;
const CMD_CHARS = 200, SIG_CHARS = 120;
/** The bash command a record keeps (D32): its first 200 characters. */
export const cmdOf = (tool: string, input: any): string | undefined =>
  tool === "bash" && typeof input?.command === "string" ? input.command.slice(0, CMD_CHARS) : undefined;

const line = (r: CallRecord, rel: (abs: string) => string): string => {
  const target = r.cmd !== undefined ? JSON.stringify(r.cmd) : r.path !== undefined ? rel(r.path) : `key ${r.key.slice(r.key.indexOf(":") + 1, r.key.indexOf(":") + 9)}`;
  const result = r.isError ? `error ${(r.errSig ?? "").slice(0, SIG_CHARS).trimEnd()}`
    : r.isWrite && r.hashBefore !== undefined && r.hashAfter !== undefined ? `ok, file ${r.hashAfter === r.hashBefore ? "unchanged" : "changed"}` : "ok";
  return `${r.tool} ${target}: ${result}`;
};
/** The active branch's part of the input (design §3.1.2): its goal and check, and the focal diff. A part that is missing is left out. */
export type BranchInfo = { goal?: string; check?: string; diff?: string };
/** The focal diff's length (design §3.1.2). */
export const DIFF_LINES = 80;
const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();
/** D32: the trip and the last `STEER_RECORDS` call records, one line each (tool, path or command, error signature); with a
 *  branch (L5) its goal, its check and the focal diff. */
export function steerInput(trip: Trip, n: number, records: readonly CallRecord[], rel: (abs: string) => string, branch: BranchInfo = {}): string {
  const last = records.slice(-STEER_RECORDS);
  return [`Trip: ${trip} (${n} detections since the last progress).`, `The last ${last.length} calls, oldest first (tool, target, result):`,
    ...last.map((r) => line(r, rel)),
    ...(branch.goal !== undefined ? [`Goal: ${oneLine(branch.goal)}`] : []), ...(branch.check !== undefined ? [`Check: ${oneLine(branch.check)}`] : []),
    ...(branch.diff !== undefined ? [`Diff (≤ ${DIFF_LINES} lines):`, branch.diff === "" ? "(no changes)" : branch.diff] : [])].join("\n");
}
/** D33: the paths a steer finding may name: those the records wrote (as the input shows them) and the branch's changed files. */
export const steerTargets = (records: readonly CallRecord[], changed: readonly { path: string }[], rel: (abs: string) => string): Set<string> =>
  new Set([...records.flatMap((r) => (r.path !== undefined ? [rel(r.path)] : [])), ...changed.map((c) => c.path)]);

export type SteerDeps = {
  settings: RouterSettings; overseer: ReturnType<typeof createOverseer>;
  /** The active branch (worktree, base, goal, check), when there is one: its diff and metadata join the input, and the overseer
   *  reads its worktree by absolute path (LD14: its cwd stays the main session's). */
  branch?(): { worktree: string; base: string; goal?: string; check?: string } | undefined;
  git?: Git;
  /** The steer message to the main session (`pi.sendMessage`, deliverAs "steer"). */
  send(content: string): void;
};
export function createSteer(d: SteerDeps) {
  let running = false;
  return {
    /** `hints.steer` on, the overseer ready (the spawn API and the router's policy, review F1), the steer budget with room, and
     *  no steer running. */
    available(): boolean {
      return d.settings.hints.steer === "on" && !running && d.overseer.ready() && pickMember(d.settings, "steer", d.overseer.budget()) !== "skip";
    },
    /** Runs in the background; the escalation stands in for a failed run (D31). `rel` shows a path as the input and its targets
     *  name it. */
    start(trip: Trip, n: number, records: readonly CallRecord[], cwd: string, rel: (abs: string) => string): void {
      running = true;
      const fail = block(trip, n, ESCALATION);
      void (async () => {
        const b = d.branch?.();
        const [stat, diff] = b && d.git ? await Promise.all([d.git.diffStat(b.worktree, b.base), d.git.diff(b.worktree, b.base, undefined, DIFF_LINES)]) : [[], undefined];
        return d.overseer.run({ role: "steer", input: steerInput(trip, n, records, rel, b ? { goal: b.goal, check: b.check, ...(diff !== undefined && { diff }) } : {}),
          cwd, ...(b && { worktree: b.worktree }), submit: verdictSubmit(steerTargets(records, stat, rel)) });
      })()
        .then((r) => r.ok ? [`[router] steer (${trip}): ${r.value.summary}`, ...r.value.findings.map(findingLine)].join("\n") : fail, () => fail)
        .then((content) => {
          running = false;
          try { d.send(content); } catch { /* advisory: a failed delivery changes nothing */ }
        });
    },
  };
}

