// Reading experiments/state.json before it is rewritten (review L1): the writers merge into it, so a file that exists but does not
// parse must stop them; an absent one is an empty state.
import { readFileSync } from "node:fs";

/** The parsed state object; {} when the file is absent; throws (message names the file) when it is not valid JSON or no object. */
export function readState(file: string): any {
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch (e: any) { if (e?.code === "ENOENT") return {}; throw e; }
  let v: unknown;
  try { v = JSON.parse(text); } catch { throw new Error(`${file} exists but is not valid JSON: not rewriting it (fix or remove it first)`); }
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error(`${file} exists but holds no JSON object: not rewriting it (fix or remove it first)`);
  return v;
}
