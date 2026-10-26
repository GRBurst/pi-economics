// Text the router appends to the child's first message (spec §5.2.3, §5.2.5). Agent-facing wording is pinned by tests.
import type { Card, Plan, Profile } from "./types.ts";

const GATE =
  "Skill approval gates: your parent stands in for the human. Return open questions to your parent and stop; do not wait for the human.";
const REPORT = {
  default: undefined,
  answer: "Report: the answer first, then the supporting file paths with line numbers.",
  plan: "Report: the plan file path, the open questions, and a summary of ≤ 300 words.",
  review: "Report: findings by severity, each with file path and line, then a verdict: accept or reject.",
};

/**
 * `skills` is the already rendered `<skill>` blocks (skillBlocks); empty for profiles without skills.
 * `handoff` is the delegation lever: off → no "start immediately" line, the child does its handshake.
 */
export function briefAppend(c: Card, p: Plan, complete: boolean, profile: Profile, skills = "", handoff = true): string {
  const lines: string[] = [];
  if (complete && handoff) lines.push("Start immediately; no understanding/questions reply.");
  if (profile.tools === "read-only") lines.push("Read-only task: do not modify any file.");
  if (profile.tools === "read-only+files") lines.push(`Read-only task except these files, which you may write: ${c.files.join(", ")}.`);
  lines.push("Report in ≤ 300 words plus file paths; put details in a file.");
  const kind = REPORT[profile.report];
  if (kind) lines.push(kind);
  if (p.review) {
    lines.push(
      `Review required: a fresh ${p.review.tier} (${p.review.model}) ${p.review.effort} agent reviews your diff and report before your parent accepts it. List the changed files, the check command and its result.`,
    );
  }
  return [skills && `${skills}\n\n${GATE}`, lines.join("\n")].filter(Boolean).join("\n\n");
}
