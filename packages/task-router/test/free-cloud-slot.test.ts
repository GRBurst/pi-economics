// P2 (pi-economics spec §6.1): the free-cloud slot is optional. With it empty, no spawn takes the cloud route, the cloud
// counter stays at 0, and no spawn waits for a cloud slot, whether the local slot is up or down. A wait for the local slot is
// allowed (D5, plan T3.4): with local up every spawn ends on local (each waits for the reservation before it, mi11); with local
// down nothing waits. T5.1: on the today fixture with its cloud blanked (the defaults' cloud is empty from T5.4, and Haiku, enabled
// at T5.5, would take the local-down spawns); the defaults' P2 is router-golden's invariance and policy.test.ts's T5.4 cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TODAY_RAW, accepted, card, harness } from "./harness.ts";

const EMPTY = { models: { "qwen-cloud": { model: "" } } } as any;
const FREE = TODAY_RAW.models["qwen-cloud"].model;

const LOCAL = TODAY_RAW.models["qwen-local"].model, SONNET = TODAY_RAW.models.sonnet.model;
for (const [name, health, want] of [["local up", undefined, LOCAL], ["local down", { health: 0, slots: 0 }, SONNET]] as const) {
  test(`P2, ${name}: an empty free-cloud slot is never routed to, counts nothing and no spawn waits for it`, async () => {
    const h = harness({ base: "today", settings: EMPTY, ...(health ? { health } : {}) });
    const models: string[] = [];
    for (const n of ["a", "b", "c", "d"]) {
      models.push((accepted(await h.a.spawn({ name: n, task: card() })) as any).model);
      h.a.emit({ type: "turn", name: n, ts: 1 });
    }
    assert.ok(models.every((m) => m !== FREE && m !== ""), models.join());
    assert.deepEqual(models, [want, want, want, want]);
    const count = join(h.agentDir, "task-router", "member-count.json");
    assert.ok(!existsSync(count) || !Object.values(JSON.parse(readFileSync(count, "utf8"))).some((day: any) => day["qwen-cloud"]), "cloud counter");
    if (health) assert.deepEqual(h.sleeps, []);
  });
}
