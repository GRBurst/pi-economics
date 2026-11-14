// The add-on catalogue (addons/catalogue.json): the one list of what the engine can set that the Nix module reads for
// its assertions (modules/experiments.nix: a factor's lever must exist, its levels must be ones pi accepts). The package
// registers the levers and pi's thinking levels in code; this test holds the two equal, so a new add-on that forgets
// the catalogue fails here, not at a user's evaluation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { allAddons } from "../addons/index.ts";
import { THINKING_LEVELS } from "../addons/pi.ts";
import { PROCESS_SETTINGS } from "../core/process-levers.ts";
import { fakePi } from "./fake.ts";

const catalogue = JSON.parse(readFileSync(new URL("../addons/catalogue.json", import.meta.url), "utf8"));
const deps = { icRules: () => ({ overrides: {} }), settings: () => ({ global: {}, project: undefined }) };

test("T7c.0 the catalogue lists exactly the online levers the engine registers by id, and pi's thinking levels", () => {
  const { levers } = allAddons(fakePi().pi, deps);
  // The bench writes pi.compaction.* into a run's settings before pi starts (Q6): registered for the read-back, not online levers.
  const online = levers.map((l) => l.id).filter((id) => PROCESS_SETTINGS[id] === undefined);
  assert.deepEqual(catalogue.levers, online, "same ids, in registration order");
  assert.ok(levers.length > online.length, "the process levers are registered");
  assert.deepEqual(catalogue.thinkingLevels, [...THINKING_LEVELS]);
  assert.deepEqual(Object.keys(catalogue).sort(), ["kinds", "levers", "thinkingLevels"]);
});

test("F5 the catalogue lists the data-only kinds the engine registers, by name and arity; a name with that many arguments resolves, one more or fewer does not", () => {
  const { kinds } = allAddons(fakePi().pi, deps);
  const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  assert.deepEqual([...catalogue.kinds].sort(byName), kinds.map(({ name, arity }) => ({ name, arity })).sort(byName));
  for (const k of kinds) {
    const id = (n: number) => `${k.name}(${Array.from({ length: n }, (_, i) => `a${i}`).join(",")})`;
    assert.equal(k.make(id(k.arity))?.id, id(k.arity), k.name);
    assert.equal(k.make(id(k.arity + 1)), undefined, `${k.name}: one more argument`);
    assert.equal(k.make(id(k.arity - 1)), undefined, `${k.name}: one fewer`);
  }
});
