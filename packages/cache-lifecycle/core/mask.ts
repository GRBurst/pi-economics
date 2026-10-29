// Masking plan: which stale entries the first request after cache expiry elides.
// Pure; ./messages.ts maps pi messages to entries and applies the masks.

export type Entry = { id: string; role: string; kind: "toolResult" | "thinking" | "other"; tokens: number };
export type MaskSet = ReadonlySet<string>;
export type Include = "tools" | "thinking";

const kindOf: Record<Include, Entry["kind"]> = { tools: "toolResult", thinking: "thinking" };

/**
 * Masks of the transcript so far, extended: the entries older than the newest
 * `tailTokens` whose kind is included. Only ever grows (result ⊇ existing), so a
 * request that follows a masked one repeats its prefix byte for byte.
 */
export function planMasks(entries: Entry[], existing: MaskSet, tailTokens: number, include: Include[]): MaskSet {
  const eligible = new Set(include.map((i) => kindOf[i]));
  const out = new Set(existing);
  let tail = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (tail >= tailTokens) {
      if (eligible.has(entries[i].kind)) out.add(entries[i].id);
    } else tail += entries[i].tokens;
  }
  return out;
}

export const STUB_PREFIX = "[elided after cache expiry:";

/** Replacement text for an elided tool result; `id` is `tool:<toolCallId>`. */
export function stub(id: string, tokens: number, toolName = "unknown"): string {
  return `${STUB_PREFIX} ${tokens} tok; tool ${toolName} call ${id.replace(/^tool:/, "")}; re-run if needed]`;
}
