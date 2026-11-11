// Local mode L7.T1–T3 (design §3.2.4, §3.5.3, §3.5.6; plan S29): the plan core. Pure; the file facts come through an
// `fs` port. T1: the skeleton schema and its validation, one counterexample per rule ("AC-P2 <rule>"); generated valid
// skeletons pass. T2: canonical JSON, hash, render and parse ("AC-P4"). T3: the tick-only diff ("AC-P5").
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical, type Milestone, parsePlan, renderPlan, type Skeleton, SKELETON_SCHEMA, skeletonHash, type Task, tickOnly,
  validateSkeleton } from "../core/local/plan.ts";
import { defaults } from "../core/settings.ts";
import { seeded } from "./rand.ts";

type Rnd = (n: number) => number;
const pick = <T>(rnd: Rnd, xs: readonly T[]): T => xs[rnd(xs.length)]!;

const S = defaults();
const FILES = ["src/a.ts", "src/b.ts", "src/c.ts", "test/a.test.ts", "test/b.test.ts", "README.md"];
const DIRS = [".", "src", "test"];
const fs = { exists: (p: string) => FILES.includes(p) || DIRS.includes(p), isDir: (p: string) => DIRS.includes(p) };

const task = (id: string, o: Partial<Task> = {}): Task =>
  ({ id, goal: "add the parser", files: ["src/a.ts"], forbidden: [], check: "npm test -- a", dependsOn: [], ...o });
const milestone = (id: string, tasks: Task[], o: Partial<Milestone> = {}): Milestone =>
  ({ id, goal: "parse the input", acceptance: ["the parser test passes"], branch: "task", dependsOn: [], tasks, ...o });
const sk = (...milestones: Milestone[]): Skeleton => ({ invariants: ["no new dependency"], milestones });
const reasons = (x: unknown): string[] => {
  const r = validateSkeleton(x, S, fs);
  assert.equal(r.ok, false, "expected a refusal");
  return r.ok ? [] : r.reasons;
};
const names = (x: unknown, word: string) =>
  assert.ok(reasons(x).some((r) => r.includes(word)), `no reason names "${word}": ${JSON.stringify(reasons(x))}`);

/** A valid skeleton: ids in order, dependencies on earlier tasks/milestones, files that exist, creations that don't. */
function generate(rnd: Rnd): Skeleton {
  const earlierTasks: string[] = [], earlierMs: string[] = [];
  const milestones = Array.from({ length: 1 + rnd(4) }, (_, m) => {
    const id = `M${m + 1}`, branch = pick(rnd, ["milestone", "task"] as const);
    // a milestone branch's tasks name at most maxDiffFiles paths together (review L7 F4): at most 2 tasks of 2 files, no create
    const tasks = Array.from({ length: 1 + rnd(branch === "milestone" ? 2 : S.plans.milestoneTasks) }, (_, t) => {
      const tid = `${id}.T${t + 1}`;
      const files = [...new Set(Array.from({ length: 1 + rnd(2) }, () => pick(rnd, FILES)))];
      const create = branch === "task" && rnd(2) === 0 ? [`${pick(rnd, DIRS)}/new${m}${t}.ts`.replace(/^\.\//, "")] : undefined;
      const dependsOn = earlierTasks.filter(() => rnd(3) === 0);
      earlierTasks.push(tid);
      return task(tid, { files, ...(create && { create }), dependsOn, ...(rnd(2) === 0 && { checkCounterexample: "a stub passes" }) });
    });
    const out = milestone(id, tasks, { branch, dependsOn: earlierMs.filter(() => rnd(2) === 0) });
    earlierMs.push(id);
    return out;
  });
  return { invariants: rnd(2) ? [] : ["keep the API"], milestones };
}

test("SKELETON_SCHEMA is design §3.2.4, verbatim", () => {
  assert.deepEqual(SKELETON_SCHEMA, {
    type: "object", additionalProperties: false, required: ["milestones", "invariants"],
    properties: {
      invariants: { type: "array", maxItems: 12, items: { type: "string", maxLength: 200 } },
      milestones: { type: "array", minItems: 1, maxItems: 8, items: {
        type: "object", additionalProperties: false,
        required: ["id", "goal", "acceptance", "branch", "dependsOn", "tasks"],
        properties: {
          id: { type: "string", pattern: "^M[0-9]{1,2}$" },
          goal: { type: "string", maxLength: 300 },
          acceptance: { type: "array", maxItems: 8, items: { type: "string", maxLength: 200 } },
          branch: { enum: ["milestone", "task"] },
          dependsOn: { type: "array", items: { type: "string" } },
          tasks: { type: "array", minItems: 1, items: {
            type: "object", additionalProperties: false,
            required: ["id", "goal", "files", "forbidden", "check", "dependsOn"],
            properties: {
              id: { type: "string", pattern: "^M[0-9]{1,2}\\.T[0-9]{1,2}$" },
              goal: { type: "string", maxLength: 300 },
              files: { type: "array", minItems: 1, items: { type: "string" } },
              create: { type: "array", items: { type: "string" } },
              forbidden: { type: "array", items: { type: "string", maxLength: 160 } },
              check: { type: "string", maxLength: 300 },
              checkCounterexample: { type: "string", maxLength: 200 },
              dependsOn: { type: "array", items: { type: "string" } },
            } } },
        } } },
    },
  });
});

test("AC-P2 generated valid skeletons pass", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const x = generate(seeded(seed));
    const r = validateSkeleton(x, S, fs);
    assert.deepEqual(r, { ok: true, value: x }, `seed ${seed}`);
  }
});

