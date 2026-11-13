import { test } from "node:test";
import assert from "node:assert/strict";
import { billingOf, parsePlans } from "../core/plans.ts";

const plans = parsePlans({
  "p-sub": { billing: "subscription", windows: ["5h", "7d"] },
  "p-local": { billing: "local", windows: [], rate: { amount: 0.13, currency: "EUR", per: "hour" } },
});

test("billingOf: the plan's class; an unknown provider counts as api", () => {
  assert.equal(billingOf(plans, "p-sub"), "subscription");
  assert.equal(billingOf(plans, "p-local"), "local");
  assert.equal(billingOf(plans, "p-other"), "api");
  assert.equal(billingOf({}, "p-sub"), "api");
  assert.equal(billingOf(plans, "toString"), "api", "an inherited property is no plan");
});

test("parsePlans: well-formed plans as written (the Nix module's rendering)", () => {
  assert.deepEqual(plans, {
    "p-sub": { billing: "subscription", windows: ["5h", "7d"] },
    "p-local": { billing: "local", windows: [], rate: { amount: 0.13, currency: "EUR", per: "hour" } },
  });
});

test("parsePlans: tolerant — a plan without a known billing class is dropped, malformed parts are left out", () => {
  assert.deepEqual(parsePlans({
    "no-billing": { windows: ["5h"] },
    "bad-billing": { billing: "prepaid" },
    "not-an-object": "local",
    "p-free": { billing: "free" },
    "p-sub": { billing: "subscription", windows: ["5h", "1d", 7] },
    "bad-rate": { billing: "local", rate: { amount: -1, currency: "EUR" } },
    "bad-currency": { billing: "local", rate: { amount: 1, currency: "eur" } },
    "rate-not-local": { billing: "api", rate: { amount: 1, currency: "USD" } },
    "per-default": { billing: "local", rate: { amount: 2, currency: "USD" } },
  }), {
    "p-free": { billing: "free", windows: [] },
    "p-sub": { billing: "subscription", windows: ["5h"] },
    "bad-rate": { billing: "local", windows: [] },
    "bad-currency": { billing: "local", windows: [] },
    "rate-not-local": { billing: "api", windows: [] },
    "per-default": { billing: "local", windows: [], rate: { amount: 2, currency: "USD", per: "hour" } },
  });
  for (const raw of [undefined, null, 1, "x", [], [{ billing: "api" }]]) assert.deepEqual(parsePlans(raw), {});
});

// M4 review M3: one meaning of "plans absent" for the Budget and the Experiments sections.
test("plansAbsent: no usable plan entry — undefined, {} and a parse that dropped every entry are absent; one entry is not", async () => {
  const { plansAbsent } = await import("../core/plans.ts");
  assert.equal(plansAbsent(undefined), true);
  assert.equal(plansAbsent({}), true);
  assert.equal(plansAbsent(parsePlans({ x: { windows: ["5h"] } })), true);
  assert.equal(plansAbsent(parsePlans({ x: { billing: "api" } })), false);
});
