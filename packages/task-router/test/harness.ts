// Shared test rig: install() against fake pi + fake actor-subagents API, stub fetch, in-memory fs, manual clock.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../core/shell.ts";
import type { Deps } from "../core/shell.ts";
import { outcomeFile } from "../core/outcome.ts";
import { parseSettings } from "../core/settings.ts";
import type { Card, RouterSettings } from "../core/types.ts";
import { fakeApi } from "./fake-api.ts";
import { fakePi } from "./fake-pi.ts";

/** The settings file that encodes today's routing (spec §5.3): the owner's rollback, and the base of the characterization tests. */
export const TODAY_RAW: Record<string, any> = JSON.parse(readFileSync(new URL("./fixtures/today-config.json", import.meta.url), "utf8"));
const deepMerge = (a: any, b: any): any => {
  if (!(a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b))) return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in a ? deepMerge(a[k], v) : v;
  return out;
};

export const T0_ALL = { bounded: true, specified: true, verifiable: true, lowRisk: true, small: true, linear: true };
export const card = (o: Partial<Card> = {}): Card => ({ kind: "implement", files: ["src/a.ts"], check: "npm test", acceptance: ["tests pass"], t0: T0_ALL, t2: [], ...o });

export type Health = { health: number; slots: number };
export function harness(o: { settings?: Partial<RouterSettings>; base?: "defaults" | "today"; health?: Health; extra?: Partial<Deps>; agentDir?: string } = {}) {
  const agentDir = o.agentDir ?? mkdtempSync(join(tmpdir(), "task-router-h-"));
  const f = fakePi();
  const a = fakeApi();
  const clock = { t: Date.UTC(2026, 9, 2, 12, 0, 0) };
  const health: Health = o.health ?? { health: 200, slots: 200 };
  const urls: string[] = [];
  const fetchStub = async (url: string) => {
    urls.push(url);
    const status = url.includes("/slots") ? health.slots : health.health;
    if (status === 0) throw new Error("ECONNREFUSED");
    return { status } as { status: number };
  };
  const sleeps: number[] = [];
  const hooks: { onSleep?: () => void } = {};
  const router = install(f.pi, {
    agentDir,
    settings: parseSettings(o.base === "today" ? deepMerge(structuredClone(TODAY_RAW), o.settings ?? {}) : (o.settings ?? {})).settings,
    now: () => new Date(clock.t),
    api: () => a.api,
    fetch: fetchStub,
    fs: { exists: (p) => p.startsWith("/work/src/"), size: () => 1000, isDir: (p) => p === "/work" || p.startsWith("/work/src") },
    sleep: async (ms) => { sleeps.push(ms); clock.t += ms; hooks.onSleep?.(); },
    ...o.extra,
  });
  const lines = (): Record<string, any>[] => {
    const file = outcomeFile(agentDir, new Date(clock.t));
    return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  };
  return { agentDir, f, a, clock, health, urls, sleeps, hooks, router, lines };
}

export function accepted(r: Awaited<ReturnType<ReturnType<typeof fakeApi>["spawn"]>>) {
  assert.ok(!("reject" in r), `rejected: ${"reject" in r ? r.reject : ""}`);
  return r;
}

/** Tell the router (via before_agent_start, like pi does) which skills exist. */
export function provideSkills(h: ReturnType<typeof harness>, names: string[]): void {
  const dir = mkdtempSync(join(tmpdir(), "task-router-skills-"));
  writeFileSync(join(dir, "SKILL.md"), "skill body");
  h.f.fire("before_agent_start", { systemPromptOptions: { skills: names.map((name) => ({ name, filePath: join(dir, "SKILL.md"), baseDir: dir })) } }, {});
}
