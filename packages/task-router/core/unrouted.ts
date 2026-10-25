// routing=false (bench arms without routing, or a user switch): no decision is taken, but the spawn is still
// written to the outcome log so verdicts and $ per task exist for every arm. The card is a stand-in.
import type { AgentInfo } from "./api.ts";
import { byModel } from "./members.ts";
import type { Card, LoggedPlan, RouterSettings } from "./types.ts";

export const UNROUTED_CARD: Card = {
  kind: "unrouted", files: [], acceptance: [], t2: [],
  t0: { bounded: false, specified: false, verifiable: false, lowRisk: false, small: false, linear: false },
};

/** The tier a model belongs to when it is one of the router's models, else the model name itself. */
const tierOf = (model: string, s: RouterSettings): string => byModel(s.models, model)?.tier ?? model;

export function unroutedPlan(a: Pick<AgentInfo, "model" | "thinkingLevel">, s: RouterSettings): LoggedPlan {
  return {
    worker: { tier: tierOf(a.model, s), effort: a.thinkingLevel ?? "medium" },
    base: "T1", importance: "normal", reasons: ["routing off", `model ${a.model}`],
  };
}
