// Pure: the `plans` setting (design §9.2) — billing class, quota windows and local rate per provider name.
// One definition (plan P22): the analyser and the experiments engine import these types from here.
export type Billing = "subscription" | "api" | "free" | "local";
export type Rate = { amount: number; currency: string; per: "hour" };
export type Plan = { billing: Billing; windows: ("5h" | "7d")[]; rate?: Rate };
export type Plans = Readonly<Record<string, Plan>>;

const BILLINGS: readonly Billing[] = ["subscription", "api", "free", "local"];
const WINDOWS: readonly string[] = ["5h", "7d"];

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** No usable plan entry: the setting is missing or empty, or every entry was dropped. The one meaning of "plans absent" (Budget, Experiments). */
export const plansAbsent = (plans: Plans | undefined): boolean => plans === undefined || Object.keys(plans).length === 0;

/** The provider's billing class; a provider without a plan counts as "api". */
export function billingOf(plans: Plans, provider: string): Billing {
  return Object.hasOwn(plans, provider) ? plans[provider]!.billing : "api";
}

function parseRate(raw: unknown): Rate | undefined {
  if (!isObject(raw)) return undefined;
  const { amount, currency, per = "hour" } = raw;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return undefined;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency) || per !== "hour") return undefined;
  return { amount, currency, per };
}

/**
 * Tolerant: a plan without a known `billing` is dropped; unknown windows and a malformed rate are left out, and so
 * is a rate on any class but "local" (the Nix module rejects that by an assertion).
 */
export function parsePlans(raw: unknown): Plans {
  const out: Record<string, Plan> = {};
  if (!isObject(raw)) return out;
  for (const [provider, p] of Object.entries(raw)) {
    if (!isObject(p) || !BILLINGS.includes(p.billing as Billing)) continue;
    const plan: Plan = { billing: p.billing as Billing,
      windows: Array.isArray(p.windows) ? p.windows.filter((w): w is "5h" | "7d" => typeof w === "string" && WINDOWS.includes(w)) : [] };
    const rate = plan.billing === "local" ? parseRate(p.rate) : undefined;
    if (rate) plan.rate = rate;
    out[provider] = plan;
  }
  return out;
}

const isBilling = (b: unknown): b is Billing => BILLINGS.includes(b as Billing);
/** A line's billing class: its own `billing` (meter v2) when valid, else its provider's in `plans` (api without a plan). */
export const billingOfLine = (l: any, plans: Plans): Billing => (isBilling(l.billing) ? l.billing : billingOf(plans, String(l.provider)));
/** The class of a line was told (its own `billing`, or its provider's plan) rather than guessed. */
export const billingTold = (l: any, plans: Plans): boolean => isBilling(l.billing) || Object.hasOwn(plans, String(l.provider));
