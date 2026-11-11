// The "Task cards" section of the main system prompt (spec §5.2.3): how to call spawn_subagent under the router.
// `cardSchema` is the one source of the field list; rejections embed it too, because a child never sees the section.
import { T0_KEYS, T2_VALUES } from "./card.ts";
import type { Active } from "./local/mode.ts";
import { BUILTIN_PROFILES } from "./profile.ts";
import type { RouterSettings } from "./types.ts";

export const CARD_FIELDS = ["kind", "files", "check", "acceptance", "t0", "t2", "importance", "attemptOf", "skills", "cwd", "reviewOf"];

/** Compact card schema: kinds (built-in and settings profiles; `lookup` glossed, spec §4.3, D13), fields, t0 keys, t2 values. */
export function cardSchema(s: RouterSettings): string {
  const kinds = [...new Set([...Object.keys(BUILTIN_PROFILES), ...Object.keys(s.profiles)])].join(", ");
  return `- kind: ${kinds}; lookup: the narrow scout, a question with a short, checkable answer
- files: the files the task touches; check: command that proves it; acceptance: what must hold afterwards
- t0: ${T0_KEYS.join(", ")}, each true only if you are sure; code verifies and can only lower them
- t2: triggers that force the top level: ${T2_VALUES.join(", ")}; [] if none
- importance: "high" | "critical" (optional); attemptOf: the name of a failed child (optional, escalates one level above the model it ran on); skills: extra skill names (optional)
- cwd: absolute or ~/ directory that files and check are relative to (optional, default your cwd); reviewOf: the task id a spot-check review card reviews (optional)`;
}

/** Rejection text for a card that is missing or malformed: self-contained, since the caller may be a child without the section. */
export function cardRejection(s: RouterSettings, problem: string): string {
  return `${problem} Pass a task card in \`task\` (spawn_subagent), a JSON object with fields:\n${cardSchema(s)}`;
}

/** The orchestrator rule (T8.9, experiments factor `delegationRule`): the target architecture in two sentences; the main session's section only. */
export const ORCHESTRATOR_RULE =
  "You are the orchestrator: plan, split the work into task cards, delegate implementation and research, then integrate and review. Work inline only for small fixes or when the handoff would cost more than the work.";

/** `withRule`: put the orchestrator rule first; off leaves the section exactly as it was. */
export function cardSection(s: RouterSettings, withRule = false): string {
  const example = {
    kind: "implement", files: ["src/parse.ts"], check: "npm test -- parse", acceptance: ["parse() rejects empty input"],
    t0: Object.fromEntries(T0_KEYS.map((k) => [k, true])), t2: [],
  };
  return `## Task cards

${withRule ? `${ORCHESTRATOR_RULE}\n\n` : ""}Every spawn_subagent call needs a task card in \`task\`; the router picks model and effort from it (do not set them). Fields:
${cardSchema(s)}

\`\`\`json
${JSON.stringify(example, null, 2)}
\`\`\`

A rejected card comes back with the reason. Passing model/thinkingLevel is only accepted at or above the routed level; an explicit model waits for its own slot and is never replaced by another.`;
}

/** The local section's example card: a debug-design card, the kind a local main hands off (design §2.3). One line. */
const LOCAL_EXAMPLE = {
  kind: "debug-design", files: ["src/a.ts"], check: "npm test -- a", acceptance: ["a() handles empty input"],
  t0: Object.fromEntries(T0_KEYS.map((k) => [k, true])), t2: [],
};
/** The branch and gate lines by the active set (design §2.3, plan S25, Q17: pinned): both, worktrees only, the merge gate only. */
const BRANCH_FULL = `Code changes happen on branches: start_branch, then edit and commit in its worktree (absolute paths),
then request_merge. You cannot merge, push or commit to a main branch; the router blocks it.`;
const BRANCH_ONLY = "Code changes happen on branches: start_branch, then edit and commit in its worktree (absolute paths).";
const GATE_ONLY = "Merge into a main branch only with request_merge. You cannot merge, push or commit to a main branch; the router blocks it.";
/** The plans line (design §2.3, plan S25: pinned), after the branch line while plans are active. */
const PLANS = `A request that needs more than one branch starts with plan_request. Follow the plan file, tick only your
task's checkbox, and change the plan only with amend_plan.`;
const branchLines = (a: Active): string =>
  [a.worktrees && a.mergeGate ? BRANCH_FULL : a.worktrees ? BRANCH_ONLY : a.mergeGate ? GATE_ONLY : undefined, a.plans ? PLANS : undefined]
    .filter((l) => l !== undefined).map((l) => `${l}\n`).join("");
/** The main session's section in local mode (design §2.3, LD3; text pinned by test/local-prompt.test.ts, AC-R3): rules, field
 *  names and one example, no strategy prose, no per-turn values (cache-stable). The branch and plan lines arrive with their
 *  components (L5, L6, L7; plan D4) and follow `active` (the default: none); they sit after the sentence about the child's report. */
export function localSection(s: RouterSettings, active: Active = { worktrees: false, mergeGate: false, plans: false }): string {
  return `## Local mode

You do most of the work yourself. Spawn a subagent only when a task needs more ability than yours
(design, security, concurrency, an unknown root cause) or when a <router-hint> says so. After spawning,
end your turn; the child's report wakes you.
${branchLines(active)}<router-hint> notes report what the router measured. Act on them.

Task card (spawn_subagent \`task\`; do not set model or thinkingLevel):
${cardSchema(s)}
${JSON.stringify(LOCAL_EXAMPLE)}`;
}
