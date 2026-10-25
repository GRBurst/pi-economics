// P2 (pi-economics spec §6.1): the free-cloud slot is optional. With it empty, no spawn takes the cloud route, the cloud
// counter stays at 0, and no spawn waits for a cloud slot, whether the local slot is up or down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { accepted, card, harness } from "./harness.ts";
import { defaults } from "../core/settings.ts";

const EMPTY = { models: { "qwen-cloud": { model: "" } } } as any;
const FREE = defaults().models["qwen-cloud"].model;

for (const [name, health] of [["local up", undefined], ["local down", { health: 0, slots: 0 }]] as const) {
  test(`P2, ${name}: an empty free-cloud slot is never routed to, counts nothing and makes no spawn wait`, async () => {
    const h = harness({ settings: EMPTY, ...(health ? { health } : {}) });
    const models: string[] = [];
    for (const n of ["a", "b", "c", "d"]) {
      models.push((accepted(await h.a.spawn({ name: n, task: card() })) as any).model);
      h.a.emit({ type: "turn", name: n, ts: 1 });
    }
    assert.ok(models.every((m) => m !== FREE && m !== ""), models.join());
    const count = join(h.agentDir, "task-router", "cloud-count.json");
    assert.ok(!existsSync(count) || Object.values(JSON.parse(readFileSync(count, "utf8"))).every((v) => v === 0), "cloud counter");
    assert.deepEqual(h.sleeps, []);
  });
}
