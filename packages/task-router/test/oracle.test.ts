// The frozen oracle (spec §8.2, plan T0.3): copies of today's routing files under test/oracle/, byte-pinned.
// A change to any of them is a change of the expectation itself and needs the owner's decision, not a re-pin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const PINNED: Record<string, string> = {
  "legacy-route.ts": "3baedb5dec556df5edd1711df21a8746953facb5460811ad579f211fa56388f1",
  "legacy-plan.ts": "aa602bfdea78915da8642904ed6f3234ac0fe2732a9ab25755b1566e10603eff",
  "legacy-attempts.ts": "db5d806f87197e7ba1ea356722dc3f8d82f095e1efd1bb7101598d182cf9140a",
  "legacy-randomize.ts": "be6438608a1ec6a989953aa62bd64c445b6dad58c73fe7b3ebb2f902ada6a708",
  "legacy-rank.ts": "a71b403da3113bd1e5c25705c48a0157db8fa3d4460ce1fc3fc342b3eea5bbde",
  "legacy-chain.ts": "73ece1a2f272371c6f5467882fd7765006e9bf18b9b84481fd08b0b53823298f",
  "legacy-profile.ts": "422b822992e21844426ad1f8b6fc39837d5e84b132101ffaf9e6bfc6f04b25df",
  "legacy-types.ts": "0d8589ce5e32abc7ccdc3c16deb8133226fd74e6913882eaa3b61fa0d3fe5220",
  "legacy-settings.ts": "1c9f06c9b36239fe35897072a723e9858ad9014d4a945a25a1abfcb4ee7681ff",
};

for (const [file, sha] of Object.entries(PINNED)) {
  test(`oracle ${file} is byte-identical to its pin`, () => {
    const got = createHash("sha256").update(readFileSync(new URL(`./oracle/${file}`, import.meta.url))).digest("hex");
    assert.equal(got, sha, `test/oracle/${file} changed (sha256 ${got}); the oracle is frozen`);
  });
}
