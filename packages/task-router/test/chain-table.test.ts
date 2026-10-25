// The Qwen-chain state table (spec §8.2, "selection delta table", M0 half): 96 states of
// local × cloud running × cloud availability × queue deadline. The oracle is the frozen `pickQwen` with the cap of the frozen
// defaults; the SUT is the production path from the today-config settings (`resolveLeg`: settings → members → chain state),
// so a change of the settings mapping or of the chain shows. From T3.4 the same table runs against `pickMember` and lists
// the 22 D4/D5 states that change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickQwen as legacyPick } from "./oracle/legacy-chain.ts";
import { defaults as legacyDefaults } from "./oracle/legacy-settings.ts";
import { resolveLeg } from "../core/policy.ts";
import type { Child, PolicyDeps } from "../core/policy.ts";
import { parseSettings } from "../core/settings.ts";
import { TODAY_RAW } from "./harness.ts";

const NOW = 1_000_000;
const LOCAL = ["up", "busy", "own", "down"] as const;
const CLOUD = ["open", "blocked", "capped"] as const;
type Local = (typeof LOCAL)[number];
type Cloud = (typeof CLOUD)[number];

/** Today's pick as a name: qwen-cloud | qwen-local | sonnet | wait (a wait past the deadline falls to Sonnet, policy.ts). */
function oracleName(local: Local, cloudRunning: number, cloud: Cloud, expired: boolean): string {
  const cap = legacyDefaults().cloudDailyCap;
  const p = legacyPick({
    localRunning: local === "own" ? 1 : 0, cloudRunning, localAvailable: local === "up" || local === "own",
    cloudToday: cloud === "capped" ? cap : 0, cloudDailyCap: cap, cloudBlockedUntil: cloud === "blocked" ? NOW + 1 : undefined, now: NOW,
  });
  if (p.route === "wait") return expired ? "sonnet" : "wait";
  return p.route === "cloud" ? "qwen-cloud" : p.route === "local" ? "qwen-local" : "sonnet";
}

class Wait extends Error {}

async function sutName(local: Local, cloudRunning: number, cloud: Cloud, expired: boolean): Promise<string> {
  const settings = parseSettings(TODAY_RAW).settings;
  const cap = settings.models["qwen-cloud"].dailyCap!;
  const children = new Map<string, Child>();
  const add = (route: Child["route"], n: number) => { for (let i = 0; i < n; i++) children.set(`${route}${i}`, { route, at: NOW } as Child); };
  add("local", local === "own" ? 1 : 0);
  add("cloud", cloudRunning);
  let now = NOW;
  const d = {
    settings, children, now: () => now,
    api: () => ({ list: () => [...children.keys()].map((name) => ({ name, state: "running" })) }),
    probe: async () => ({ up: local === "up" || local === "own", busy: local === "busy" }),
    cloud: { today: () => (cloud === "capped" ? cap : 0), blockedUntil: () => (cloud === "blocked" ? NOW + 1 : undefined), block() {} },
    sleep: async (ms: number) => { if (!expired) throw new Wait(); now += ms + settings.queueMaxSec * 1000; },
  } as unknown as PolicyDeps;
  try {
    const r = await resolveLeg(d, { tier: "qwen", effort: "xhigh" });
    return r.route === "cloud" ? "qwen-cloud" : r.route === "local" ? "qwen-local" : "sonnet";
  } catch (e) {
    if (e instanceof Wait) return "wait";
    throw e;
  }
}

test("today-config: the Qwen chain's 96 states, through resolveLeg, == oracle", async () => {
  let n = 0;
  const bad: string[] = [];
  for (const local of LOCAL) for (const cr of [0, 1, 2, 3]) for (const cloud of CLOUD) for (const expired of [false, true]) {
    n++;
    const want = oracleName(local, cr, cloud, expired), got = await sutName(local, cr, cloud, expired);
    if (want !== got) bad.push(`local=${local} cloudRunning=${cr} cloud=${cloud} expired=${expired}: want ${want} got ${got}`);
  }
  assert.equal(n, 96);
  assert.deepEqual(bad, []);
});
