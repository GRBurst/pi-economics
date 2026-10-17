import { test } from "node:test";
import assert from "node:assert/strict";
import { Joiner } from "../core/join.ts";
import type { Snapshot } from "../core/ratelimit.ts";

function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Same provider for every session: a provider-keyed joiner would mix them up.
const snap = (tag: string, at = 0): Snapshot => ({ status: 200, at, headers: { provider: "anthropic", tag } });

test("take() with nothing pending → no snap, zero retries", () => {
  assert.deepEqual(new Joiner().take("s"), { retries: 0, retryWaitMs: 0 });
});

test("onResponse replaces the pending snapshot; take() returns it and clears", () => {
  const j = new Joiner();
  j.onResponse("s", snap("a"));
  j.onResponse("s", snap("b"));
  assert.equal(j.take("s").snap?.headers.tag, "b");
  assert.deepEqual(j.take("s"), { retries: 0, retryWaitMs: 0 });
});

test("interleaved sessions do not see each other's snapshots", () => {
  const j = new Joiner();
  j.onResponse("s1", snap("one"));
  j.onResponse("s2", snap("two"));
  assert.equal(j.take("s2").snap?.headers.tag, "two");
  assert.equal(j.take("s1").snap?.headers.tag, "one");
  assert.equal(j.take("s1").snap, undefined);
});

test("error without usage: take() on a session without snapshot gives none, even if others have one", () => {
  const j = new Joiner();
  j.onResponse("other", snap("x"));
  assert.equal(j.take("errored").snap, undefined);
  assert.equal(j.take("other").snap?.headers.tag, "x");
});

test("retries: start/end pairs by retryId count and sum wait", () => {
  const j = new Joiner();
  j.onRetryStart("s", "r1", 1000);
  j.onRetryEnd("s", "r1", 3500);
  j.onRetryStart("s", "r2", 4000);
  j.onRetryEnd("s", "r2", 4500);
  assert.deepEqual(j.take("s"), { retries: 2, retryWaitMs: 3000 });
  assert.deepEqual(j.take("s"), { retries: 0, retryWaitMs: 0 });
});

test("retries: overlapping ids pair by retryId; cancelled ends count like completed", () => {
  const j = new Joiner();
  j.onRetryStart("s", "a", 0);
  j.onRetryStart("s", "b", 10);
  j.onRetryEnd("s", "b", 30); // 20
  j.onRetryEnd("s", "a", 100); // 100
  assert.deepEqual(j.take("s"), { retries: 2, retryWaitMs: 120 });
});

test("retries: unmatched end and duplicate end are ignored; unfinished start is not counted", () => {
  const j = new Joiner();
  j.onRetryEnd("s", "ghost", 50);
  j.onRetryStart("s", "r", 0);
  j.onRetryEnd("s", "r", 10);
  j.onRetryEnd("s", "r", 99);
  j.onRetryStart("s", "open", 20);
  assert.deepEqual(j.take("s"), { retries: 1, retryWaitMs: 10 });
});

test("retries are per session", () => {
  const j = new Joiner();
  j.onRetryStart("s1", "r", 0);
  j.onRetryEnd("s2", "r", 5); // belongs to another session → unmatched
  j.onRetryEnd("s1", "r", 7);
  assert.deepEqual(j.take("s2"), { retries: 0, retryWaitMs: 0 });
  assert.deepEqual(j.take("s1"), { retries: 1, retryWaitMs: 7 });
});

test("P-join: random interleavings of 3 sessions match a per-session model (300 runs)", () => {
  const r = prng(2026);
  for (let run = 0; run < 300; run++) {
    const j = new Joiner();
    const ids = ["s1", "s2", "s3"];
    const model = new Map(ids.map((id) => [id, { tag: undefined as string | undefined, open: new Map<string, number>(), n: 0, wait: 0 }]));
    for (let step = 0; step < 40; step++) {
      const id = ids[Math.floor(r() * 3)];
      const m = model.get(id)!;
      const op = Math.floor(r() * 4);
      const rid = "r" + Math.floor(r() * 3);
      const at = step * 10;
      if (op === 0) { const tag = `${id}#${step}`; j.onResponse(id, snap(tag, at)); m.tag = tag; }
      else if (op === 1) { j.onRetryStart(id, rid, at); m.open.set(rid, at); }
      else if (op === 2) {
        j.onRetryEnd(id, rid, at);
        const st = m.open.get(rid);
        if (st !== undefined) { m.n++; m.wait += at - st; m.open.delete(rid); }
      } else {
        const got = j.take(id);
        assert.equal(got.snap?.headers.tag, m.tag);
        if (got.snap) assert.ok(got.snap.headers.tag.startsWith(id + "#"));
        assert.equal(got.retries, m.n);
        assert.equal(got.retryWaitMs, m.wait);
        m.tag = undefined; m.n = 0; m.wait = 0; // open retries survive take()
      }
    }
  }
});

test("a retry still open at take() is counted on the next take()", () => {
  const j = new Joiner();
  j.onRetryStart("s", "r1", 1000);
  assert.deepEqual(j.take("s"), { retries: 0, retryWaitMs: 0 });
  j.onRetryEnd("s", "r1", 3000);
  assert.deepEqual(j.take("s"), { retries: 1, retryWaitMs: 2000 });
});

// D8: pi-retry reports `completed` AFTER the retried request's message_end, so a
// non-error message_end must close the open episodes; later end events for the
// closed ids must be ignored (no double count).
test("closeOpen counts every open episode at that time; later ends for closed ids are ignored", () => {
  const j = new Joiner();
  j.onRetryStart("s", "r1", 1000);
  j.onRetryStart("s", "r2", 2000);
  j.closeOpen("s", 5000);
  assert.deepEqual(j.take("s"), { retries: 2, retryWaitMs: 7000 }); // (5000-1000)+(5000-2000)
  j.onRetryEnd("s", "r1", 5100); // late completed for a closed id → ignored
  j.onRetryEnd("s", "r2", 5200);
  assert.deepEqual(j.take("s"), { retries: 0, retryWaitMs: 0 });
});

test("closeOpen on a session with no open retry is a no-op", () => {
  const j = new Joiner();
  j.onResponse("s", snap("x"));
  j.closeOpen("s", 100);
  assert.equal(j.take("s").snap?.headers.tag, "x");
  assert.deepEqual(j.take("s"), { retries: 0, retryWaitMs: 0 });
});

test("closeOpen: a later start for the same id reopens it (numeric ids can be reused)", () => {
  const j = new Joiner();
  j.onRetryStart("s", "1", 0);
  j.closeOpen("s", 100);
  j.onRetryStart("s", "1", 200);
  j.onRetryEnd("s", "1", 400);
  assert.deepEqual(j.take("s"), { retries: 2, retryWaitMs: 300 });
});
