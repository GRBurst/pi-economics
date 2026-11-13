// Drives the patched index.ts through its event handlers, with pi's packages stubbed (see stubs/).
// What is under test is this repository's side of it: the settings file the Home Manager module
// writes (rules per provider or model) sets each model's reminders, and a settings record that
// pi-economics appends before the session starts (the seed) holds the branch's draw.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import infiniteContext from "./index.ts";

type Entry = Record<string, unknown> & { id: string; type: string };
type Handler = (event: any, ctx: any) => Promise<any>;

const MILLION = 1_000_000;
const opus = { provider: "anthropic", id: "claude-opus-5-5" };
const haiku = { provider: "anthropic", id: "claude-haiku-5" };
const other = { provider: "example", id: "model-a" };
// As modules/infinite-context.nix renders it: an exact model, a provider with a range.
const owner = {
  overrides: {
    "anthropic/claude-opus-5-5": { nudgeAtTokens: 400_000 },
    anthropic: { nudgeAtTokens: [100_000, 200_000], nudgeAtPercent: 50 },
  },
};

/** The extension on a fresh agent dir holding `settings` (undefined: no file). */
function harness(settings: unknown, initial: Entry[] = []) {
  const dir = mkdtempSync(path.join(tmpdir(), "ic-integration-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  const file = path.join(dir, "infinite-context", "settings.json");
  if (settings !== undefined) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(settings));
  }
  const entries: Entry[] = [...initial];
  const handlers = new Map<string, Handler[]>();
  const sent: any[] = [];
  const notifications: Array<[string, string]> = [];
  const state = { model: opus as unknown, usage: { contextWindow: MILLION, tokens: 0 } };
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    registerTool() {},
    appendEntry(customType: string, data: unknown) {
      entries.push({ type: "custom", id: `state-${entries.length}`, customType, data });
    },
    sendMessage: (message: unknown) => sent.push(message),
  };
  const ctx = {
    get model() {
      return state.model;
    },
    sessionManager: {
      getBranch: () =>
        entries.map((entry, i) => ({ ...entry, parentId: i === 0 ? entry.parentId ?? null : entries[i - 1].id })),
      buildSessionProjection: () => ({
        entries: entries.filter((e) => e.type === "message").map((e) => ({ sourceEntry: e, messages: [e.message] })),
      }),
      getSessionFile: () => "/sessions/s.jsonl",
    },
    ui: { notify: (text: string, level: string) => notifications.push([level, text]), setStatus() {} },
    abort() {},
    getContextUsage: () => state.usage,
  };
  infiniteContext(pi as never);
  const emit = async (name: string, event: unknown = {}) => {
    let result: unknown;
    for (const handler of handlers.get(name) ?? []) result = await handler(event, ctx);
    return result;
  };
  /** A continuing tool turn at `tokens` of the model's window. */
  const turn = async (tokens: number, window = MILLION) => {
    state.usage = { contextWindow: window, tokens };
    await emit("turn_end", { message: { stopReason: "toolUse" }, toolResults: [{ toolName: "bash" }] });
  };
  const records = () => entries.filter((e) => e.customType === "infinite-context:settings").map((e) => e.data);
  return { entries, sent, notifications, state, emit, turn, records };
}

const user = (id: string, text: string): Entry => ({
  type: "message",
  id,
  parentId: null,
  message: { role: "user", content: text, timestamp: 1 },
});

test("the module's rules set each model's reminders; the step stays upstream's", async () => {
  const h = harness(owner, [user("u1", "one")]);
  await h.emit("session_start");
  await h.turn(399_999);
  await h.turn(400_000);
  await h.turn(415_000);
  assert.deepEqual(
    h.sent.map((m) => m.details),
    [
      { band: 400_000, tokens: 400_000, window: MILLION, threshold: 400_000, step: 15_000 },
      { band: 415_000, tokens: 415_000, window: MILLION, threshold: 400_000, step: 15_000 },
    ],
  );
  assert.equal(h.sent[0].customType, "infinite-context/nudge");
  // Each field on its own: the exact model's limit, the provider's percentage.
  assert.deepEqual(h.records(), [{ nudgeAtTokens: 400_000, nudgeAtPercent: 50, rule: "anthropic/claude-opus-5-5" }]);

  // The provider's rule: its percentage of a 128k window comes before its drawn limit.
  h.state.model = haiku;
  await h.emit("model_select", { model: haiku, previousModel: opus, source: "set" });
  await h.turn(63_999, 128_000);
  await h.turn(64_000, 128_000);
  assert.equal(h.sent.at(-1).details.threshold, 64_000);
  const drawn = h.records().at(-1) as Record<string, unknown>;
  assert.deepEqual({ ...drawn, nudgeAtTokens: 0 }, {
    nudgeAtTokens: 0,
    nudgeAtPercent: 50,
    nudgeAtTokensRange: [100_000, 200_000],
    rule: "anthropic",
  });
  assert.ok((drawn.nudgeAtTokens as number) >= 100_000 && (drawn.nudgeAtTokens as number) <= 200_000);

  // A model without a rule: upstream's defaults, no rule named.
  h.state.model = other;
  await h.turn(10_000);
  assert.deepEqual(h.records().at(-1), { nudgeAtTokens: 150_000, nudgeAtPercent: 75 });
  assert.deepEqual(h.notifications, []);
});

test("without a settings file upstream's defaults apply and the record has upstream's shape", async () => {
  const h = harness(undefined, [user("u1", "one")]);
  await h.emit("session_start");
  await h.turn(149_999);
  assert.equal(h.sent.length, 0);
  await h.turn(150_000);
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.records(), [{ nudgeAtTokens: 150_000, nudgeAtPercent: 75 }]);
});

test("pi-economics' seed: a record with the rule's range, appended before session_start, holds the draw", async () => {
  const seed: Entry = {
    type: "custom",
    id: "seed",
    customType: "infinite-context:settings",
    data: { nudgeAtTokens: 123_456, nudgeAtTokensRange: [100_000, 200_000], rule: "anthropic" },
  };
  const h = harness(owner, [user("u1", "one"), seed]);
  h.state.model = haiku;
  await h.emit("session_start");
  await h.turn(123_455);
  assert.equal(h.sent.length, 0);
  await h.turn(123_456);
  assert.equal(h.sent[0].details.threshold, 123_456);
  assert.deepEqual(h.records().at(-1), {
    nudgeAtTokens: 123_456,
    nudgeAtPercent: 50,
    nudgeAtTokensRange: [100_000, 200_000],
    rule: "anthropic",
  });
});
