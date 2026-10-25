// The selection delta table (spec §8.2, HP T3.4): 96 states of local × cloud running × cloud availability × queue deadline.
// The oracle is the frozen `pickQwen` with the cap of the frozen defaults; the SUT is the production path from the today-config
// settings (`candidates` → `resolveLeg` → `memberState` → `pickMember`, the candidates in the fixture's (cost, order, name) order),
// so a change of the settings mapping or of the selection shows. SUT == oracle except exactly the 22 D4/D5 states below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickQwen as legacyPick } from "./oracle/legacy-chain.ts";
import { defaults as legacyDefaults } from "./oracle/legacy-settings.ts";
import { resolveLeg } from "../core/policy.ts";
import type { Child, PolicyDeps } from "../core/policy.ts";
import { candidates } from "../core/select.ts";
import { parseSettings } from "../core/settings.ts";
import { EFFORTS } from "../core/members.ts";
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

/** The 22 states the selection changes (HP T3.4), with their new result; every other state equals the oracle. */
function delta(local: Local, cr: number, cloud: Cloud, expired: boolean): string | undefined {
  if (cloud === "open") {
    if (local === "up" && cr === 1) return "qwen-cloud";                                  // D4: no interleave
    if ((local === "busy" || local === "down") && cr === 2) return expired ? "sonnet" : "wait"; // D4: no third cloud slot
    return undefined;
  }
  return (local === "busy" || local === "own") && !expired ? "wait" : undefined;           // D5: a busy cheapest pool is waited for
}

class Wait extends Error {}

async function sutPick(local: Local, cloudRunning: number, cloud: Cloud, expired: boolean) {
  const settings = parseSettings(TODAY_RAW).settings;
  const cap = settings.models["qwen-cloud"].dailyCap!;
  const children = new Map<string, Child>();
  const add = (route: string, n: number) => { for (let i = 0; i < n; i++) children.set(`${route}${i}`, { member: `qwen-${route}`, route, at: NOW, reservedUntil: NOW } as Child); };
  add("local", local === "own" ? 1 : 0);
  add("cloud", cloudRunning);
  let now = NOW;
  const d = {
    settings, children, now: () => now, attempts: new Map(),
    api: () => ({ list: () => [...children.keys()].map((name) => ({ name, state: "running" })) }),
    // busy = up with no free slot (a 503 from /slots); the block outlasts the queue deadline the driver jumps past
    probe: async (_url: string) => ({ up: local !== "down", busy: local === "busy" }),
    counter: { today: (m: string) => (m === "qwen-cloud" && cloud === "capped" ? cap : 0), bump() {} },
    blocks: new Map(cloud === "blocked" ? [["qwen-cloud", NOW + 86_400_000]] : []),
    sleep: async (ms: number) => { if (!expired) throw new Wait(); now += ms + settings.queueMaxSec * 1000; },
  } as unknown as PolicyDeps;
  const cands = candidates(settings, "write", 0, 0).cands;
  try {
    const r = await resolveLeg(d, { name: "x", cands, planned: cands[0], step: 0, pinned: false, failover: [], entry: { parent: "p", parentSession: "s" } as any });
    assert.ok(r.ok, JSON.stringify(r));
    const m = r.value.member, running = [...children].filter(([n, c]) => n !== "x" && c.member === m.name).length;
    assert.equal(children.get("x")?.member, m.name); // the pick reserved its slot (T3.5)
    assert.ok(m.slots === undefined || running < m.slots, `P-slots: ${m.name} has ${running} of ${m.slots}`);
    assert.ok(r.value.effort !== "max" && m.efforts.includes(r.value.effort) && EFFORTS.includes(r.value.effort), `P-nomax: ${m.name} ${r.value.effort}`);
    return m.name;
  } catch (e) {
    if (e instanceof Wait) return "wait";
    throw e;
  }
}

test("today-config: the selection's 96 states == oracle except exactly the 22 D4/D5 states; P-slots, P-nomax on every pick", async () => {
  let n = 0, changed = 0;
  const bad: string[] = [];
  for (const local of LOCAL) for (const cr of [0, 1, 2, 3]) for (const cloud of CLOUD) for (const expired of [false, true]) {
    n++;
    const d = delta(local, cr, cloud, expired);
    if (d !== undefined) changed++;
    const want = d ?? oracleName(local, cr, cloud, expired), got = await sutPick(local, cr, cloud, expired);
    if (d !== undefined) assert.notEqual(d, oracleName(local, cr, cloud, expired), `not a delta: ${local} ${cr} ${cloud} ${expired}`);
    if (want !== got) bad.push(`local=${local} cloudRunning=${cr} cloud=${cloud} expired=${expired}: want ${want} got ${got}`);
  }
  assert.equal(n, 96);
  assert.equal(changed, 22);
  assert.deepEqual(bad, []);
});
