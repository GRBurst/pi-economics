// The infinite-context add-on, pure parts (redesign §7.4, M7a): the rule table (the module's `overrides`, resolved as
// the patched extension resolves them), the level → token mapping and the lever's feasibility. The engine driving
// it is in ic-seed.test.ts; the equivalence with the extension's own code is the ic-seed-contract check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { IC_DEFAULT_NUDGE, IC_ENTRY, infiniteContext, matchRule, parseIcRules, tokensAt, type IcRules } from "../addons/infinite-context.ts";

const haiku = { provider: "anthropic", id: "claude-haiku-5-5" };
const opus = { provider: "anthropic", id: "claude-opus-5-5" };
const gpt = { provider: "openai", id: "gpt-5" };

test("T7a.1 matchRule: exact provider/id > provider > top level > upstream default, with the rule that set it", () => {
  const overrides = { anthropic: { nudgeAtTokens: [100_000, 200_000] as const }, "anthropic/claude-opus-5-5": { nudgeAtTokens: 400_000 } };
  const m = (top: number | undefined, p?: string, id?: string) => matchRule(overrides, top, p, id);
  assert.deepEqual(m(120_000, opus.provider, opus.id), { rule: "anthropic/claude-opus-5-5", nudge: 400_000 });
  assert.deepEqual(m(120_000, haiku.provider, haiku.id), { rule: "anthropic", nudge: [100_000, 200_000] });
  assert.deepEqual(m(120_000, gpt.provider, gpt.id), { nudge: 120_000 });
  assert.deepEqual(m(undefined, gpt.provider, gpt.id), { nudge: IC_DEFAULT_NUDGE });
  assert.deepEqual(m(120_000, "anthropic"), { rule: "anthropic", nudge: [100_000, 200_000] }, "a provider without an id: the provider's rule");
  assert.deepEqual(m(120_000), { nudge: 120_000 }, "no model: the top level");
  assert.deepEqual(m(120_000, undefined, "claude-opus-5-5"), { nudge: 120_000 }, "an id without a provider matches nothing");
  assert.deepEqual(m(120_000, "anthropic", ""), { rule: "anthropic", nudge: [100_000, 200_000] });
  // Own keys only: an inherited property name is no rule.
  assert.deepEqual(matchRule({}, 120_000, "constructor", "toString"), { nudge: 120_000 });
});