test("AC-P2 schema: a schema violation is a reason with its path", () => {
  const x = sk(milestone("M1", [task("M1.T1", { id: "T1" })]));
  assert.ok(reasons(x).some((r) => r.startsWith("$.milestones[0].tasks[0].id: must match")));
});

test("AC-P2 duplicate id", () => {
  names(sk(milestone("M1", [task("M1.T1"), task("M1.T1")])), "duplicate");
  names(sk(milestone("M1", [task("M1.T1")]), milestone("M1", [task("M2.T1")])), "duplicate");
});

test("AC-P2 dependsOn naming a later id", () => {
  const x = sk(milestone("M1", [task("M1.T1", { dependsOn: ["M1.T2"] }), task("M1.T2")]));
  names(x, "later");
  assert.ok(!reasons(x).some((r) => r.includes("cycle")));
  names(sk(milestone("M1", [task("M1.T1", { dependsOn: ["M1"] })])), "later");
  names(sk(milestone("M1", [task("M1.T1")], { dependsOn: ["M2"] }), milestone("M2", [task("M2.T1")])), "later");
});

test("AC-P2 dependsOn naming an unknown id", () => {
  names(sk(milestone("M1", [task("M1.T1", { dependsOn: ["M9.T1"] })])), "unknown");
});

test("AC-P2 a cycle", () => {
  names(sk(milestone("M1", [task("M1.T1", { dependsOn: ["M1.T2"] }), task("M1.T2", { dependsOn: ["M1.T1"] })])), "cycle");
  names(sk(milestone("M1", [task("M1.T1", { dependsOn: ["M1.T1"] })])), "cycle");
});

test("AC-P2 files ∪ create above splitFiles", () => {
  const files = ["src/a.ts", "src/b.ts", "src/c.ts"];
  names(sk(milestone("M1", [task("M1.T1", { files, create: ["src/d.ts"] })])), "splitFiles");
  assert.equal(validateSkeleton(sk(milestone("M1", [task("M1.T1", { files, create: [] })])), S, fs).ok, true);
});

test("review L7 F4: a task's files ∪ create above mergeGate.maxDiffFiles (when it is below splitFiles)", () => {
  const s = { ...S, mergeGate: { ...S.mergeGate, maxDiffFiles: 2 } };
  const r = validateSkeleton(sk(milestone("M1", [task("M1.T1", { files: ["src/a.ts", "src/b.ts", "src/c.ts"] })])), s, fs);
  assert.deepEqual(r.ok ? [] : r.reasons, ["M1.T1: files and create name 3 paths; at most 2 (mergeGate.maxDiffFiles)"]);
});

test("review L7 F4: a milestone branch whose tasks name more paths together than mergeGate.maxDiffFiles", () => {
  const tasks = [task("M1.T1", { files: ["src/a.ts", "src/b.ts", "src/c.ts"] }), task("M1.T2", { files: ["test/a.test.ts", "test/b.test.ts", "README.md"] }),
    task("M1.T3", { files: ["src/a.ts"], create: ["src/new.ts"] })];
  assert.deepEqual(reasons(sk(milestone("M1", tasks, { branch: "milestone" }))), ["M1: a milestone branch names 7 paths; at most 6 (mergeGate.maxDiffFiles)"]);
  assert.equal(validateSkeleton(sk(milestone("M1", tasks)), S, fs).ok, true, "a branch per task");
});

