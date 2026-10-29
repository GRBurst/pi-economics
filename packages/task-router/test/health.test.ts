// The probes of members with a `health` URL (T3.3): one cached probe per URL, TTL 30 s.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createProbes } from "../core/health.ts";

const rig = () => {
  const clock = { t: 1_000_000 };
  const urls: string[] = [];
  const probe = createProbes({ fetch: async (url: string) => { urls.push(url); return { status: 200 }; }, now: () => clock.t });
  return { clock, urls, probe };
};

test("TTL 30 s: calls at +0 and +29 s fetch each path once; +30 s fetches again", async () => {
  const r = rig();
  assert.deepEqual(await r.probe("http://a:1"), { up: true, busy: false });
  r.clock.t += 29_000;
  await r.probe("http://a:1");
  assert.deepEqual(r.urls, ["http://a:1/health", "http://a:1/slots?fail_on_no_slot=1"]);
  r.clock.t += 1_000;
  await r.probe("http://a:1");
  assert.equal(r.urls.length, 4);
});

test("one probe per URL: a second URL is fetched on its own, the first stays cached", async () => {
  const r = rig();
  await r.probe("http://a:1");
  await r.probe("http://b:2");
  await r.probe("http://a:1");
  assert.deepEqual(r.urls, ["http://a:1/health", "http://a:1/slots?fail_on_no_slot=1", "http://b:2/health", "http://b:2/slots?fail_on_no_slot=1"]);
});
