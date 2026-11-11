// Local mode L5.T4 (design §3.0.2, §3.3; plan S22, D37, D38): the branch store and its session entries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BRANCH_STATES, BRANCH_TYPE, createBranchStore, type BranchRecord } from "../core/local/branches.ts";
import { seeded } from "./rand.ts";

const rec = (o: Partial<BranchRecord> = {}): BranchRecord =>
  ({ repo: "/r/x", branch: "lm/a", worktree: "/r/x.worktrees/lm--a", base: "main", state: "active", rejections: 0, fixerRuns: 0, ...o });
const entry = (data: unknown) => ({ type: "custom", customType: BRANCH_TYPE, data });
function store() {
  const entries: { type: string; data: unknown }[] = [];
  return { s: createBranchStore((type, data) => entries.push({ type, data })), entries };
}

test("put appends exactly one task-router/branch entry per change, holding the record", () => {
  const { s, entries } = store();
  s.put(rec());
  s.put(rec({ rejections: 1 }));
  s.put(rec({ branch: "lm/b", goal: "g", check: "true", plan: { slug: "p", id: "m1" }, fixer: "fx-1", fixerRuns: 1, state: "blocked" }));
  assert.deepEqual(entries.map((e) => e.type), [BRANCH_TYPE, BRANCH_TYPE, BRANCH_TYPE]);
  assert.deepEqual(entries.map((e) => e.data), [rec(), rec({ rejections: 1 }), rec({ branch: "lm/b", goal: "g", check: "true", plan: { slug: "p", id: "m1" }, fixer: "fx-1", fixerRuns: 1, state: "blocked" })]);
  assert.deepEqual(s.all().map((r) => [r.branch, r.rejections, r.state]), [["lm/a", 1, "active"], ["lm/b", 0, "blocked"]]);
  assert.deepEqual(s.get("/r/x", "lm/a"), rec({ rejections: 1 }));
  assert.equal(s.get("/r/x", "lm/none"), undefined);
  assert.equal(s.get("/other", "lm/a"), undefined);
});

test("records are copies: changing what was put or what was read does not change the store", () => {
  const { s, entries } = store();
  const r = rec();
  s.put(r);
  r.state = "merged";
  s.get("/r/x", "lm/a")!.state = "merged";
  s.all()[0]!.rejections = 9;
  assert.deepEqual(s.get("/r/x", "lm/a"), rec());
  assert.deepEqual(entries[0]!.data, rec());
});

test("D38: active() is the newest-put record whose state is active", () => {
  const { s } = store();
  assert.equal(s.active(), undefined);
  s.put(rec({ branch: "lm/a" }));
  s.put(rec({ branch: "lm/b" }));
  assert.equal(s.active()!.branch, "lm/b");
  s.put(rec({ branch: "lm/a", rejections: 1 })); // re-activated: newest
  assert.equal(s.active()!.branch, "lm/a");
  s.put(rec({ branch: "lm/a", state: "merged" }));
  assert.equal(s.active()!.branch, "lm/b"); // a's newest record is not active any more
  s.put(rec({ branch: "lm/b", state: "abandoned" }));
  assert.equal(s.active(), undefined);
  s.put(rec({ repo: "/r/y", branch: "lm/b" })); // another repository's branch of the same name
  assert.deepEqual([s.active()!.repo, s.get("/r/x", "lm/b")!.state], ["/r/y", "abandoned"]);
});

test("rebuild from the entries reproduces all() and active() — property over random put sequences", () => {
  const rnd = seeded(2026);
  for (let round = 0; round < 60; round++) {
    const { s, entries } = store();
    const puts = 1 + rnd(25);
    for (let i = puts; i > 0; i--) {
      s.put(rec({
        repo: `/r/${"xyz"[rnd(3)]}`, branch: `lm/${"abcd"[rnd(4)]}`, state: BRANCH_STATES[rnd(BRANCH_STATES.length)]!,
        rejections: rnd(4), fixerRuns: rnd(3), ...(rnd(2) ? { goal: `g${rnd(9)}` } : {}), ...(rnd(2) ? { plan: { slug: "p", id: `t${rnd(3)}` } } : {}),
      }));
    }
    assert.equal(entries.length, puts, `round ${round}`);
    assert.ok(s.all().length > 0);
    const back = createBranchStore(() => assert.fail("rebuild appends nothing"));
    back.rebuild(entries.map((e) => entry(e.data)));
    assert.deepEqual(back.all(), s.all(), `round ${round}`);
    assert.deepEqual(back.active(), s.active(), `round ${round}`);
  }
});