test("T7a.1 parseIcRules: the extension's fail-open parse of nudgeAtTokens — an invalid field is left out, so it inherits", () => {
  const parse = (x: unknown) => parseIcRules(JSON.stringify(x));
  assert.deepEqual(parse({ nudgeAtTokens: [100_000, 300_000], overrides: { a: { nudgeAtTokens: 5 }, "b/c": { nudgeAtTokens: [1, 2], nudgeAtPercent: 50 } } }), {
    top: [100_000, 300_000],
    overrides: { a: { nudgeAtTokens: 5 }, "b/c": { nudgeAtTokens: [1, 2] } },
  });
  // A rule that sets no valid nudgeAtTokens does not exist for this lever (nudgeAtPercent alone, or an invalid value).
  const bad = [0, -1, 1.5, "x", null, true, [], [5], [5, 5], [6, 5], [1, 2, 3], [0, 9], [1.5, 3], ["1", 2], {}];
  for (const b of bad) {
    assert.deepEqual(parse({ nudgeAtTokens: b, overrides: { a: { nudgeAtTokens: b } } }), { overrides: {} }, JSON.stringify(b));
  }
  assert.deepEqual(parse({ overrides: { a: { nudgeAtPercent: 50 }, b: null, c: [], d: 3 } }), { overrides: {} });
  for (const junk of [null, [], 3, "x", true, { overrides: null }, { overrides: [] }, { overrides: 3 }]) assert.deepEqual(parse(junk), { overrides: {} }, JSON.stringify(junk));
  assert.deepEqual(parseIcRules("not json"), { overrides: {} });
  assert.deepEqual(parseIcRules(undefined), { overrides: {} }, "no file");
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
const FILE = { nudgeAtTokens: 120_000, overrides: { anthropic: { nudgeAtTokens: [100_000, 200_000] }, "anthropic/claude-opus-5-5": { nudgeAtTokens: 400_000 } } };

test("T7a.2 the lever: infinite-context's, a session seed, read back before the first agent start", () => {
  const [lever, ...rest] = infiniteContext(() => rules(FILE));
  assert.deepEqual(rest, []);
  assert.deepEqual([lever.id, lever.target, lever.scope, lever.tier, lever.readBackAt, lever.follow], ["infinite-context.nudgeAtTokens", "infinite-context", "session", "seed", "before_agent_start", "model"]);
});

test("T7a.2 feasible: the fractions of the matched rule's range; a fixed number or a level that is no fraction is refused up front", () => {
  const [lever] = infiniteContext(() => rules(FILE));
  const f = (model: unknown, levels: Array<string | number | boolean>) => lever.feasible({ child: false, model: model as never }, levels);
  assert.deepEqual(f(haiku, [0.25, 0.75]), [0.25, 0.75]);
  assert.deepEqual(f(haiku, [0, 1]), [0, 1]);
  assert.deepEqual(f(haiku, [0.25, 1.5, -0.1, "high", true, Number.NaN]), [0.25], "only fractions in [0, 1]");
  assert.deepEqual(f(opus, [0.25, 0.75]), [], "a fixed-number rule: no draw, records ignored");
  assert.deepEqual(f(gpt, [0.25, 0.75]), [], "the top level is fixed");
  assert.deepEqual(f(undefined, [0.25, 0.75]), []);
  assert.equal(lever.feasible({ child: true, model: haiku }, [0.25]).length, 1, "a child's rule applies as a main's");
  const [topRange] = infiniteContext(() => rules({ nudgeAtTokens: [100, 200] }));
  assert.deepEqual(topRange.feasible({ child: false, model: gpt }, [0.5]), [0.5], "a top-level range counts");
  const [none] = infiniteContext(() => rules(undefined));
  assert.deepEqual(none.feasible({ child: false, model: gpt }, [0.5]), [], "upstream's default is a fixed number");
});

test("T7a.2 valueFor: the tokens of the level in the rule's range; the level itself where there is no range", () => {
  const [lever] = infiniteContext(() => rules(FILE));
  const v = (model: unknown, q: number) => lever.valueFor!({ sessionId: "s1", model: model as never }, q);
  assert.equal(v(haiku, 0.25), 125_000);
  assert.equal(v(haiku, 0.75), 175_000);
  assert.equal(v(opus, 0.25), 0.25, "a fixed rule has no value to compute");
});

test("T7a.2 apply: appends the seed record — the drawn tokens, the rule's range, the rule's key — and nothing for a fixed rule", () => {
  const [lever] = infiniteContext(() => rules(FILE));
  const entries: Array<[string, unknown]> = [];
  const ctx = (model: unknown) => ({ sessionId: "s1", model: model as never, appendEntry: (t: string, d: unknown) => void entries.push([t, d]) });
  lever.apply(ctx(haiku), 0.25);
  assert.deepEqual(entries, [[IC_ENTRY, { nudgeAtTokens: 125_000, nudgeAtTokensRange: [100_000, 200_000], rule: "anthropic" }]]);
  assert.equal(IC_ENTRY, "infinite-context:settings");
  lever.apply(ctx(opus), 0.25);
  lever.apply(ctx(gpt), 0.25);
  assert.equal(entries.length, 1);
  // A top-level range names no rule: the record has no `rule` key (the extension's record has none either).
  const [top] = infiniteContext(() => rules({ nudgeAtTokens: [100, 200] }));
  top.apply(ctx(gpt), 0.5);
  assert.deepEqual(entries[1], [IC_ENTRY, { nudgeAtTokens: 150, nudgeAtTokensRange: [100, 200] }]);
  assert.equal("rule" in (entries[1][1] as object), false);
  lever.apply({ sessionId: "s1", model: haiku }, 0.25); // a host without appendEntry: nothing to write to
});

test("T7a.2 observe: the latest settings record on the branch — a range means the extension drew it (ext), none a configured number (fixed)", () => {
  const [lever] = infiniteContext(() => rules(FILE));
  const rec = (data: unknown) => ({ type: "custom", customType: IC_ENTRY, data });
  const seen = (branch: unknown[]) => lever.observe!({ sessionId: "s1", branch: () => branch });
  assert.equal(seen([]), undefined);
  assert.equal(lever.observe!({ sessionId: "s1" }), undefined, "no branch");
  assert.deepEqual(seen([rec({ nudgeAtTokens: 125_000, nudgeAtTokensRange: [100_000, 200_000], rule: "anthropic" })]), { v: 125_000, s: "ext" });
  assert.deepEqual(seen([rec({ nudgeAtTokens: 400_000, nudgeAtPercent: 75, rule: "anthropic/claude-opus-5-5" })]), { v: 400_000, s: "fixed" });
  // The latest wins; entries of other types and malformed data are skipped.
  assert.deepEqual(
    seen([rec({ nudgeAtTokens: 1, nudgeAtTokensRange: [1, 2] }), { type: "custom", customType: "other", data: { nudgeAtTokens: 5 } }, { type: "message" }, rec({ nudgeAtTokens: 400_000 })]),
    { v: 400_000, s: "fixed" },
  );
  assert.deepEqual(seen([rec({ nudgeAtTokens: 125_000, nudgeAtTokensRange: [100_000, 200_000] }), rec("x"), rec({ nudgeAtTokens: "many" }), rec(null)]), { v: 125_000, s: "ext" });
  assert.equal(seen([rec({ nudgeAtTokens: Number.NaN })]), undefined);
});
