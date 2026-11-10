import { readFileSync, writeFileSync } from "node:fs";
const MATH = {
  "LLM Routing for Coding Agents.md": {
    1: String.raw`P(\text{correct}) \in [0,1]`, 2: "N > 2",
    3: String.raw`\text{Complexity} = 0.35\,s_{\text{creativity}} - 0.25\,s_{\text{reasoning}} + 0.15\,s_{\text{constraints}} + 0.15\,s_{\text{domain}} - 0.05\,s_{\text{context}} + 0.05\,s_{\text{few\_shot}}`,
    4: String.raw`N \geq 2`, 5: String.raw`P(\text{Strong} \succ \text{Weak}) \in [0,1]`, 6: String.raw`\tau`, 7: "N = 2", 8: "d", 9: "T",
    10: String.raw`\alpha`, 11: String.raw`P(\text{strong} \succ \text{weak})`, 12: String.raw`< 0.1\,\text{ms}`, 13: String.raw`s_{\text{reasoning}} > 0.75`,
  },
  "Local Model Coding Orchestration Research.md": {
    1: String.raw`\tau^2`, 2: String.raw`\rightarrow`, 3: "K", 4: String.raw`N \geq 2`, 5: String.raw`T_{\leq K}`, 6: "N", 7: String.raw`N\times`,
  },
  "Strong Model Oversight for Agents.md": {
    1: "k = 5", 2: "k", 3: "N - 4", 4: "N", 5: String.raw`H_t = \mathrm{SHA256}(\text{Tool} \parallel \text{Args}_t)`,
    6: "H_t = H_{t-1} = H_{t-2}", 7: String.raw`\Delta_{\text{tree}} = \mathrm{Hash}(\text{Tree}_t) \oplus \mathrm{Hash}(\text{Tree}_{t-1})`,
    8: String.raw`A \rightarrow B \rightarrow A \rightarrow B`, 9: "W_{10}", 10: String.raw`\mathrm{Sim}(\text{stderr}_t, \text{stderr}_{t-1}) \geq 0.92`,
    11: String.raw`> 85\%`, 12: String.raw`\geq 25`,
  },
};
// Version numbers with a citation glued on (checked by hand): "4.03" = "4.0" + [3].
const VERSIONS = [["CC BY 4.03 ", "CC BY 4.0[^3] "], ["CC BY-NC 4.033 ", "CC BY-NC 4.0[^33] "], ["Apache 2.014 ", "Apache 2.0[^14] "],
  ["Apache 2.017 ", "Apache 2.0[^17] "], ["Apache 2.022 ", "Apache 2.0[^22] "], ["Terminal-Bench 2.021 ", "Terminal-Bench 2.0[^21] "],
  ["Claude Opus 4.83", "Claude Opus 4.8[^3]"], ["Claude Opus 4.86", "Claude Opus 4.8[^6]"], ["Terminal-Bench 2.16", "Terminal-Bench 2.1[^6]"]];
const KEEP = /^(AVX2|DDR5|EXL2|FP32|INT8|R1|v3|Qwen3|SHA256)$/; // digits that belong to the word
const unesc = (s) => s.replace(/\\([-+~.:=!])/g, "$1").replace(/(\w)\\_(?=\w)/g, "$1_");
for (const [f, math] of Object.entries(MATH)) {
  let t = readFileSync(f, "utf8").replace(/\r/g, "");
  t = t.replace(/\n*\[image\d+\]: <data:image[^>]*>\n*/g, "\n");
  t = t.replace(/!\[\]\[image(\d+)\]/g, (_, n) => { if (!math[n]) throw new Error(`${f} image${n}`); return `$${math[n]}$`; });
  t = t.replace(/\$([^$\n]+)\$\\-/g, "$$$1$$-");
  const cut = t.indexOf("#### **Works cited**");
  let body = t.slice(0, cut), refs = t.slice(cut);
  const nrefs = (refs.match(/^> \d+\. /gm) || []).length;
  for (const [a, b] of VERSIONS) body = body.split(a).join(b);
  // A citation: 1–2 digits glued to a word, ")" , "%" or "*", followed by punctuation, space, "|" or end of line.
  body = body.split("\n").map((line) => line.replace(/(\$[^$]*\$)|([A-Za-z0-9_.-]*[A-Za-z)%*])(\d{1,2})(?=[,.;:)]?(?: |\||$))/g,
    (m, mathSpan, word, d) => {
      if (mathSpan) return m;
      const tail = (word.match(/[A-Za-z]+$/) || [""])[0] + d;
      if (KEEP.test(tail) || +d < 1 || +d > nrefs) return m;
      return `${word}[^${+d}]`;
    })).join("\n");
  body = unesc(body).replace(/^(#+) \*\*(.*)\*\*\s*$/gm, "$1 $2");
  refs = refs.replace("#### **Works cited**", "## Works cited")
    .replace(/^> (\d+)\. (.*?), \[[^\]]*\]\(([^)]+)\)\s*$/gm, (_, n, title, url) => `[^${n}]: ${unesc(title)}, <${url}>`);
  writeFileSync(f, (body + refs).replace(/\n{3,}/g, "\n\n").trimEnd() + "\n");
  const cites = new Set([...body.matchAll(/\[\^(\d+)\]/g)].map((m) => +m[1]));
  const missing = [...Array(nrefs).keys()].map((i) => i + 1).filter((i) => !cites.has(i));
  console.log(f, "refs", nrefs, "cited", cites.size, "uncited", missing.join(","), "left >", (refs.match(/^> /gm) || []).length);
}
