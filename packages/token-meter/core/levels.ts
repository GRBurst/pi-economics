// Pure: the router's levels and models of an outcome line (spec §6.4 "Old → new mapping"). A line from 2026-10-17 on is
// returned as written (the router writes its models and levels itself); an older one (the tier in `workerTier`/`base`, the Qwen
// chain in its reasons, route labels in `from`/`to`) is mapped by the tables in legacy-routes.json (spec D9: router knowledge is
// data, for the lines that cannot change). Readers use this, never the router's requirementOf.
import { readFileSync } from "node:fs";

type Line = Record<string, any>;

export type Levels = {
  ability?: string; level?: number; draft?: true; workerLevel?: number; reviewLevel?: number;
  /** `workerModel`: the model the child started on; `ranModel`: the one it ran on after its last reroute. */
  workerModel?: string; ranModel?: string; startEffort?: string;
  fromLevel?: number; toLevel?: number; fromModel?: string; toModel?: string;
};
/** `spawns` by taskId (an escalate's `attemptOf` names one); `lastReroute`: each task's last reroute line. */
export type LevelsContext = { spawns: Map<string, Line>; lastReroute: Map<string, Line> };

type Legacy = { before: string; models: Record<string, string>; levels: Record<string, Record<string, number>>; chain: Array<{ reason: string; route: string; startEffort?: string }> };
const LEGACY: Legacy = JSON.parse(readFileSync(new URL("./legacy-routes.json", import.meta.url), "utf8"));
/** The lines older than this are mapped through the legacy tables. A line without a readable `ts` is not old: it is read as written. */
const BEFORE = Date.parse(LEGACY.before);
const isOld = (l: Line): boolean => typeof l?.ts === "string" && Date.parse(l.ts) < BEFORE;
const DRAFT = "-draft";

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length ? v : undefined);
const reasonsOf = (l: Line): string[] => (Array.isArray(l.reasons) ? l.reasons.filter((r: unknown): r is string => typeof r === "string") : []);
/** The object without its undefined fields. */
const defined = (o: Levels): Levels => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Levels;
const own = (table: Record<string, any> | undefined, key: string): any => (table && Object.hasOwn(table, key) ? table[key] : undefined);
const levelOf = (ability: string | undefined, label: unknown): number | undefined =>
  ability === undefined || typeof label !== "string" ? undefined : own(own(LEGACY.levels, ability), label);
/** The model behind an old route label; of a line from 2026-10-17 on there is none to read from a label. */
const modelOf = (l: Line, label: unknown): string | undefined => (isOld(l) && typeof label === "string" ? own(LEGACY.models, label) : undefined);

export function levelsOfLine(l: Line, ctx: LevelsContext): Levels {
  if (l?.event === "spawn") return spawnLevels(l, ctx);
  if (l?.event === "escalate") return escalateLevels(l, ctx);
  if (l?.event === "reroute") return defined({ fromModel: str(l.fromModel) ?? modelOf(l, l.from), toModel: str(l.toModel) ?? modelOf(l, l.to) });
  return {};
}

function spawnLevels(l: Line, ctx: LevelsContext): Levels {
  const started = l.kind === "unrouted" && str(l.ability) === undefined ? unrouted(l) : isOld(l) ? old(l) : written(l);
  const r = ctx.lastReroute.get(l.taskId);
  return defined({ ...started, ranModel: r ? str(r.toModel) ?? modelOf(r, r.to) : started.workerModel });
}

const written = (l: Line): Levels => ({
  ability: l.ability, level: l.level, draft: l.draft === true ? true : undefined, workerLevel: l.workerLevel, reviewLevel: l.reviewLevel,
  workerModel: str(l.workerModel), startEffort: str(l.startEffort),
});

/** An unrouted spawn names its model in its own reason, whatever its age. */
function unrouted(l: Line): Levels {
  const m = reasonsOf(l).find((r) => r.startsWith("model "));
  return { workerModel: m?.slice("model ".length), startEffort: str(l.workerEffort) };
}

function old(l: Line): Levels {
  const reasons = reasonsOf(l);
  const ability = l.kind === "scout" || l.kind === "review" ? "read" : "write";
  const base = str(l.base) ?? "", isDraft = base.endsWith(DRAFT);
  const chain = LEGACY.chain.find((c) => reasons.some((r) => r.startsWith(c.reason)));
  return {
    ability, level: levelOf(ability, isDraft ? base.slice(0, -DRAFT.length) : base), draft: ability === "write" && isDraft ? true : undefined,
    workerLevel: levelOf(ability, l.workerTier),
    workerModel: l.workerTier === "qwen" ? own(LEGACY.models, chain?.route ?? "") : modelOf(l, l.workerTier),
    startEffort: l.workerTier === "qwen" && chain?.startEffort !== undefined ? chain.startEffort : str(l.workerEffort),
  };
}

/** An escalate line from 2026-10-17 on is returned as written; an old one has the ability of the failed spawn (`attemptOf`); `"?"` (its route was unknown) → its `workerTier`. */
function escalateLevels(l: Line, ctx: LevelsContext): Levels {
  if (!isOld(l)) {
    return defined({ ability: l.ability, fromLevel: l.fromLevel, toLevel: l.toLevel, fromModel: str(l.fromModel), toModel: str(l.toModel) });
  }
  const failed = typeof l.attemptOf === "string" ? ctx.spawns.get(l.attemptOf) : undefined;
  const ability = failed ? levelsOfLine(failed, ctx).ability : undefined;
  const from = l.from === "?" ? failed?.workerTier : l.from;
  return defined({ ability, fromLevel: levelOf(ability, from), toLevel: levelOf(ability, l.to), fromModel: modelOf(l, l.from), toModel: modelOf(l, l.to) });
}