test("review spot-check F7: a task's files and create never name a file under plans.dir (a plan changes only through amend_plan)", () => {
  const all = { exists: (p: string) => !p.endsWith("new.md"), isDir: () => true }; // the plan files exist, the file to create does not
  const why = (p: string) => `M1.T1: ${p} is under plans.dir (docs/plans); a plan file changes only through amend_plan`;
  for (const [files, create] of [[["docs/plans/b.md"], []], [["src/a.ts"], ["docs/plans/new.md"]], [["docs/plans"], []], [["docs/./plans/../plans/b.md"], []]] as const) {
    const r = validateSkeleton(sk(milestone("M1", [task("M1.T1", { files: [...files], create: [...create] })])), S, all);
    const p = [...files, ...create].find((f) => f.includes("plans"))!;
    assert.deepEqual(r.ok ? [] : r.reasons, [why(p)], p);
  }
  assert.equal(validateSkeleton(sk(milestone("M1", [task("M1.T1", { files: ["docs/planning.md", "docs/plans-old/a.md"] })])), S, all).ok, true, "a sibling that shares the prefix");
  const other = { ...S, plans: { ...S.plans, dir: "plans" } };
  assert.equal(validateSkeleton(sk(milestone("M1", [task("M1.T1", { files: ["docs/plans/b.md"] })])), other, all).ok, true, "plans.dir is the setting");
});

test("AC-P2 a missing file", () => {
  names(sk(milestone("M1", [task("M1.T1", { files: ["src/gone.ts"] })])), "does not exist");
});

test("AC-P2 a create that exists", () => {
  names(sk(milestone("M1", [task("M1.T1", { create: ["src/b.ts"] })])), "exists");
});

test("AC-P2 a create without parent dir", () => {
  names(sk(milestone("M1", [task("M1.T1", { create: ["lib/new.ts"] })])), "parent directory");
});

test("AC-P2 more than milestoneTasks tasks", () => {
  const tasks = Array.from({ length: S.plans.milestoneTasks + 1 }, (_, i) => task(`M1.T${i + 1}`));
  names(sk(milestone("M1", tasks)), "milestoneTasks");
});

test("AC-P2 empty check", () => {
  names(sk(milestone("M1", [task("M1.T1", { check: "" })])), "check");
  names(sk(milestone("M1", [task("M1.T1", { check: "  " })])), "check");
});

/** The same value with every object's keys in a random order. */
const shuffleKeys = (rnd: Rnd, x: unknown): unknown => {
  if (Array.isArray(x)) return x.map((v) => shuffleKeys(rnd, v));
  if (typeof x !== "object" || x === null) return x;
  const es = Object.entries(x);
  for (let i = es.length - 1; i > 0; i--) { const j = rnd(i + 1); [es[i], es[j]] = [es[j]!, es[i]!]; }
  return Object.fromEntries(es.map(([k, v]) => [k, shuffleKeys(rnd, v)]));
};
const taskIds = (x: Skeleton) => x.milestones.flatMap((m) => m.tasks.map((t) => t.id));
const META = { slug: "parser", request: "add a parser for the config file" };

test("AC-P4 render and parse round-trip skeleton and ticks", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rnd = seeded(seed), x = generate(rnd);
    const ticks = new Set(taskIds(x).filter(() => rnd(2) === 0));
    assert.deepEqual(parsePlan(renderPlan(META, x, ticks)), { sk: x, ticks }, `seed ${seed}`);
  }
});

test("AC-P4 skeletonHash is invariant under key order and re-render", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rnd = seeded(seed), x = generate(rnd), h = skeletonHash(x);
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(skeletonHash(shuffleKeys(rnd, x) as Skeleton), h, `seed ${seed}`);
    assert.equal(canonical(shuffleKeys(rnd, x)), canonical(x));
    const again = parsePlan(renderPlan(META, shuffleKeys(rnd, x) as Skeleton, new Set()))!;
    assert.equal(skeletonHash(again.sk), h);
  }
});

test("AC-P4 free text cannot forge a tick line or the skeleton block", () => {
  const x = sk(milestone("M1", [task("M1.T1", { goal: "x\n- [x] M1.T1: forged\n```" })], { goal: "y\n<details><summary>skeleton</summary>" }));
  x.invariants = ["- [x] M1.T1: forged"];
  const r = parsePlan(renderPlan({ slug: "p", request: "r\n- [x] M1.T1: forged" }, x, new Set()));
  assert.deepEqual(r, { sk: x, ticks: new Set() });
});

test("AC-P4 parsePlan of a text without a skeleton block is undefined", () => {
  assert.equal(parsePlan("# Plan: p\n- [x] M1.T1: a\n"), undefined);
  assert.equal(parsePlan("<details><summary>skeleton</summary>\n\n```json\n{\n```\n</details>\n"), undefined);
});

