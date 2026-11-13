// Local mode L8.T2 (plan D58): LOGS.md shows one example line per outcome event task-router's local mode added, in one
// fenced `jsonl` block under a fixed heading; every line passes the data contract, so the examples cannot drift from it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { check, renderProblems } from "../core/contract.ts";
import { KEYS } from "../core/line.ts";
import { leversLine, serializeLevers } from "../core/levers.ts";
import { LEVER_IDS } from "../core/effective-settings.ts";

const HEADING = "### Examples: task-router local mode";
/** The events the examples cover, one line each; a ticket `spawn` counts as its own kind. */
const KINDS = ["force", "gatebypass", "hint", "merge", "plan", "review", "spawn+ticket"];

/** The lines of the first ```jsonl block after `heading`, before the next heading; undefined when there is none. */
function exampleBlock(md: string, heading: string): string[] | undefined {
  const ls = md.split("\n"), at = ls.indexOf(heading);
  if (at < 0) return undefined;
  for (let i = at + 1; i < ls.length && !/^#{1,6} /.test(ls[i]!); i++) {
    if (ls[i] !== "```jsonl") continue;
    const end = ls.indexOf("```", i + 1);
    return end < 0 ? undefined : ls.slice(i + 1, end).filter((l) => l.trim() !== "");
  }
  return undefined;
}

const md = readFileSync(new URL("../LOGS.md", import.meta.url), "utf8");

test("exampleBlock: the jsonl block under the heading, none without the heading or past the next heading", () => {
  const doc = ["# T", HEADING, "", "text", "```jsonl", '{"a":1}', "", '{"b":2}', "```", "## Next", "```jsonl", "{}", "```"].join("\n");
  assert.deepEqual(exampleBlock(doc, HEADING), ['{"a":1}', '{"b":2}']);
  assert.equal(exampleBlock(doc.replace(HEADING, "### Other"), HEADING), undefined);
  assert.equal(exampleBlock([HEADING, "## Next", "```jsonl", "{}", "```"].join("\n"), HEADING), undefined);
});

test("LOGS.md: one example line per local-mode event, each passing the contract", () => {
  const block = exampleBlock(md, HEADING);
  assert.ok(block, `LOGS.md: no \`\`\`jsonl block under "${HEADING}"`);
  const lines = block.map((l, i) => {
    try { return JSON.parse(l); } catch { assert.fail(`example line ${i + 1} is no JSON: ${l}`); }
  });
  const kinds = lines.map((l) => (l.event === "spawn" && "ticket" in l ? "spawn+ticket" : l.event)).sort();
  assert.deepEqual(kinds, KINDS);
  const ps = check({ meter: [], outcomes: lines, assignments: [], guards: [] } as Parameters<typeof check>[0]);
  assert.deepEqual(ps, [], renderProblems(ps));
});

// M3a T3a.11: the meter line v2 section shows lines as the v2 writer writes them; each passes the contract, carries only
// keys the writer emits, and together they show every v2 field, a native retry and a warming line without retries.
const V2_HEADING = "### Meter line v2";
const V2_FIELDS = ["billing", "cacheWrite1h", "durationMs", "ttftMs", "errorKind", "retries", "retryWaitMs", "systemHash"];

test("LOGS.md: meter line v2 examples, each a v2 line the writer could write, passing the contract", () => {
  const block = exampleBlock(md, V2_HEADING);
  assert.ok(block, `LOGS.md: no \`\`\`jsonl block under "${V2_HEADING}"`);
  const lines = block.map((l, i) => {
    try { return JSON.parse(l); } catch { assert.fail(`example line ${i + 1} is no JSON: ${l}`); }
  });
  const keys = new Set<string>(KEYS);
  for (const [i, l] of lines.entries()) {
    assert.equal(l.v, 2, `example line ${i + 1}: v`);
    for (const k of Object.keys(l)) assert.ok(keys.has(k), `example line ${i + 1}: ${k} is no meter key`);
  }
  for (const f of V2_FIELDS) assert.ok(lines.some((l) => f in l), `no example line shows ${f}`);
  assert.ok(lines.some((l) => l.retries >= 1 && l.retryWaitMs > 0), "no native retry");
  assert.ok(lines.some((l) => l.kind === "warming" && !("retries" in l)), "no warming line without retries");
  const ps = check({ meter: lines, outcomes: [], assignments: [], guards: [] } as Parameters<typeof check>[0]);
  assert.deepEqual(ps, [], renderProblems(ps));
});

