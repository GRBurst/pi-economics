// Drives the patched index.ts through its event handlers, with pi's packages stubbed (see stubs/).
// What is under test is this repository's part of it: the reminder thresholds per model, the
// fold hint, the fold_timing prompt section, the settings record and warning, and the handoff
// that replaces a request whose folds cannot be applied.
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
const owner = {
  reminders: {
    default: {},
    overrides: { "anthropic/claude-opus-5-5": { startTokens: 400_000, everyTokens: 100_000 } },
  },
  prices: { "anthropic/claude-opus-5-5": { w: 5, r: 0.2 } },
};

/** The extension on a fresh agent dir holding `settings` (a string is written as is; undefined: no file). */
function harness(settings: unknown, initial: Entry[] = []) {
  const dir = mkdtempSync(path.join(tmpdir(), "ic-integration-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  const file = path.join(dir, "infinite-context", "settings.json");
  if (settings !== undefined) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, typeof settings === "string" ? settings : JSON.stringify(settings));
  }
  const entries: Entry[] = [...initial];
  const handlers = new Map<string, Handler[]>();
  const sent: any[] = [];
  const notifications: Array<[string, string]> = [];
  const state = { aborted: 0, model: opus as unknown, usage: { contextWindow: MILLION, tokens: 0 } };
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
      getSessionId: () => "session-1",
    },
    ui: { notify: (text: string, level: string) => notifications.push([level, text]) },
    abort: () => void state.aborted++,
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
    await emit("turn_end", { message: { stopReason: "toolUse" }, toolResults: [{}] });
  };
  return { file, entries, sent, notifications, state, emit, turn };
}

const user = (id: string, text: string): Entry => ({
  type: "message",
  id,
  parentId: null,
  message: { role: "user", content: text, timestamp: 1 },
});
const settingsRecords = (h: ReturnType<typeof harness>) =>
  h.entries.filter((e) => e.customType === "infinite-context:settings");

test("reminders follow the model's rule: start, step, and one reminder per threshold", async () => {
  const h = harness(owner);
  await h.emit("session_start");
  await h.turn(399_999);
  await h.turn(400_000);
  await h.turn(450_000);
  await h.turn(500_000);
  assert.deepEqual(
    h.sent.map((m) => m.details),
    [
      { band: 400_000, tokens: 400_000, window: MILLION, threshold: 400_000, step: 100_000 },
      { band: 500_000, tokens: 500_000, window: MILLION, threshold: 400_000, step: 100_000 },
    ],
  );
  assert.match(h.sent[0].content, /Context is ~400k tokens \(40% of the 1000k-token window\)\. Reminders start at 400k tokens and repeat every 100k\./);
  assert.match(h.sent[0].content, /Use context_map, then context_fold/);
  assert.equal(h.sent[0].customType, "infinite-context/nudge");
});

test("a model without a rule keeps the window-relative policy: 75% of the window, every 5%", async () => {
  const h = harness(owner);
  h.state.model = haiku;
  await h.emit("session_start");
  await h.turn(149_999, 200_000);
  await h.turn(150_000, 200_000);
  await h.turn(159_999, 200_000);
  await h.turn(160_000, 200_000);
  assert.deepEqual(h.sent.map((m) => [m.details.threshold, m.details.step, m.details.band]), [
    [150_000, 10_000, 150_000],
    [150_000, 10_000, 160_000],
  ]);
  const none = harness(undefined);
  await none.emit("session_start");
  await none.turn(749_999);
  assert.equal(none.sent.length, 0);
  await none.turn(750_000);
  assert.equal(none.sent.length, 1);
  assert.deepEqual(none.notifications, []);
});

test("the fold hint: cold without a request, the payoff while warm, nothing in fixed mode", async () => {
  const h = harness(owner);
  await h.emit("session_start");
  await h.turn(400_000);
  assert.match(h.sent[0].content, /Fold hint: cache is cold: folding is free now\./);
  await h.emit("after_provider_response", { status: 200 });
  await h.turn(500_000);
  assert.match(h.sent[1].content, /Fold hint: the cache is warm; folding the oldest 75% pays off after ≈ 8 more turns/);
  assert.match(h.sent[1].content, /24 × K\/R/);
  const fixed = harness({ ...owner, foldHint: "fixed" });
  await fixed.emit("session_start");
  await fixed.turn(400_000);
  assert.doesNotMatch(fixed.sent[0].content, /Fold hint/);
});

