// The system state of a request as a short hash (M3b, M2a review carry-over: the `prefix` cause of a cache miss).
// Pure. Replays the request's system messages like pi-ai 1.4's getCurrentSystemMessage (utils/transcript.js): the
// prompt text of every system message in order, named sections replaced or removed (null) in insertion order, tools
// added or removed by name. Equal state ⇔ equal hash (up to collisions of 64 bits); no text enters the meter line.
import { createHash } from "node:crypto";

const isObj = (x: unknown): x is Record<string, any> => typeof x === "object" && x !== null && !Array.isArray(x);

/** pi-ai's contentText: a string, or the text blocks joined by newlines. */
const contentText = (c: unknown): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => isObj(b) && b.type === "text").map((b) => String(b.text)).join("\n") : "";

/** 16 hex digits of sha256 over the replayed system state; undefined without a system message. */
export function systemHash(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  const content: string[] = [];
  const sections = new Map<string, string>();
  const tools = new Map<string, unknown>();
  let any = false;
  for (const m of messages) {
    if (!isObj(m) || m.role !== "system") continue;
    any = true;
    const text = contentText(m.content);
    if (text.length > 0) content.push(text);
    for (const [name, value] of Object.entries(isObj(m.sections) ? m.sections : {})) {
      if (value === null) sections.delete(name);
      else sections.set(name, String(value));
    }
    for (const t of Array.isArray(m.toolsRemoved) ? m.toolsRemoved : []) if (isObj(t)) tools.delete(String(t.name));
    for (const t of Array.isArray(m.toolsAdded) ? m.toolsAdded : [])
      if (isObj(t)) tools.set(String(t.name), [t.name, t.description, t.parameters]);
  }
  if (!any) return undefined;
  const state = JSON.stringify([content.join("\n"), [...sections], [...tools.values()]]);
  return createHash("sha256").update(state).digest("hex").slice(0, 16);
}
