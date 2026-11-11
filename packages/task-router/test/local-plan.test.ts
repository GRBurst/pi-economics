// Local mode L7.T1 (design §3.2.4, plan S29): the skeleton schema and its deterministic validation. Pure; the
// file facts come through an `fs` port. One counterexample per rule ("AC-P2 <rule>"); generated valid skeletons pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Milestone, type Skeleton, SKELETON_SCHEMA, type Task, validateSkeleton } from "../core/local/plan.ts";
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
    const id = `M${m + 1}`;
    const tasks = Array.from({ length: 1 + rnd(S.plans.milestoneTasks) }, (_, t) => {
      const tid = `${id}.T${t + 1}`;
      const files = [...new Set(Array.from({ length: 1 + rnd(2) }, () => pick(rnd, FILES)))];
      const create = rnd(2) === 0 ? [`${pick(rnd, DIRS)}/new${m}${t}.ts`.replace(/^\.\//, "")] : undefined;
      const dependsOn = earlierTasks.filter(() => rnd(3) === 0);
      earlierTasks.push(tid);
      return task(tid, { files, ...(create && { create }), dependsOn, ...(rnd(2) === 0 && { checkCounterexample: "a stub passes" }) });
    });
    const out = milestone(id, tasks, { branch: pick(rnd, ["milestone", "task"] as const), dependsOn: earlierMs.filter(() => rnd(2) === 0) });
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