test("fold_timing is a prompt section: set when cache-aware, removed when fixed, the experiments flag wins", async () => {
  const sections = async (h: ReturnType<typeof harness>) => {
    const event = { systemPromptOptions: { sections: { task_cards: "cards", fold_timing: "stale" } as Record<string, string> } };
    assert.equal(await h.emit("before_agent_start", event), undefined);
    return event.systemPromptOptions.sections;
  };
  const aware = harness(owner);
  await aware.emit("session_start");
  const first = await sections(aware);
  assert.match(first.fold_timing, /^Fold timing: /);
  assert.equal(first.task_cards, "cards");
  const fixed = harness({ ...owner, foldHint: "fixed" });
  await fixed.emit("session_start");
  assert.deepEqual(await sections(fixed), { task_cards: "cards" });
  (globalThis as any).__piExperimentsApi_v1 = { flag: (name: string) => (name === "foldHint" ? "fixed" : undefined) };
  try {
    const flagged = harness(owner);
    await flagged.emit("session_start");
    assert.deepEqual(await sections(flagged), { task_cards: "cards" });
  } finally {
    delete (globalThis as any).__piExperimentsApi_v1;
  }
});

test("an invalid settings file is ignored as a whole with a warning, and the defaults apply", async () => {
  for (const bad of ["not json", JSON.stringify({ ...owner, extra: 1 }), JSON.stringify({ reminders: { default: { startTokens: 0 } } })]) {
    const h = harness(bad);
    await h.emit("session_start");
    assert.equal(h.notifications.length, 1, bad);
    assert.equal(h.notifications[0][0], "warning");
    assert.ok(h.notifications[0][1].includes(h.file), bad);
    assert.match(h.notifications[0][1], /using the built-in reminder thresholds/);
    await h.turn(400_000);
    assert.equal(h.sent.length, 0, "no rule applies");
    await h.turn(750_000);
    assert.equal(h.sent.length, 1);
  }
});

test("each branch records the effective settings once, and again when they change", async () => {
  const h = harness(owner, [user("u1", "one")]);
  await h.emit("session_start");
  await h.emit("session_start", { reason: "reload" });
  assert.equal(settingsRecords(h).length, 1);
  assert.deepEqual(settingsRecords(h)[0].data, {
    nudgeAtPercent: 75,
    reminders: owner.reminders,
    prices: owner.prices,
    cacheTtlMinutes: 5,
    foldHint: "cache-aware",
  });
});

// A branch the archive cannot represent: its first entry points to a parent the file lost.
const lost = (): Entry => ({ ...user("u1", "one"), parentId: "gone" });
const withFolds: Entry = {
  type: "custom",
  id: "snap",
  customType: "infinite-context",
  data: { version: 2, roots: [{ kind: "fold", id: "f1", summary: "s", children: [{ kind: "message", id: "u1" }] }] },
};

test("folds that cannot be applied abort the request with the handoff notice, never the raw transcript", async () => {
  const h = harness(owner, [lost(), withFolds]);
  await h.emit("session_start");
  const request = [{ role: "user", content: "WHOLE-TRANSCRIPT-MARKER", timestamp: 1 }];
  const result = await h.emit("context", { messages: request });
  assert.equal(h.state.aborted, 1);
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0].content, /folds could not be applied .*start a handoff session/);
  assert.ok(!JSON.stringify(result).includes("WHOLE-TRANSCRIPT-MARKER"));
  assert.ok(h.notifications.some(([level, text]) => level === "error" && /folds could not be applied/.test(text)));
});

test("without saved folds the request goes out untouched, as before", async () => {
  const h = harness(owner, [lost()]);
  await h.emit("session_start");
  const result = await h.emit("context", { messages: [{ role: "user", content: "x", timestamp: 1 }] });
  assert.equal(result, undefined);
  assert.equal(h.state.aborted, 0);
});
