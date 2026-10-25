// Members and levels (spec §4.1, §4.2). Pure.
import type { Ability, Member, ThinkingLevel } from "./types.ts";

export const EFFORTS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export const effortRank = (e: ThinkingLevel): number => EFFORTS.indexOf(e);
export type Named = Member & { name: string };
type Models = Record<string, Member>;

const byOrder = (a: Named, b: Named): number =>
  a.cost - b.cost || (a.order ?? 0) - (b.order ?? 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
/** Members with a model, ordered by (cost, order, name). */
export const enabled = (ms: Models): Named[] =>
  Object.entries(ms).filter(([, m]) => m.model !== "").map(([name, m]) => ({ ...m, name })).sort(byOrder);
export const named = (ms: Models, name: string): Named | undefined => (ms[name] ? { ...ms[name], name } : undefined);
export const lvl = (m: Member | undefined, a: Ability): number => m?.abilities[a] ?? -1;
export const levels = (ms: Models, a: Ability): number[] =>
  [...new Set(enabled(ms).filter((m) => m.abilities[a] !== undefined).map((m) => m.abilities[a]))].sort((x, y) => x - y);
export const bottom = (ms: Models, a: Ability): number => levels(ms, a)[0];
export const top = (ms: Models, a: Ability): number => levels(ms, a).at(-1)!;
export const next = (ms: Models, a: Ability, l: number): number => levels(ms, a).find((x) => x > l) ?? l;
export const meeting = (ms: Models, a: Ability, level: number): Named[] => enabled(ms).filter((m) => lvl(m, a) >= level);
/** Planned member ignoring context and runtime: review leg, requirement label (spec §4.1, mi5, mi8). */
export const firstMeeting = (ms: Models, a: Ability, level: number): Named | undefined => meeting(ms, a, level)[0];
export const effortAt = (m: Member, step: number): ThinkingLevel => m.efforts[Math.min(step, m.efforts.length - 1)];
/** Highest ladder index whose effort ≤ e; −1 below the first step (spec §4.7). */
export function stepOf(m: Member, e: ThinkingLevel): number {
  let i = -1;
  m.efforts.forEach((f, j) => { if (effortRank(f) <= effortRank(e)) i = j; });
  return i;
}
export const byModel = (ms: Models, model: string): Named | undefined => enabled(ms).find((m) => m.model === model);
export const providerOf = (m: Member): string => m.provider ?? m.model.split("/")[0];
export const sameLadder = (x: Member, y: Member): boolean => x.efforts.join() === y.efforts.join();
/** The route labels the M1 runtime knows (chain, failover, guards; T3.4 frees them): a member with another route is not loaded. */
export const ROUTES = ["local", "cloud", "T1", "T2", "haiku"] as const;
export type Route = (typeof ROUTES)[number];
export const isRoute = (r: unknown): r is Route => (ROUTES as readonly unknown[]).includes(r);
/** M1–M2 bridge (deleted in T3.4): the enabled member behind a legacy route label (local, cloud, T1, T2); a blank member has none. */
export const routeMember = (ms: Models, route: string): Named | undefined => enabled(ms).find((m) => m.route === route);