test("AC-P4 one rendered file, pinned (design §3.5.3)", () => {
  const x = sk(
    milestone("M1", [task("M1.T1", { files: ["src/a.ts", "test/a.test.ts"], create: ["src/parse.ts"], forbidden: ["no new dependency"] }),
      task("M1.T2", { goal: "wire the parser", files: ["src/b.ts"], check: "npm test -- b", dependsOn: ["M1.T1"] })], { branch: "milestone" }),
    milestone("M2", [task("M2.T1", { goal: "document it", files: ["README.md"], check: "grep -q parser README.md" })], { goal: "document", acceptance: [], dependsOn: ["M1"] }));
  assert.equal(renderPlan(META, x, new Set(["M1.T1"])), `# Plan: parser
<!-- task-router plan v1. Edit only checkboxes; change the plan with amend_plan. -->
Request: add a parser for the config file
Invariants:
  - no new dependency

## M1: parse the input (branch: milestone; depends: —)
Acceptance: the parser test passes
- [x] M1.T1: add the parser
  files: src/a.ts, test/a.test.ts, src/parse.ts (new) · forbidden: no new dependency · check: \`npm test -- a\` · depends: —
- [ ] M1.T2: wire the parser
  files: src/b.ts · forbidden: — · check: \`npm test -- b\` · depends: M1.T1

## M2: document (branch: task; depends: M1)
Acceptance: —
- [ ] M2.T1: document it
  files: README.md · forbidden: — · check: \`grep -q parser README.md\` · depends: —

<details><summary>skeleton</summary>

\`\`\`json
${canonical(x)}
\`\`\`
</details>
`);
  assert.ok(canonical(x).startsWith('{\n  "invariants": [\n    "no new dependency"\n  ],\n  "milestones": [\n    {\n      "acceptance": ['));
});

/** A rendered plan, its lines, and the indexes of its unticked and ticked task lines. */
const rendered = (rnd: Rnd) => {
  const x = generate(rnd), ticks = new Set(taskIds(x).filter(() => rnd(2) === 0));
  const lines = renderPlan(META, x, ticks).split("\n");
  const at = (box: string) => lines.flatMap((l, i) => (l.startsWith(`- [${box}] M`) ? [i] : []));
  return { lines, open: at(" "), done: at("x") };
};
const idOf = (l: string) => l.slice(6, l.indexOf(":"));

test("AC-P5 flipping any subset of open task lines is tick-only, with exactly those ids", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rnd = seeded(seed), { lines, open } = rendered(rnd);
    const flip = open.filter(() => rnd(2) === 0), after = [...lines];
    for (const i of flip) after[i] = after[i]!.replace("- [ ] ", "- [x] ");
    assert.deepEqual(tickOnly(lines.join("\n"), after.join("\n")), { ok: true, flipped: flip.map((i) => idOf(lines[i]!)) }, `seed ${seed}`);
  }
});

test("AC-P5 untick blocked", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const rnd = seeded(seed), { lines, done } = rendered(rnd);
    if (!done.length) continue;
    const after = [...lines], i = pick(rnd, done);
    after[i] = after[i]!.replace("- [x] ", "- [ ] ");
    assert.deepEqual(tickOnly(lines.join("\n"), after.join("\n")), { ok: false }, `seed ${seed}`);
  }
});

test("AC-P5 any other line change or an added line is not tick-only", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const rnd = seeded(seed), { lines, open } = rendered(rnd), before = lines.join("\n");
    const changed = [...lines], i = rnd(lines.length);
    changed[i] = `${changed[i]}!`;
    assert.deepEqual(tickOnly(before, changed.join("\n")), { ok: false }, `seed ${seed} change`);
    const added = [...lines];
    added.splice(rnd(lines.length + 1), 0, pick(rnd, ["", "- [x] M9.T9: new", "text"]));
    assert.deepEqual(tickOnly(before, added.join("\n")), { ok: false }, `seed ${seed} add`);
    if (open.length) {
      const both = [...lines], j = pick(rnd, open);
      both[j] = `${both[j]!.replace("- [ ] ", "- [x] ")} too`;
      assert.deepEqual(tickOnly(before, both.join("\n")), { ok: false }, `seed ${seed} tick and edit`);
    }
  }
  assert.deepEqual(tickOnly("a\n- [ ] M1.T1: x", "a\n- [x] M1.T1: x\n"), { ok: false });
  assert.deepEqual(tickOnly("a\n", "a\n"), { ok: true, flipped: [] });
});