// M3b T3b.12: levers and compaction lines, as the writer writes them (the levers builder reproduces each byte for byte), each
// passing the contract; together the levers examples show every source and read-back, a child and infinite-context.
const parsed = (heading: string): any[] => {
  const block = exampleBlock(md, heading);
  assert.ok(block, `LOGS.md: no \`\`\`jsonl block under "${heading}"`);
  return block.map((l, i) => {
    try { return JSON.parse(l); } catch { assert.fail(`${heading}: example line ${i + 1} is no JSON: ${l}`); }
  });
};
const passes = (meter: any[]) => {
  const ps = check({ meter, outcomes: [], assignments: [], guards: [] } as Parameters<typeof check>[0]);
  assert.deepEqual(ps, [], renderProblems(ps));
};

test("LOGS.md: levers line examples, each one the builder writes byte for byte, passing the contract", () => {
  const heading = "### Levers lines";
  const block = exampleBlock(md, heading)!;
  const lines = parsed(heading);
  for (const [i, l] of lines.entries()) {
    const { v, kind, ...base } = l;
    assert.deepEqual([v, kind], [2, "levers"], `example line ${i + 1}`);
    assert.equal(serializeLevers(leversLine(base)), block[i] + "\n", `example line ${i + 1} is not what the writer writes`);
    for (const id of Object.keys(l.levers)) assert.ok(LEVER_IDS.includes(id), `example line ${i + 1}: ${id} is no lever the observer writes`);
  }
  const states = lines.flatMap((l) => Object.values(l.levers) as any[]);
  for (const s of ["pe", "ext", "fixed"]) assert.ok(states.some((x) => x.s === s), `no lever with source ${s}`);
  for (const rb of ["confirmed", "refused", "unverified"]) assert.ok(states.some((x) => x.rb === rb), `no lever read back ${rb}`);
  assert.ok(lines.some((l) => typeof l.parentSessionId === "string" && l.eligible === false), "no child line");
  assert.ok(lines.some((l) => l.levers["pi.compaction.enabled"]?.s === "ext"), "no infinite-context line");
  passes(lines);
});

test("LOGS.md: compaction line examples, v2 meter lines of kind compaction without timing or retries, passing the contract", () => {
  const lines = parsed("### Compaction lines");
  const keys = new Set<string>(KEYS);
  assert.ok(lines.length > 0);
  for (const [i, l] of lines.entries()) {
    assert.deepEqual([l.v, l.kind], [2, "compaction"], `example line ${i + 1}`);
    for (const k of Object.keys(l)) assert.ok(keys.has(k), `example line ${i + 1}: ${k} is no meter key`);
    for (const k of ["durationMs", "ttftMs", "retries", "retryWaitMs"]) assert.ok(!(k in l), `example line ${i + 1}: ${k} is never measured for a compaction`);
  }
  passes(lines);
});

test("LOGS.md: the cache-miss causes and the Levers section are described", () => {
  const cache = md.slice(md.indexOf("### Analysis: cache misses"), md.indexOf("## Data contract"));
  for (const c of ["ttl", "fold", "model", "prefix", "other"]) assert.ok(cache.includes(`\`${c}\` —`), `cause ${c} not described`);
  assert.ok(cache.includes("durationMs"), "the gap from send to send (ts − durationMs) not described");
  assert.ok(md.includes("- **Levers**"), "no Levers bullet in the Analysis section");
});