test("rebuild replaces what was there and ignores other entries and malformed records", () => {
  const { s } = store();
  s.put(rec({ branch: "lm/old" }));
  s.rebuild([
    { type: "custom", customType: "task-router/budget", data: { opusUsed: 1, steerUsed: 0 } },
    entry({ repo: "/r/x", branch: "lm/bad" }),
    entry({ ...rec({ branch: "lm/bad2" }), state: "weird" }),
    entry({ ...rec({ branch: "lm/bad3" }), rejections: -1 }),
    entry({ ...rec({ branch: "lm/bad4" }), plan: { slug: 1, id: "x" } }),
    entry({ ...rec({ branch: "lm/bad5" }), goal: 5 }),
    entry(null), null, "text", {},
    entry(rec({ branch: "lm/good" })),
  ]);
  assert.deepEqual(s.all().map((r) => r.branch), ["lm/good"]);
  s.rebuild([]);
  assert.deepEqual(s.all(), []);
  assert.equal(s.active(), undefined);
});

test("facts: the main checkout and the registered worktrees per repository start empty", () => {
  const { s } = store();
  assert.deepEqual([s.facts.mainCheckout.size, s.facts.worktrees.size], [0, 0]);
});

// Review F8: a rejection, a fixer's start, its report or death do not change which branch is active (start_branch does), and a
// branch the router did not make (D40) is never the active one.
test("review F8: update keeps a record's place in the active order; a rebuild agrees", () => {
  const { s, entries } = store();
  s.put(rec({ branch: "lm/a" }));
  s.put(rec({ branch: "lm/b" }));
  s.update(rec({ branch: "lm/a", rejections: 1 }));
  assert.equal(s.active()!.branch, "lm/b");
  assert.equal(s.get("/r/x", "lm/a")!.rejections, 1);
  s.update(rec({ branch: "lm/b", state: "fixer", fixer: "fixer-1" }));
  assert.equal(s.active()!.branch, "lm/a");
  s.update(rec({ branch: "lm/b" })); // the fixer's report: lm/b is newer, so it is the active one again, as before
  assert.equal(s.active()!.branch, "lm/b");
  assert.deepEqual(entries.map((e) => e.type), Array(5).fill(BRANCH_TYPE));
  const back = createBranchStore(() => assert.fail("rebuild appends nothing"));
  back.rebuild(entries.map((e) => entry(e.data)));
  assert.deepEqual(back.all(), s.all());
  assert.equal(back.active()!.branch, "lm/b");
  assert.deepEqual(back.get("/r/x", "lm/a"), rec({ branch: "lm/a", rejections: 1 }), "the record as stored, without the order mark");
});

test("review F8: update of an unknown record adds it; a hand-made record is never active() or latest()", () => {
  const { s } = store();
  s.update(rec({ branch: "hand", handmade: true }));
  assert.equal(s.active(), undefined);
  assert.equal(s.latest(["active"]), undefined);
  s.update(rec({ branch: "hand", handmade: true, state: "fixer", fixer: "fixer-1" }));
  assert.equal(s.latest(["fixer"]), undefined);
  assert.equal(s.get("/r/x", "hand")!.handmade, true);
  s.put(rec({ branch: "lm/a" }));
  assert.equal(s.active()!.branch, "lm/a");
});

test("rebuild reproduces all() and active() over random puts and updates (review F8)", () => {
  const rnd = seeded(2027);
  for (let round = 0; round < 60; round++) {
    const { s, entries } = store();
    for (let i = 1 + rnd(25); i > 0; i--) {
      const r = rec({ branch: `lm/${"abcd"[rnd(4)]}`, state: BRANCH_STATES[rnd(BRANCH_STATES.length)]!, rejections: rnd(4), ...(rnd(4) === 0 ? { handmade: true as const } : {}) });
      if (rnd(2)) s.put(r); else s.update(r);
    }
    const back = createBranchStore(() => assert.fail("rebuild appends nothing"));
    back.rebuild(entries.map((e) => entry(e.data)));
    assert.deepEqual(back.all(), s.all(), `round ${round}`);
    assert.deepEqual(back.active(), s.active(), `round ${round}`);
  }
});
