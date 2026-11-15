// The infinite-context add-on, pure parts (redesign §7.4, M7a): the limit table (the module's top level and `modelOverrides`,
// resolved as upstream's extension resolves them), the level → token mapping and the lever's feasibility. The engine driving
// it is in ic-seed.test.ts; the equivalence with the extension's own code is the ic-seed-contract check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { IC_DEFAULT_NUDGE, IC_ENTRY, infiniteContext, limitFor, modelKey, parseIcRules, tokensAt, type IcRules } from "../addons/infinite-context.ts";

const haiku = { provider: "anthropic", id: "claude-haiku-5-5" };
const opus = { provider: "anthropic", id: "claude-opus-5-5" };
const gpt = { provider: "openai", id: "gpt-5" };

test("T7a.1 limitFor: the exact provider/id key of modelOverrides, else the top level, else upstream's default", () => {
  const modelOverrides = { "anthropic/claude-opus-5-5": { nudgeAtTokens: 400_000 }, "anthropic/claude-haiku-5-5": { nudgeAtTokens: [100_000, 200_000] as const }, anthropic: { nudgeAtTokens: 5 } };
  const l = (top: number | undefined, model?: { provider?: string; id?: string }) => limitFor({ ...(top === undefined ? {} : { top }), modelOverrides }, modelKey(model));
  assert.equal(l(120_000, opus), 400_000);
  assert.deepEqual(l(120_000, haiku), [100_000, 200_000]);
  assert.equal(l(120_000, gpt), 120_000);
  assert.equal(l(undefined, gpt), IC_DEFAULT_NUDGE);
  assert.equal(l(120_000, { provider: "anthropic", id: "claude-sonnet-5-5" }), 120_000, "a key without '/' (a provider) matches no model");
  assert.equal(l(120_000, { provider: "anthropic" }), 120_000, "a provider without an id: no model key");
  assert.equal(l(120_000, { id: "claude-opus-5-5" }), 120_000, "an id without a provider: no model key");
  assert.equal(l(120_000), 120_000, "no model: the top level");
  // Own keys only: an inherited property name is no override.
  assert.equal(limitFor({ top: 120_000, modelOverrides: {} }, "constructor"), 120_000);
  assert.equal(limitFor({ modelOverrides: {} }, "__proto__"), IC_DEFAULT_NUDGE);
  // The model's key as upstream's index.ts builds it.
  assert.equal(modelKey(opus), "anthropic/claude-opus-5-5");
  assert.equal(modelKey({ provider: "openrouter", id: "anthropic/claude-opus-5-5" }), "openrouter/anthropic/claude-opus-5-5");
  assert.equal(modelKey({ provider: "", id: "" }), "/");
  assert.equal(modelKey(undefined), undefined);
});

test("T7a.1 parseIcRules: the extension's fail-open parse of nudgeAtTokens — an invalid field is left out, so it inherits", () => {
  const parse = (x: unknown) => parseIcRules(JSON.stringify(x));
  assert.deepEqual(parse({ nudgeAtTokens: [100_000, 300_000], modelOverrides: { "a/x": { nudgeAtTokens: 5 }, "b/c": { nudgeAtTokens: [1, 2], nudgeAtPercent: 50 } } }), {
    top: [100_000, 300_000],
    modelOverrides: { "a/x": { nudgeAtTokens: 5 }, "b/c": { nudgeAtTokens: [1, 2] } },
  });
  // The former patch's key `overrides` is none of upstream's: ignored.
  assert.deepEqual(parse({ overrides: { "a/x": { nudgeAtTokens: 5 } } }), { modelOverrides: {} });
  // An override that sets no valid nudgeAtTokens does not exist for this lever (nudgeAtPercent alone, or an invalid value).
  const bad = [0, -1, 1.5, "x", null, true, [], [5], [5, 5], [6, 5], [1, 2, 3], [0, 9], [1.5, 3], ["1", 2], {}];
  for (const b of bad) {
    assert.deepEqual(parse({ nudgeAtTokens: b, modelOverrides: { "a/x": { nudgeAtTokens: b } } }), { modelOverrides: {} }, JSON.stringify(b));
  }
  assert.deepEqual(parse({ modelOverrides: { "a/x": { nudgeAtPercent: 50 }, "b/x": null, "c/x": [], "d/x": 3 } }), { modelOverrides: {} });
  for (const junk of [null, [], 3, "x", true, { modelOverrides: null }, { modelOverrides: [] }, { modelOverrides: 3 }]) assert.deepEqual(parse(junk), { modelOverrides: {} }, JSON.stringify(junk));
  assert.deepEqual(parseIcRules("not json"), { modelOverrides: {} });
  assert.deepEqual(parseIcRules(undefined), { modelOverrides: {} }, "no file");
});

