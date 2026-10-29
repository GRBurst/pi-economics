import { test } from "node:test";
import assert from "node:assert/strict";
import { importanceOf } from "../core/importance.ts";
import type { Importance, ThinkingLevel } from "../core/types.ts";

const base = { pathRules: [], files: [] as string[] };

test("main effort map: ≤ high → normal, xhigh → high, max → critical", () => {
  const lv = (e?: ThinkingLevel) => importanceOf({ ...base, mainEffort: e });
  for (const e of [undefined, "off", "minimal", "low", "medium", "high"] as const) assert.equal(lv(e), "normal", String(e));
  assert.equal(lv("xhigh"), "high");
  assert.equal(lv("max"), "critical");
});

test("parent importance and card importance are sources", () => {
  assert.equal(importanceOf({ ...base, parent: "high" }), "high");
  assert.equal(importanceOf({ ...base, parent: "critical" }), "critical");
  assert.equal(importanceOf({ ...base, card: "high" }), "high");
  assert.equal(importanceOf({ ...base, card: "critical" }), "critical");
});

test("path rule applies when any file matches its glob", () => {
  const pathRules = [{ glob: "**/billing/**", level: "critical" as Importance }, { glob: "docs/*.md", level: "high" as Importance }];
  assert.equal(importanceOf({ pathRules, files: ["src/a.ts", "src/billing/x.ts"] }), "critical");
  assert.equal(importanceOf({ pathRules, files: ["docs/a.md"] }), "high");
  assert.equal(importanceOf({ pathRules, files: ["src/a.ts"] }), "normal");
});

test("result is the max of all sources, never lower than any", () => {
  const lvls: Importance[] = ["normal", "high", "critical"];
  const efforts: (ThinkingLevel | undefined)[] = [undefined, "high", "xhigh", "max"];
  const rank = (i: Importance) => lvls.indexOf(i);
  const fromEffort = (e?: ThinkingLevel): Importance => (e === "max" ? "critical" : e === "xhigh" ? "high" : "normal");
  for (const e of efforts) for (const p of lvls) for (const c of [undefined, ...lvls.slice(1)] as (Importance | undefined)[]) {
    const got = importanceOf({ pathRules: [], files: [], mainEffort: e, parent: p, card: c as "high" | "critical" | undefined });
    const want = Math.max(rank(fromEffort(e)), rank(p), c ? rank(c) : 0);
    assert.equal(rank(got), want, JSON.stringify([e, p, c]));
  }
});
