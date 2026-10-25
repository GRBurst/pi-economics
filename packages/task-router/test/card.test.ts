import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCard } from "../core/card.ts";
import { profileFor, skillBlocks, type SkillPort } from "../core/profile.ts";
import { defaults, parseSettings } from "../core/settings.ts";

const t0 = { bounded: true, specified: true, verifiable: true, lowRisk: true, small: true, linear: true };
const valid = () => ({ kind: "implement", files: ["a.ts"], check: "npm test", acceptance: ["works"], t0: { ...t0 }, t2: [] as string[] });
const errorsOf = (x: unknown): string[] => {
  const r = parseCard(x);
  assert.equal(r.ok, false, "expected err");
  return r.ok ? [] : r.errors;
};

test("valid minimal card parses", () => {
  const r = parseCard(valid());
  assert.deepEqual(r, { ok: true, value: valid() });
});

test("optional fields are kept when well-typed", () => {
  const c = { ...valid(), t2: ["security"], importance: "high", attemptOf: "t1", failure: "boom", skills: ["x"] };
  assert.deepEqual(parseCard(c), { ok: true, value: c });
});

test("extra keys are ignored (dropped)", () => {
  const r = parseCard({ ...valid(), bogus: 1 });
  assert.deepEqual(r, { ok: true, value: valid() });
});

test("non-object input → error", () => {
  for (const x of [null, undefined, 3, "x", []]) assert.match(errorsOf(x).join(), /card/);
});

test("each missing field is an error naming it", () => {
  for (const k of ["kind", "files", "acceptance", "t0", "t2"]) {
    const c: Record<string, unknown> = valid();
    delete c[k];
    assert.ok(errorsOf(c).some((e) => e.includes(k)), k);
  }
  for (const k of Object.keys(t0)) {
    const c = valid();
    delete (c.t0 as Record<string, unknown>)[k];
    assert.ok(errorsOf(c).some((e) => e.includes(`t0.${k}`)), k);
  }
});

test("ill-typed fields are errors naming them", () => {
  const bad: Record<string, unknown> = {
    kind: 3, files: "a.ts", acceptance: [1], t0: { ...t0, small: "yes" }, t2: "security",
    check: 4, importance: "normal", attemptOf: 1, failure: [], skills: "x",
  };
  for (const [k, v] of Object.entries(bad)) {
    const errs = errorsOf({ ...valid(), [k]: v });
    assert.ok(errs.some((e) => e.includes(k)), `${k}: ${errs}`);
  }
  assert.ok(errorsOf({ ...valid(), files: ["a", 2] }).some((e) => e.includes("files")));
  assert.ok(errorsOf({ ...valid(), skills: ["a", 2] }).some((e) => e.includes("skills")));
});

test("unknown t2 value is rejected and named", () => {
  const errs = errorsOf({ ...valid(), t2: ["security", "vibes"] });
  assert.ok(errs.some((e) => e.includes("t2") && e.includes("vibes")));
});

test("all errors are reported together", () => {
  assert.ok(errorsOf({}).length >= 5);
});

test("profileFor: built-ins", () => {
  const s = defaults();
  const p = (k: string) => {
    const r = profileFor(k, s);
    assert.ok(r.ok, k);
    return r.ok ? r.value : undefined;
  };
  assert.deepEqual(p("scout"), { ability: "read", minLevel: 2, tools: "read-only", skills: [], report: "answer" });
  assert.deepEqual(p("mechanical"), { tools: "all", skills: [], report: "default" });
  assert.deepEqual(p("implement"), { tools: "all", skills: [], report: "default" });
  assert.deepEqual(p("debug-design"), { minLevel: 1, tools: "all", skills: ["systematic-debugging"], report: "default" });
  assert.deepEqual(p("review"), { ability: "read", table: "review", minLevel: 2, tools: "read-only", skills: ["code-reviewer"], report: "review" });
  assert.deepEqual(p("plan"), { level: "top", tools: "read-only+files", skills: ["tdd-implementation-planner"], report: "plan" });
});

test("profileFor: settings override fields of a built-in and add new kinds", () => {
  const s = parseSettings({ profiles: {
    implement: { minTier: "T1" },
    spike: { tier: "T1", tools: "read-only", skills: ["a"], report: "answer" },
  } }).settings; // legacy keys are the loader's job (spec §5.4 row 7)
  assert.deepEqual(profileFor("implement", s), { ok: true, value: { minLevel: 1, tools: "all", skills: [], report: "default" } });
  assert.deepEqual(profileFor("spike", s), { ok: true, value: { level: 1, tools: "read-only", skills: ["a"], report: "answer" } });
});

test("profileFor: a sparse new kind gets safe defaults", () => {
  const s = parseSettings({ profiles: { x: { tier: "T1" } } }).settings;
  assert.deepEqual(profileFor("x", s), { ok: true, value: { level: 1, tools: "all", skills: [], report: "default" } });
});

test("profileFor: unknown kind → error listing the known kinds", () => {
  const r = profileFor("nope", defaults());
  assert.equal(r.ok, false);
  const msg = r.ok ? "" : r.errors.join("\n");
  for (const k of ["nope", "scout", "mechanical", "implement", "debug-design", "review", "plan"]) assert.ok(msg.includes(k), k);
});

const port: SkillPort = {
  find: (n) => (n === "a" || n === "b" ? { filePath: `/s/${n}/SKILL.md`, baseDir: `/s/${n}` } : undefined),
  read: (p) => `body of ${p}`,
};

test("skillBlocks: block format is pinned", () => {
  assert.deepEqual(skillBlocks(["a"], port), {
    ok: true,
    value: '<skill name="a" location="/s/a/SKILL.md">\nReferences are relative to /s/a.\n\nbody of /s/a/SKILL.md\n</skill>',
  });
});

test("skillBlocks: several skills keep order, joined by a blank line; none → empty", () => {
  const r = skillBlocks(["b", "a"], port);
  assert.ok(r.ok);
  const v = r.ok ? r.value : "";
  assert.ok(v.indexOf('name="b"') < v.indexOf('name="a"'));
  assert.ok(v.includes("</skill>\n\n<skill name=\"a\""));
  assert.deepEqual(skillBlocks([], port), { ok: true, value: "" });
});

test("skillBlocks: unknown skill → error naming it", () => {
  const r = skillBlocks(["a", "zzz"], port);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes("zzz")));
});

test("skillNames (P-profile): profile skills ∪ card skills, deduplicated, order kept", async () => {
  const { skillNames } = await import("../core/profile.ts");
  const p = { tools: "all", skills: ["a", "b"], report: "default" } as const;
  assert.deepEqual(skillNames(p, { skills: ["c", "a", "d", "c"] }), ["a", "b", "c", "d"]);
  assert.deepEqual(skillNames(p, {}), ["a", "b"]);
  assert.deepEqual(skillNames({ ...p, skills: [] }, {}), []);
});