test("T7a.2 property: ∀ range, ∀ q ∈ [0,1]: min ≤ tokensAt(range, q) ≤ max, a whole number, monotone in q, the ends reached", () => {
  const ranges: Array<readonly [number, number]> = [[100_000, 300_000], [1, 2], [100, 103], [150_000, 150_001], [99_991, 200_017], [1, 1_000_000_007]];
  const qs = [0, 0.001, 0.25, 1 / 3, 0.5, 0.75, 0.999, 1];
  for (const r of ranges) {
    let prev = -Infinity;
    for (const q of qs) {
      const v = tokensAt(r, q);
      assert.ok(Number.isInteger(v), `${r} ${q}`);
      assert.ok(v >= r[0] && v <= r[1], `${r} ${q} → ${v}`);
      assert.ok(v >= prev, `monotone ${r} ${q}`);
      prev = v;
    }
    assert.equal(tokensAt(r, 0), r[0]);
    assert.equal(tokensAt(r, 1), r[1]);
  }
  assert.equal(tokensAt([100_000, 300_000], 0.25), 150_000);
  assert.equal(tokensAt([100_000, 300_000], 0.75), 250_000);
  assert.equal(tokensAt([100, 103], 0.5), 102, "round half up: 101.5 → 102");
});

const rules = (x: unknown): IcRules => parseIcRules(JSON.stringify(x));
const FILE = { nudgeAtTokens: 120_000, modelOverrides: { "anthropic/claude-haiku-5-5": { nudgeAtTokens: [100_000, 200_000] }, "anthropic/claude-opus-5-5": { nudgeAtTokens: 400_000 } } };

test("T7a.2 the lever: infinite-context's, a session seed, read back before the first agent start", () => {
  const [lever, ...rest] = infiniteContext(() => rules(FILE));
  assert.deepEqual(rest, []);
  assert.deepEqual([lever.id, lever.target, lever.scope, lever.tier, lever.readBackAt, lever.follow], ["infinite-context.nudgeAtTokens", "infinite-context", "session", "seed", "before_agent_start", "model"]);
});

test("T7a.2 feasible: the fractions of the model's range; a fixed number or a level that is no fraction is refused up front", () => {
  const [lever] = infiniteContext(() => rules(FILE));
  const f = (model: unknown, levels: Array<string | number | boolean>) => lever.feasible({ child: false, model: model as never }, levels);
  assert.deepEqual(f(haiku, [0.25, 0.75]), [0.25, 0.75]);
  assert.deepEqual(f(haiku, [0, 1]), [0, 1]);
  assert.deepEqual(f(haiku, [0.25, 1.5, -0.1, "high", true, Number.NaN]), [0.25], "only fractions in [0, 1]");
  assert.deepEqual(f(opus, [0.25, 0.75]), [], "a fixed number: no draw, records ignored");
  assert.deepEqual(f(gpt, [0.25, 0.75]), [], "the top level is fixed");
  assert.deepEqual(f(undefined, [0.25, 0.75]), []);
  assert.equal(lever.feasible({ child: true, model: haiku }, [0.25]).length, 1, "a child's limit resolves as a main's");
  const [topRange] = infiniteContext(() => rules({ nudgeAtTokens: [100, 200] }));
  assert.deepEqual(topRange.feasible({ child: false, model: gpt }, [0.5]), [0.5], "a top-level range counts");
  const [none] = infiniteContext(() => rules(undefined));
  assert.deepEqual(none.feasible({ child: false, model: gpt }, [0.5]), [], "upstream's default is a fixed number");
});

test("T7a.2 valueFor: the tokens of the level in the model's range; the level itself where there is no range", () => {
  const [lever] = infiniteContext(() => rules(FILE));
  const v = (model: unknown, q: number) => lever.valueFor!({ sessionId: "s1", model: model as never }, q);
  assert.equal(v(haiku, 0.25), 125_000);
  assert.equal(v(haiku, 0.75), 175_000);
  assert.equal(v(opus, 0.25), 0.25, "a fixed limit has no value to compute");
});

test("T7a.2 apply: appends the seed record — the drawn tokens and the model's range, nothing else — and nothing for a fixed limit", () => {
  const [lever] = infiniteContext(() => rules(FILE));
  const entries: Array<[string, unknown]> = [];
  const ctx = (model: unknown) => ({ sessionId: "s1", model: model as never, appendEntry: (t: string, d: unknown) => void entries.push([t, d]) });
  lever.apply(ctx(haiku), 0.25);
  assert.deepEqual(entries, [[IC_ENTRY, { nudgeAtTokens: 125_000, nudgeAtTokensRange: [100_000, 200_000] }]]);
  assert.equal("rule" in (entries[0][1] as object), false, "upstream's record has no `rule` (the former patch's field)");
  assert.equal(IC_ENTRY, "infinite-context:settings");
  lever.apply(ctx(opus), 0.25);
  lever.apply(ctx(gpt), 0.25);
  assert.equal(entries.length, 1);
  // A top-level range: the same record.
  const [top] = infiniteContext(() => rules({ nudgeAtTokens: [100, 200] }));
  top.apply(ctx(gpt), 0.5);
  assert.deepEqual(entries[1], [IC_ENTRY, { nudgeAtTokens: 150, nudgeAtTokensRange: [100, 200] }]);
  lever.apply({ sessionId: "s1", model: haiku }, 0.25); // a host without appendEntry: nothing to write to
});

