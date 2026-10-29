// Pure: the router's levels and models of an outcome line (spec §6.4 "Old → new mapping"). A line that carries the
// router's 2026-10-17 fields is returned as written; an older one (the tier in `workerTier`/`base`, the Qwen chain in its
// reasons, route labels in `from`/`to`) is mapped by the spec's tables. Readers use this, never the router's requirementOf.
type Line = Record<string, any>;

export type Levels = {
  ability?: string; level?: number; draft?: true; workerLevel?: number; reviewLevel?: number;
  /** `workerModel`: the model the child started on; `ranModel`: the one it ran on after its last reroute. */
  workerModel?: string; ranModel?: string; startEffort?: string;
  fromLevel?: number; toLevel?: number; fromModel?: string; toModel?: string;
};
/** `spawns` by taskId (an escalate's `attemptOf` names one); `lastReroute`: each task's last reroute line. */
export type LevelsContext = { spawns: Map<string, Line>; lastReroute: Map<string, Line> };

const LOCAL = "llama/qwen3.8", FREE = "openrouter/qwen/qwen3.8-27b:free";
const SONNET = "anthropic/claude-sonnet-5-5", OPUS = "anthropic/claude-opus-5-5";
/** The models behind the old route labels and tiers (the router's members before 2026-10-17). */
const MODEL_OF = new Map([["local", LOCAL], ["cloud", FREE], ["T1", SONNET], ["T2", OPUS]]);
/** The old route labels and tiers on each ability's scale. */
const LEVEL_OF: Record<string, Map<string, number>> = {
  write: new Map([["local", 0], ["cloud", 0], ["qwen", 0], ["T1", 1], ["T2", 2]]),
  read: new Map([["local", 0], ["cloud", 0], ["qwen", 0], ["T1", 2], ["T2", 3]]),
};
const DRAFT = "-draft";
const CHAIN_MODEL: [string, string][] = [["qwen chain: local", LOCAL], ["qwen chain: cloud", FREE], ["qwen chain → Sonnet:", SONNET]];
const FALLBACK_EFFORT = "high"; // a chain → Sonnet child started at Sonnet's first step

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length ? v : undefined);
const reasonsOf = (l: Line): string[] => (Array.isArray(l.reasons) ? l.reasons.filter((r: unknown): r is string => typeof r === "string") : []);
/** The object without its undefined fields. */
const defined = (o: Levels): Levels => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Levels;
const levelOf = (ability: string | undefined, label: unknown): number | undefined =>
  ability === undefined || typeof label !== "string" ? undefined : LEVEL_OF[ability]?.get(label);
const modelOf = (label: unknown): string | undefined => (typeof label === "string" ? MODEL_OF.get(label) : undefined);

export function levelsOfLine(l: Line, ctx: LevelsContext): Levels {
  if (l?.event === "spawn") return spawnLevels(l, ctx);
  if (l?.event === "escalate") return escalateLevels(l, ctx);
  if (l?.event === "reroute") return defined({ fromModel: str(l.fromModel) ?? modelOf(l.from), toModel: str(l.toModel) ?? modelOf(l.to) });
  return {};
}

function spawnLevels(l: Line, ctx: LevelsContext): Levels {
  const started = str(l.ability) !== undefined ? written(l) : old(l);
  const r = ctx.lastReroute.get(l.taskId);
  return defined({ ...started, ranModel: r ? str(r.toModel) ?? modelOf(r.to) : started.workerModel });
}

const written = (l: Line): Levels => ({
  ability: l.ability, level: l.level, draft: l.draft === true ? true : undefined, workerLevel: l.workerLevel, reviewLevel: l.reviewLevel,
  workerModel: str(l.workerModel), startEffort: str(l.startEffort),
});

function old(l: Line): Levels {
  const reasons = reasonsOf(l);
  if (l.kind === "unrouted") {
    const m = reasons.find((r) => r.startsWith("model "));
    return { workerModel: m?.slice("model ".length), startEffort: str(l.workerEffort) };
  }
  const ability = l.kind === "scout" || l.kind === "review" ? "read" : "write";
  const base = str(l.base) ?? "", isDraft = base.endsWith(DRAFT);
  const chain = CHAIN_MODEL.find(([prefix]) => reasons.some((r) => r.startsWith(prefix)))?.[1];
  return {
    ability, level: levelOf(ability, isDraft ? base.slice(0, -DRAFT.length) : base), draft: ability === "write" && isDraft ? true : undefined,
    workerLevel: levelOf(ability, l.workerTier),
    workerModel: l.workerTier === "qwen" ? chain : modelOf(l.workerTier),
    startEffort: l.workerTier === "qwen" && chain === SONNET ? FALLBACK_EFFORT : str(l.workerEffort),
  };
}

/** An old escalate line: the ability of the failed spawn (`attemptOf`); `"?"` (its route was unknown) → its `workerTier`. */
function escalateLevels(l: Line, ctx: LevelsContext): Levels {
  if (str(l.ability) !== undefined) {
    return defined({ ability: l.ability, fromLevel: l.fromLevel, toLevel: l.toLevel, fromModel: str(l.fromModel), toModel: str(l.toModel) });
  }
  const failed = typeof l.attemptOf === "string" ? ctx.spawns.get(l.attemptOf) : undefined;
  const ability = failed ? levelsOfLine(failed, ctx).ability : undefined;
  const from = l.from === "?" ? failed?.workerTier : l.from;
  return defined({ ability, fromLevel: levelOf(ability, from), toLevel: levelOf(ability, l.to), fromModel: modelOf(l.from), toModel: modelOf(l.to) });
}
