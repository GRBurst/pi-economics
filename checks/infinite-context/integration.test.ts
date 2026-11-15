// Drives upstream's index.ts through its event handlers, with pi's packages stubbed (see stubs/).
// What is under test is this repository's side of it: the settings file the Home Manager module
// writes (the top level for every model, `modelOverrides` for an exact provider/id) sets each
// model's reminders, a key without '/' matches no model (why the module rejects one), and a
// settings record that pi-economics appends before the extension resolves (the seed: no
// nudgeAtPercent, no other field) holds the branch's draw.
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
const local = { provider: "example", id: "model-a" };
const other = { provider: "example", id: "model-b" };
// As modules/infinite-context.nix renders it: a top level for every model, one exact model with a range.
const owner = {
  nudgeAtTokens: 400_000,
  nudgeAtPercent: 50,
  modelOverrides: {
    "example/model-a": { nudgeAtTokens: [100_000, 200_000] },
  },
};

/** The extension on a fresh agent dir holding `settings` (undefined: no file). */
function harness(settings: unknown, initial: Entry[] = [], early: Handler[] = []) {
  const dir = mkdtempSync(path.join(tmpdir(), "ic-integration-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  const file = path.join(dir, "infinite-context", "settings.json");
  if (settings !== undefined) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(settings));
  }
  const entries: Entry[] = [...initial];
  const handlers = new Map<string, Handler[]>([["model_select", early]]);
  const sent: any[] = [];
  const notifications: Array<[string, string]> = [];
  const state = { model: opus as unknown, usage: { contextWindow: MILLION, tokens: 0 } };
  const pi = {
    on(name: string, handler: Handler) {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    },
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
  /** pi's model switch: the model changes, then model_select fires. */
  const select = async (model: unknown) => {
    const previousModel = state.model;
    state.model = model;
    await emit("model_select", { model, previousModel, source: "set" });
  };
  /** A continuing tool turn at `tokens` of the model's window. */
  const turn = async (tokens: number, window = MILLION) => {
    state.usage = { contextWindow: window, tokens };
    await emit("turn_end", { message: { stopReason: "toolUse" }, toolResults: [{ toolName: "bash" }] });
  };
  const records = () => entries.filter((e) => e.customType === "infinite-context:settings").map((e) => e.data);
  return { entries, sent, notifications, state, emit, select, turn, records };
}

const user = (id: string, text: string): Entry => ({
  type: "message",
  id,
  parentId: null,
  message: { role: "user", content: text, timestamp: 1 },
});

test("the module's file sets each model's reminders: the top level, an exact modelOverrides key; the step stays upstream's", async () => {
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
  // The top level, both fields: the record has upstream's shape and nothing else.
  assert.deepEqual(h.records(), [{ nudgeAtTokens: 400_000, nudgeAtPercent: 50 }]);

  // The exact model's range, the top level's percentage: of a 128k window it comes before the drawn limit.
  await h.select(local);
  await h.turn(63_999, 128_000);
  await h.turn(64_000, 128_000);
  assert.equal(h.sent.at(-1).details.threshold, 64_000);
  const drawn = h.records().at(-1) as Record<string, unknown>;
  assert.deepEqual({ ...drawn, nudgeAtTokens: 0 }, { nudgeAtTokens: 0, nudgeAtPercent: 50, nudgeAtTokensRange: [100_000, 200_000] });
  assert.ok((drawn.nudgeAtTokens as number) >= 100_000 && (drawn.nudgeAtTokens as number) <= 200_000);

  // Another model of the same provider has no key of its own: the top level again.
  await h.select(other);
  assert.deepEqual(h.records().at(-1), { nudgeAtTokens: 400_000, nudgeAtPercent: 50 });
  // Back to the model with the range: its earlier draw holds.
  await h.select(local);
  assert.deepEqual(h.records().at(-1), drawn);
  assert.equal(h.records().length, 4);
  assert.deepEqual(h.notifications, []);
});

test("a modelOverrides key without '/' matches no model: the top level, else upstream's defaults, apply", async () => {
  const h = harness({ modelOverrides: { anthropic: { nudgeAtTokens: 100_000, nudgeAtPercent: 10 }, example: { nudgeAtTokens: [100_000, 200_000] } } }, [user("u1", "one")]);
  h.state.model = haiku;
  await h.emit("session_start");
  await h.select(local);
  assert.deepEqual(h.records(), [{ nudgeAtTokens: 150_000, nudgeAtPercent: 75 }]);
  const top = harness({ nudgeAtTokens: 300_000, modelOverrides: { anthropic: { nudgeAtTokens: 100_000 } } }, [user("u1", "one")]);
  await top.emit("session_start");
  assert.deepEqual(top.records(), [{ nudgeAtTokens: 300_000, nudgeAtPercent: 75 }]);
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

test("pi-economics' seed: a record with the model's range, appended before session_start, holds the draw", async () => {
  const seed: Entry = {
    type: "custom",
    id: "seed",
    customType: "infinite-context:settings",
    data: { nudgeAtTokens: 123_456, nudgeAtTokensRange: [100_000, 200_000] },
  };
  const h = harness(owner, [user("u1", "one"), seed]);
  h.state.model = local;
  await h.emit("session_start");
  await h.turn(123_455);
  assert.equal(h.sent.length, 0);
  await h.turn(123_456);
  assert.equal(h.sent[0].details.threshold, 123_456);
  // The seed lacks nudgeAtPercent: the extension completes it in a record of its own (the engine's read-back).
  assert.deepEqual(h.records(), [seed.data, { nudgeAtTokens: 123_456, nudgeAtPercent: 50, nudgeAtTokensRange: [100_000, 200_000] }]);
});

test("a seed outside the model's range, or for another range, is not kept: the extension draws its own", async () => {
  for (const data of [{ nudgeAtTokens: 250_000, nudgeAtTokensRange: [100_000, 200_000] }, { nudgeAtTokens: 150_000, nudgeAtTokensRange: [100_000, 300_000] }]) {
    const h = harness(owner, [user("u1", "one"), { type: "custom", id: "seed", customType: "infinite-context:settings", data }]);
    h.state.model = local;
    const random = Math.random;
    Math.random = () => 0; // the extension's draw: the range's minimum
    try {
      await h.emit("session_start");
    } finally {
      Math.random = random;
    }
    assert.deepEqual(h.records(), [data, { nudgeAtTokens: 100_000, nudgeAtPercent: 50, nudgeAtTokensRange: [100_000, 200_000] }]);
  }
});

/** The seed pi-economics appends from its own model_select handler, which runs before the extension's. */
function seedAtModelSelect(settings: unknown, data: Record<string, unknown>, initial: Entry[]) {
  let h: ReturnType<typeof harness> | undefined;
  const early: Handler[] = [
    async () => {
      h?.entries.push({ type: "custom", id: "model-seed", customType: "infinite-context:settings", data });
    },
  ];
  h = harness(settings, initial, early);
  return h;
}

test("pi-economics' seed appended at model_select, for another range, replaces the extension's own draw", async () => {
  const seed = { nudgeAtTokens: 123_456, nudgeAtTokensRange: [100_000, 200_000] };
  const h = seedAtModelSelect(owner, seed, [user("u1", "one")]);
  await h.emit("session_start");
  assert.equal(h.records().length, 1);
  await h.select(local);
  assert.deepEqual(h.records(), [
    { nudgeAtTokens: 400_000, nudgeAtPercent: 50 },
    seed,
    { ...seed, nudgeAtPercent: 50 },
  ]);
  await h.turn(123_455);
  assert.equal(h.sent.length, 0);
  await h.turn(123_456);
  assert.equal(h.sent[0].details.threshold, 123_456);
  assert.equal(h.records().length, 3);
});

test("pi-economics' seed appended at model_select, for the same range, replaces the extension's own limit", async () => {
  const both = { modelOverrides: { "example/model-a": { nudgeAtTokens: [100_000, 200_000] }, "example/model-b": { nudgeAtTokens: [100_000, 200_000] } } };
  const seed = { nudgeAtTokens: 111_111, nudgeAtTokensRange: [100_000, 200_000] };
  const h = seedAtModelSelect(both, seed, [user("u1", "one")]);
  h.state.model = local;
  await h.emit("session_start");
  assert.deepEqual((h.records().at(-1) as Record<string, unknown>).nudgeAtTokensRange, [100_000, 200_000]);
  await h.select(other);
  assert.deepEqual(h.records().slice(1), [seed, { ...seed, nudgeAtPercent: 75 }]);
  await h.turn(111_110);
  assert.equal(h.sent.length, 0);
  await h.turn(111_111);
  assert.equal(h.sent[0].details.threshold, 111_111);
});
