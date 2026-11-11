// Local mode L4.T5 (plan S17, design §3.2.3–§3.2.4): the JSON-schema subset of the submit tools' parameters, checked
// by the router itself (the actor passes `parameters` to the model only). Pure. A value of the wrong type gets that
// reason only; otherwise every violation gets one reason, prefixed with its JSON path.

export type Schema = {
  type?: "object" | "array" | "string" | "boolean" | "number"; enum?: readonly unknown[]; pattern?: string;
  maxLength?: number; minItems?: number; maxItems?: number; items?: Schema; properties?: Record<string, Schema>;
  required?: readonly string[]; additionalProperties?: false; description?: string;
};

const isType: Record<NonNullable<Schema["type"]>, (v: unknown) => boolean> = {
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  array: Array.isArray,
  string: (v) => typeof v === "string",
  boolean: (v) => typeof v === "boolean",
  number: (v) => typeof v === "number" && Number.isFinite(v),
};

const patterns = new Map<string, RegExp>();
const regex = (p: string): RegExp => {
  let r = patterns.get(p);
  if (!r) patterns.set(p, (r = new RegExp(p, "u")));
  return r;
};

/** Reasons, one per violation, each prefixed with its JSON path ("$.findings[2].id: must match ^F[0-9]{1,2}$"). */
export function check(s: Schema, v: unknown, at = "$"): string[] {
  if (s.type && !isType[s.type](v)) return [`${at}: must be ${s.type}`];
  if (s.enum && !s.enum.includes(v)) return [`${at}: must be one of ${s.enum.join(", ")}`];
  const out: string[] = [];
  if (typeof v === "string") {
    if (s.maxLength !== undefined && [...v].length > s.maxLength) out.push(`${at}: must be at most ${s.maxLength} characters`);
    if (s.pattern !== undefined && !regex(s.pattern).test(v)) out.push(`${at}: must match ${s.pattern}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) out.push(`${at}: must have at least ${s.minItems} items`);
    if (s.maxItems !== undefined && v.length > s.maxItems) out.push(`${at}: must have at most ${s.maxItems} items`);
    if (s.items) v.forEach((x, i) => out.push(...check(s.items!, x, `${at}[${i}]`)));
  } else if (s.type === "object") {
    const o = v as Record<string, unknown>, props = s.properties ?? {};
    for (const k of s.required ?? []) if (!Object.hasOwn(o, k)) out.push(`${at}.${k}: is required`);
    for (const [k, x] of Object.entries(o)) {
      if (Object.hasOwn(props, k)) out.push(...check(props[k]!, x, `${at}.${k}`));
      else if (s.additionalProperties === false) out.push(`${at}.${k}: is not allowed`);
    }
  }
  return out;
}
