// Local mode L8.T2 (plan D58): LOGS.md shows one example line per outcome event task-router's local mode added, in one
// fenced `jsonl` block under a fixed heading; every line passes the data contract, so the examples cannot drift from it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { check, renderProblems } from "../core/contract.ts";

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
