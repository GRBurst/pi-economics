// The per-model price table (redesign M4, M2a review carry-over): token prices of the Claude models as pi's model registry lists them,
// and the ratios (weights) the analyser derives from them. Pure data and one lookup.

/** Relative token prices (Anthropic list): read 0.1, 5-minute write 1.25, 1 h write 2.0, output 5 × input: the ratios of a model without an entry. */
export const WEIGHT = { input: 1, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2.0, output: 5 } as const;
export type Weights = { [K in keyof typeof WEIGHT]: number };

/** $ per million tokens: `cacheWrite` is the 5-minute write; pi-ai prices a 1 h write at 2 × input whatever the model. */
export type ListPrice = { input: number; output: number; cacheRead: number; cacheWrite: number };

/**
 * pi 1.4.0's model registry, the `anthropic` provider's entries (pi-ai `cost`; verified against the registry of the locked pi). The registry's
 * price depends on the provider: the cloudflare-ai-gateway, opencode and radius entries list claude-sonnet-5-5 reads at 0.2 $/Mtok, the anthropic
 * provider at 0.1 (a regression of a real log's logged cost agrees with 0.1), so the table is keyed by provider first. pi is a compiled binary, so
 * it is copied, not read at run time: regenerate it when pi's pin moves. A tiered model (claude-haiku-5-5 above 100k tokens) prices a long prompt
 * at the tier's prices; the tiers keep the base ratios (0.1 / 1.25 / 5), so the split of a line is unaffected. A provider or model without an
 * entry gets WEIGHT; a line without a provider is looked up in the anthropic table by model alone.
 */
export const LIST: Readonly<Record<string, Readonly<Record<string, ListPrice>>>> = {
  anthropic: {
    "claude-fable-5": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
    "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
    "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    "claude-opus-4-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    "claude-opus-4-5-20251101": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    "claude-sonnet-4-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    "claude-sonnet-4-5-20250929": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  },
};

/** The weights (price ÷ input price) of a model id of a provider: from LIST, else WEIGHT. `provider` undefined = a line that names none: the anthropic table by model. */
export function weightsOf(model: unknown, provider?: unknown): Weights {
  const table = provider === undefined ? "anthropic" : provider;
  if (typeof model !== "string" || typeof table !== "string" || !Object.hasOwn(LIST, table) || !Object.hasOwn(LIST[table]!, model)) return WEIGHT;
  const p = LIST[table]![model]!, ratio = (x: number): number => Math.round((x / p.input) * 1e9) / 1e9; // 0.2 ÷ 4 is 0.05 exactly, 0.01 ÷ 0.1 is not
  return { input: 1, cacheRead: ratio(p.cacheRead), cacheWrite5m: ratio(p.cacheWrite), cacheWrite1h: WEIGHT.cacheWrite1h, output: ratio(p.output) };
}
