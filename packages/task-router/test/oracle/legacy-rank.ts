// FROZEN ORACLE — copy of core/rank.ts at d79921d, imports rewritten; never edit (spec §8.2; plan T0.3).
// Orders used by the rule and the explicit-model check (plan "Properties" notation).
import type { ThinkingLevel, Tier } from "./legacy-types.ts";

// rank(qwen) = 0 < rank(T1) = 1 < rank(T2) = 2
export const tierRank = (t: Tier): number => ["qwen", "T1", "T2"].indexOf(t);
export const effortRank = (e: ThinkingLevel): number => ["off", "minimal", "low", "medium", "high", "xhigh", "max"].indexOf(e);
