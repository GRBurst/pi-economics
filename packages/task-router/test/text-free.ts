// AC-L2 property helper (plan S30): a text-free outcome line holds no free text. Every string value (an array's items too)
// is an enum value, a sha/hex id, or an id/branch/model reference without spaces; generated inputs put spaces and fences
// into every free text, so none can pass.
const HEX = /^[0-9a-f]{7,64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._\/:-]{0,99}$/;

/** The `key: value` pairs of `line` that could be free text (empty: the line is text-free). */
export function textFree(line: Record<string, unknown>, enums: ReadonlySet<string> = new Set()): string[] {
  const bad: string[] = [];
  for (const [k, v] of Object.entries(line))
    for (const x of Array.isArray(v) ? v : [v])
      if (typeof x === "string" && !enums.has(x) && !HEX.test(x) && !ID.test(x)) bad.push(`${k}: ${x}`);
  return bad;
}
