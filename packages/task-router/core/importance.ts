// Importance = max of its sources (spec §5.2.5, P-imp); it can only be raised.
import { globMatch } from "./glob.ts";
import type { Importance, ThinkingLevel } from "./types.ts";

const ORDER: Importance[] = ["normal", "high", "critical"];
const max = (levels: Importance[]): Importance =>
  levels.reduce((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a), "normal");
const FROM_EFFORT: Partial<Record<ThinkingLevel, Importance>> = { xhigh: "high", max: "critical" };

export function importanceOf(src: {
  mainEffort?: ThinkingLevel;
  parent?: Importance;
  pathRules: { glob: string; level: Importance }[];
  files: string[];
  card?: Importance;
}): Importance {
  const byPath = src.pathRules.filter((r) => src.files.some((f) => globMatch(r.glob, f))).map((r) => r.level);
  return max([FROM_EFFORT[src.mainEffort as ThinkingLevel] ?? "normal", src.parent ?? "normal", src.card ?? "normal", ...byPath]);
}
