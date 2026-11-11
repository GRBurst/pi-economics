// Local mode L7.T6–T8 (design §3.5.2; plan D50–D52, LD10): `plan_request` in a temporary repository. T6: the grounding
// check refuses before any overseer runs ("AC-P1"), as do a used slug and a dirty main checkout (D51).
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { planRequest } from "../core/local/planflow.ts";
import { planRig } from "./plan-rig.ts";

const INPUT = { slug: "parser", request: "add a parser", acceptance: ["the parser test passes"], files: ["src/a.ts"], symbols: ["parse"] };

test("AC-P1 a missing file and an absent symbol are refused together, before any overseer runs", async () => {
  const x = planRig();
  const before = x.mainSha();
  const r = await planRequest(x.ports, { ...INPUT, files: ["src/a.ts", "src/gone.ts"], symbols: ["parse", "tokenize", "par"] }, x.r.dir);
  assert.equal(r.status, "refused");
  assert.equal(r.reason, "grounding");
  assert.ok(r.detail.includes("src/gone.ts"), r.detail);
  assert.ok(r.detail.includes("tokenize"), r.detail);
  assert.ok(r.detail.includes("par") && !r.detail.includes("parse"), "a symbol is a whole word; parse is found");
  assert.equal(x.runs.length, 0);
  assert.equal(x.mainSha(), before);
  assert.deepEqual(x.entries, []);
});

test("AC-P1 a slug a plan already uses is refused", async () => {
  const x = planRig();
  x.plans.put({ slug: "parser", repo: x.r.dir, file: "docs/plans/parser.md", skeletonHash: "a".repeat(64), approvedBy: "rv-0", triggers: [] });
  const r = await planRequest(x.ports, INPUT, x.r.dir);
  assert.equal(r.status, "refused");
  assert.equal(r.reason, "slug");
  assert.equal(x.runs.length, 0);
  const y = planRig();
  y.r.commit("docs/plans/parser.md", "# Plan: parser\n");
  const s = await planRequest(y.ports, INPUT, y.r.dir);
  assert.equal(s.reason, "slug", "a plan file of that name on main uses it too");
  assert.equal(y.runs.length, 0);
});

test("D51 a dirty main checkout is refused before authoring", async () => {
  const x = planRig();
  writeFileSync(join(x.r.dir, "src/b.ts"), "changed\n");
  const r = await planRequest(x.ports, INPUT, x.r.dir);
  assert.equal(r.status, "refused");
  assert.equal(r.reason, "main-dirty");
  assert.ok(r.detail.includes(x.r.dir));
  assert.equal(x.runs.length, 0);
});

test("a cwd outside any repository is an error", async () => {
  const x = planRig();
  const r = await planRequest(x.ports, INPUT, x.r.base);
  assert.equal(r.status, "error");
  assert.equal(x.runs.length, 0);
});
