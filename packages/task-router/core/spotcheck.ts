// Spot-check reviews (T5.22): a share of the accepted tasks gets a fresh `review` card, so analysis
// can measure how often an accepted result survives an independent review. Pure.
import type { Card, RouterSettings } from "./types.ts";

/** Only an accepted, routed task that is not itself a review; rng() < share. */
export function spotCheckDue(c: Card | undefined, verdict: string, s: RouterSettings["spotCheck"], rng: () => number): boolean {
  if (!c || verdict !== "accepted" || c.kind === "review" || c.reviewOf !== undefined || !s.enabled) return false;
  return rng() < s.share;
}

/** The instruction appended to the task_verdict result (the caller is the parent that accepted). */
export const spotCheckText = (taskId: string): string =>
  `Spot check: spawn a fresh \`review\` card with \`reviewOf: "${taskId}"\` for this task's diff/report before moving on.`;
