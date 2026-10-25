// T5.20: card `cwd` — files, the verify-gate check and the tool guard resolve against the card's
// working directory (default: the caller's). A relative file whose directory is missing there is
// "unresolved": bounded stays lowered (conservative), the reason says so and the spawn line carries
// `unresolved: true` so analysis can exclude it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCard } from "../core/card.ts";
import { CARD_FIELDS } from "../core/prompt.ts";
import { resolveCwd } from "../core/verify.ts";
import type { FsPort } from "../core/verify.ts";
import { accepted, card, harness, provideSkills } from "./harness.ts";

const t0 = { bounded: true, specified: true, verifiable: true, lowRisk: true, small: true, linear: true };
const valid = () => ({ kind: "implement", files: ["a.ts"], check: "npm test", acceptance: ["works"], t0: { ...t0 }, t2: [] as string[] });
// The session runs in /work (fake-api caller); the project lives in /proj and in /home/u/proj.
const FS: FsPort = {
  exists: (p) => p.startsWith("/proj/src/") || p.startsWith("/home/u/proj/src/"),
  size: () => 1000,
  isDir: (p) => ["/work", "/proj", "/proj/src", "/home/u/proj", "/home/u/proj/src"].includes(p),
};
type Run = { cmd: string; cwd: string };
const rig = () => {
  const runs: Run[] = [];
  const h = harness({ extra: { fs: FS, home: "/home/u", run: async (cmd: string, cwd: string) => { runs.push({ cmd, cwd }); return { exit: 0, output: "", timedOut: false }; } } as never });
  provideSkills(h, ["tdd-implementation-planner"]);
  return { h, runs };
};
const spawnLine = (h: ReturnType<typeof harness>, name: string) => {
  h.a.emit({ type: "spawn", name, by: "main", parent: "main", childSessionId: `s-${name}`, ts: 1 });
  return h.lines().find((l) => l.event === "spawn" && l.taskId === name)!;
};

test("parseCard keeps an absolute or ~ cwd and rejects a relative or non-string one", () => {
  for (const cwd of ["/proj", "~", "~/proj"]) assert.deepEqual(parseCard({ ...valid(), cwd }), { ok: true, value: { ...valid(), cwd } });
  for (const cwd of ["proj", "./proj", "~user/x", 3, ""]) {
    const r = parseCard({ ...valid(), cwd });
    assert.equal(r.ok, false, String(cwd));
    if (!r.ok) assert.ok(r.errors.some((e) => e.startsWith("cwd:")), r.errors.join());
  }
});

test("resolveCwd: none → caller cwd; ~ and ~/x expand to home; absolute stays", () => {
  assert.equal(resolveCwd(undefined, "/work", "/home/u"), "/work");
  assert.equal(resolveCwd("~", "/work", "/home/u"), "/home/u");
  assert.equal(resolveCwd("~/proj", "/work", "/home/u"), "/home/u/proj");
  assert.equal(resolveCwd("/proj/", "/work", "/home/u"), "/proj");
});

test("card cwd: relative files resolve under it, so bounded holds (the session cwd lacks them)", async () => {
  const { h } = rig();
  accepted(await h.a.spawn({ name: "c1", task: card({ cwd: "/proj", files: ["src/a.ts", "src/new.ts"] }) }));
  const e = spawnLine(h, "c1");
  assert.equal(e.base, "qwen", JSON.stringify(e.reasons));
  assert.equal(e.unresolved, undefined);
  accepted(await h.a.spawn({ name: "c2", task: card({ cwd: "~/proj", files: ["src/a.ts"] }) }));
  assert.equal(spawnLine(h, "c2").base, "qwen");
});

test("without cwd the caller's cwd is used: relative files missing there are unresolved (lowered, flagged)", async () => {
  const { h } = rig();
  accepted(await h.a.spawn({ name: "u1", task: card({ files: ["src/a.ts"] }) }));
  const e = spawnLine(h, "u1");
  assert.equal(e.base, "qwen-draft");
  assert.ok((e.reasons as string[]).some((r) => r.includes("files unresolved under /work")), JSON.stringify(e.reasons));
  assert.equal(e.unresolved, true);
});

test("a missing directory of an absolute file lowers bounded but is not 'unresolved'", async () => {
  const { h } = rig();
  accepted(await h.a.spawn({ name: "a1", task: card({ cwd: "/proj", files: ["src/a.ts", "/nowhere/x.ts"] }) }));
  const e = spawnLine(h, "a1");
  assert.equal(e.base, "qwen-draft");
  assert.ok((e.reasons as string[]).some((r) => r.includes("no such directory for: /nowhere/x.ts")));
  assert.equal(e.unresolved, undefined);
});

test("verify gate runs the check in the card cwd", async () => {
  const { h, runs } = rig();
  accepted(await h.a.spawn({ name: "g1", task: card({ cwd: "~/proj", check: "npm test" }) }));
  h.a.agents.splice(0, h.a.agents.length, { name: "g1", parent: "main", sessionId: "g1", model: "x", thinkingLevel: "xhigh", state: "idle" });
  h.a.emit({ type: "route", from: "g1", to: "main", preview: "done", buffered: false, ts: 1 });
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.deepEqual(runs, [{ cmd: "npm test", cwd: "/home/u/proj" }]);
});

test("read-only+files guard: card files resolve under the card cwd, the child's paths under its own cwd", async () => {
  const { h } = rig();
  const r = accepted(await h.a.spawn({ name: "p1", task: card({ kind: "plan", cwd: "/proj", files: ["docs/plan.md"] }) })) as any;
  const g = r.toolGuard as (t: string, i: unknown) => string | undefined;
  assert.equal(g("write", { path: "/proj/docs/plan.md" }), undefined);
  assert.match(g("write", { path: "docs/plan.md" })!, /\/proj\/docs\/plan\.md/); // /work/docs/plan.md is another file
});

test("the card schema lists cwd and reviewOf", () => {
  for (const k of ["cwd", "reviewOf"]) assert.ok(CARD_FIELDS.includes(k), k);
});
