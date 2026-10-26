// The "Task cards" section of the main system prompt (spec §5.2.3): how to call spawn_subagent under the router.
// `cardSchema` is the one source of the field list; rejections embed it too, because a child never sees the section.
import { T0_KEYS, T2_VALUES } from "./card.ts";
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
