// Maps pi's context messages to masking entries and applies a mask set.
// Message shapes: docs/message-types.md. The `context` event carries no entry
// ids, so ids come from the messages themselves and survive across requests:
//   tool result      tool:<toolCallId>
//   thinking block   think:<responseId>:<blockIndex>   (signed: dropped whole, never edited)
import { STUB_PREFIX, stub, type Entry, type MaskSet } from "./mask.ts";

type Block = { type: string; text?: string; thinking?: string; arguments?: unknown };
type Msg = { role: string; content?: string | Block[]; responseId?: string; toolCallId?: string; toolName?: string };

const blockTokens = (b: Block): number =>
  Math.ceil((b.type === "text" ? (b.text ?? "").length : b.type === "thinking" ? (b.thinking ?? "").length : b.type === "image" ? 4800 : JSON.stringify(b.arguments ?? b).length) / 4);
const tokensOf = (c: Msg["content"]): number => (typeof c === "string" ? Math.ceil(c.length / 4) : (c ?? []).reduce((a, b) => a + blockTokens(b), 0));
const blocks = (m: Msg): Block[] => (Array.isArray(m.content) ? m.content : []);
const isStub = (m: Msg): boolean => blocks(m).length === 1 && (blocks(m)[0].text ?? "").startsWith(STUB_PREFIX);
/** Thinking blocks may only be dropped from a message that keeps another block. */
const dropsThinking = (m: Msg): boolean => m.role === "assistant" && !!m.responseId && blocks(m).some((b) => b.type !== "thinking");

export function entriesOf(messages: Msg[]): Entry[] {
  return messages.flatMap((m, i): Entry[] => {
    if (m.role === "toolResult") return [{ id: `tool:${m.toolCallId}`, role: m.role, kind: "toolResult", tokens: tokensOf(m.content) }];
    const think = dropsThinking(m)
      ? blocks(m).flatMap((b, j): Entry[] => (b.type === "thinking" ? [{ id: `think:${m.responseId}:${j}`, role: m.role, kind: "thinking", tokens: blockTokens(b) }] : []))
      : [];
    const rest = blocks(m).filter((b) => !(think.length && b.type === "thinking")).reduce((a, b) => a + blockTokens(b), 0);
    return [...think, { id: `msg:${i}`, role: m.role, kind: "other", tokens: think.length ? rest : tokensOf(m.content) }];
  });
}

/** Elided copy of `messages`; untouched messages are the same objects. */
export function applyMasks<T extends Msg>(messages: T[], masks: MaskSet): T[] {
  return messages.map((m) => {
    if (m.role === "toolResult" && masks.has(`tool:${m.toolCallId}`) && !isStub(m)) {
      return { ...m, content: [{ type: "text", text: stub(`tool:${m.toolCallId}`, tokensOf(m.content), m.toolName) }] };
    }
    if (!dropsThinking(m)) return m;
    const kept = blocks(m).filter((b, j) => !(b.type === "thinking" && masks.has(`think:${m.responseId}:${j}`)));
    return kept.length === blocks(m).length ? m : { ...m, content: kept };
  });
}