test("T7a.2 observe: the latest settings record on the branch — a range means the extension drew it (ext), none a configured number (fixed)", () => {
  const [lever] = infiniteContext(() => rules(FILE));
  const rec = (data: unknown) => ({ type: "custom", customType: IC_ENTRY, data });
  const seen = (branch: unknown[]) => lever.observe!({ sessionId: "s1", branch: () => branch });
  assert.equal(seen([]), undefined);
  assert.equal(lever.observe!({ sessionId: "s1" }), undefined, "no branch");
  assert.deepEqual(seen([rec({ nudgeAtTokens: 125_000, nudgeAtPercent: 75, nudgeAtTokensRange: [100_000, 200_000] })]), { v: 125_000, s: "ext" });
  assert.deepEqual(seen([rec({ nudgeAtTokens: 400_000, nudgeAtPercent: 75 })]), { v: 400_000, s: "fixed" });
  // The latest wins; entries of other types and malformed data are skipped.
  assert.deepEqual(
    seen([rec({ nudgeAtTokens: 1, nudgeAtPercent: 75, nudgeAtTokensRange: [1, 2] }), { type: "custom", customType: "other", data: { nudgeAtTokens: 5 } }, { type: "message" }, rec({ nudgeAtTokens: 400_000, nudgeAtPercent: 50 })]),
    { v: 400_000, s: "fixed" },
  );
  assert.deepEqual(seen([rec({ nudgeAtTokens: 125_000, nudgeAtPercent: 75, nudgeAtTokensRange: [100_000, 200_000] }), rec("x"), rec({ nudgeAtTokens: "many" }), rec(null)]), { v: 125_000, s: "ext" });
  assert.equal(seen([rec({ nudgeAtTokens: Number.NaN, nudgeAtPercent: 75 })]), undefined);
});

// Review m1: the extension's record always carries nudgeAtPercent and the seed never does, so a latest record without it is
// the engine's own write that the extension has not adopted: nothing observed, never a read-back of the engine by itself.
test("review m1 observe: the latest record without a numeric nudgeAtPercent (the engine's own seed) is not an observation", () => {
  const [lever] = infiniteContext(() => rules(FILE));
  const rec = (data: unknown) => ({ type: "custom", customType: IC_ENTRY, data });
  const seen = (branch: unknown[]) => lever.observe!({ sessionId: "s1", branch: () => branch });
  const seed = { nudgeAtTokens: 125_000, nudgeAtTokensRange: [100_000, 200_000] };
  assert.equal(seen([rec(seed)]), undefined);
  assert.equal(seen([rec({ ...seed, nudgeAtPercent: "75" })]), undefined, "a percentage that is no number");
  assert.equal(seen([rec({ ...seed, nudgeAtPercent: Number.NaN })]), undefined);
  // An earlier completed record does not stand in for the latest one: that is what the extension will read.
  assert.equal(seen([rec({ ...seed, nudgeAtTokens: 150_000, nudgeAtPercent: 75 }), rec(seed)]), undefined);
  assert.deepEqual(seen([rec(seed), rec({ ...seed, nudgeAtPercent: 75 })]), { v: 125_000, s: "ext" });
});

// Review m2: the guard that skips a second record compares the tokens AND the range. Two models whose ranges share their minimum
// give the same tokens at level 0; a switch between them must still seed, or the extension redraws (the range differs) and the
// lever reads refused although nothing was wrong.
test("review m2 apply: a branch whose latest record holds the same tokens in another range is not 'already seeded'", () => {
  const two = rules({ modelOverrides: { "a/m": { nudgeAtTokens: [100, 200] }, "b/m": { nudgeAtTokens: [100, 300] } } });
  const [lever] = infiniteContext(() => two);
  const entries: Array<{ type: "custom"; customType: string; data: unknown }> = [];
  const ctx = (provider: string) => ({
    sessionId: "s1", model: { provider, id: "m" },
    branch: () => entries,
    appendEntry: (customType: string, data: unknown) => void entries.push({ type: "custom", customType, data }),
  });
  lever.apply(ctx("a"), 0);
  assert.deepEqual(entries.map((e) => e.data), [{ nudgeAtTokens: 100, nudgeAtTokensRange: [100, 200] }]);
  lever.apply(ctx("a"), 0);
  assert.equal(entries.length, 1, "the same tokens in the same range: already there");
  lever.apply(ctx("b"), 0);
  assert.deepEqual(entries.at(-1)!.data, { nudgeAtTokens: 100, nudgeAtTokensRange: [100, 300] }, "another range: seeded although the tokens are equal");
  assert.equal(entries.length, 2);
  lever.apply(ctx("b"), 1);
  assert.equal(entries.at(-1)!.data && (entries.at(-1)!.data as { nudgeAtTokens: number }).nudgeAtTokens, 300, "another level: seeded");
  assert.equal(entries.length, 3);
});
