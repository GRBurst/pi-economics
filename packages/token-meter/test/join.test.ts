import { test } from "node:test";
import assert from "node:assert/strict";
import { Joiner } from "../core/join.ts";
import type { Snapshot } from "../core/ratelimit.ts";

// M3a (D19, P18): the retry-id pairing of the retry extension's bus events left with it (its tests too); native retries are
// counted in core/shell.ts (test/shell.test.ts "native retry: …"). What stays is the snapshot join.

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

test("take() with nothing pending → no snap", () => {
  assert.deepEqual(new Joiner().take("s"), {});
});

test("onResponse replaces the pending snapshot; take() returns it and clears", () => {
  const j = new Joiner();
  j.onResponse("s", snap("a"));
  j.onResponse("s", snap("b"));
  assert.equal(j.take("s").snap?.headers.tag, "b");
  assert.deepEqual(j.take("s"), {});
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

test("P-join: random interleavings of 3 sessions match a per-session model (300 runs)", () => {
  const r = prng(2026);
  for (let run = 0; run < 300; run++) {
    const j = new Joiner();
    const ids = ["s1", "s2", "s3"];
    const model = new Map(ids.map((id) => [id, undefined as string | undefined]));
    for (let step = 0; step < 40; step++) {
      const id = ids[Math.floor(r() * 3)]!;
      if (r() < 0.5) { const tag = `${id}#${step}`; j.onResponse(id, snap(tag, step * 10)); model.set(id, tag); }
      else {
        const got = j.take(id);
        assert.equal(got.snap?.headers.tag, model.get(id));
        if (got.snap) assert.ok(got.snap.headers.tag.startsWith(id + "#"));
        model.set(id, undefined);
      }
    }
  }
});
