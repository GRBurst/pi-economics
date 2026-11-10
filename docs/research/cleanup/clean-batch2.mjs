// Adapted from clean.mjs for the three Gemini Deep Research exports (images → LaTeX, citations → footnotes).
import { readFileSync, writeFileSync } from "node:fs";
const DIR = process.argv[2] ?? "./"; // the directory holding the exports
const DRY = process.env.DRY === "1";
const MATH = {
  "Agentic Plan and Code Sizing.md": {
    1: String.raw`> 1.0\times`, 2: String.raw`0.8\times-1.0\times`, 3: String.raw`0.4\times-0.7\times`, 4: String.raw`\geq`,
    5: String.raw`<0.3\times`, 6: String.raw`<0.030`, 7: String.raw`p_{\text{success}}`, 8: String.raw`t`, 9: String.raw`h_{\text{agent}}`,
    10: String.raw`\beta`, 11: String.raw`p_{\text{success}}(\text{agent}, t) = \sigma(\beta(\log h_{\text{agent}} - \log t))`,
    12: String.raw`4\times`, 13: String.raw`6\times`, 14: String.raw`2.2\times`,
  },
  "Frontier Model Plan Review Protocol.md": {
    1: String.raw`D_r = D \times (1 - R_T)`, 2: "D", 3: String.raw`R_T`, 4: String.raw`1.0\times`, 5: String.raw`3.5\times-6.0\times`,
    6: String.raw`10.0\times-15.0\times`, 7: String.raw`25.0\times-40.0\times`, 8: String.raw`60.0\times-100.0\times+`, 9: "p = 0.915",
  },
  "Two-Tier Agent Planning Architecture.md": {
    1: String.raw`\phi_E`, 2: String.raw`\phi_P`, 3: String.raw`T_{\text{repo}}`, 4: String.raw`T_{\text{plan}}`, 5: String.raw`T_{\text{critique}}`,
    6: "i", 7: String.raw`\text{Input Tokens}_i = T_{\text{repo}} + T_{\text{req}} + T_{\text{plan}}^{(0)} + \sum_{j=1}^{i-1}\left(T_{\text{critique}}^{(j)} + T_{\text{plan}}^{(j)}\right)`,
    8: String.raw`P^{(1)}_{\text{pass}} < 0.35`, 9: String.raw`k \approx 1.45`, 10: String.raw`k \approx 1.14`, 11: String.raw`P_{\text{in}}`,
    12: String.raw`\$5.00 \text{ per } 10^6 \text{ tokens}`, 13: String.raw`\$0.000005/\text{token}`, 14: String.raw`P_{\text{out}}`,
    15: String.raw`\$25.00 \text{ per } 10^6 \text{ tokens}`, 16: String.raw`\$0.000025/\text{token}`, 17: String.raw`P_{\text{read}}`,
    18: String.raw`\$0.50 \text{ per } 10^6 \text{ tokens}`, 19: String.raw`0.10 \times P_{\text{in}}`, 20: String.raw`P_{\text{write}}`,
    21: String.raw`\$6.25 \text{ per } 10^6 \text{ tokens}`, 22: String.raw`1.25 \times P_{\text{in}}`, 23: String.raw`C_{\text{local}}`,
    24: String.raw`\approx \$0.001 \text{ per run}`, 25: String.raw`25,000 \text{ tokens}`, 26: String.raw`T_{\text{req}}`,
    27: String.raw`1,000 \text{ tokens}`, 28: String.raw`2,000 \text{ tokens}`, 29: String.raw`600 \text{ tokens}`, 30: "k",
    31: String.raw`k \geq 1.0`,
    32: String.raw`C_B = \frac{(T_{\text{repo}} + T_{\text{req}}) \cdot P_{\text{in}} + T_{\text{plan}} \cdot P_{\text{out}}}{10^6} = \frac{26,000 \cdot \$5.00 + 2,000 \cdot \$25.00}{10^6} = \$0.1800`,
    33: String.raw`C_{B,\text{cached}} = \frac{T_{\text{repo}} \cdot P_{\text{write}} + T_{\text{req}} \cdot P_{\text{in}} + T_{\text{plan}} \cdot P_{\text{out}}}{10^6} = \frac{25,000 \cdot \$6.25 + 1,000 \cdot \$5.00 + 2,000 \cdot \$25.00}{10^6} = \$0.2113`,
    34: String.raw`\$0.0675`, 35: String.raw`C_{\text{local}} \approx \$0`,
    36: String.raw`C_C = \frac{(T_{\text{repo}} - T_{\text{req}} + T_{\text{plan}}) \cdot P_{\text{in}} + T_{\text{plan}} \cdot P_{\text{out}}}{10^6} = \frac{28,000 \cdot \$5.00 + 2,000 \cdot \$25.00}{10^6} = \$0.1900`,
    37: String.raw`C_{C,\text{cached}} = \frac{25,000 \cdot \$6.25 + 3,000 \cdot \$5.00 + 2,000 \cdot \$25.00}{10^6} = \$0.2213`,
    38: String.raw`T_{\text{plan}} \cdot P_{\text{in}} = \$0.0100`, 39: String.raw`T_{\text{critique}} = 600 \text{ tokens}`,
    40: String.raw`C_{A,1} = \frac{28,000 \cdot \$5.00 + 600 \cdot \$25.00}{10^6} = \$0.1550 \quad (\text{Uncached})`,
    41: String.raw`C_{A,1,\text{cached}} = \frac{25,000 \cdot \$6.25 + 3,000 \cdot \$5.00 - 600 \cdot \$25.00}{10^6} = \$0.1863 \quad (\text{Cached Write})`,
    42: "k = 1", 43: String.raw`\$0.0250`, 44: String.raw`\approx 5,600`,
    45: String.raw`\Delta C_{A,2,\text{cached}} = \frac{25,000 \cdot \$0.50 + 5,600 \cdot \$5.00 + 600 \cdot \$25.00}{10^6} = \$0.0125 + \$0.0280 + \$0.0150 = \$0.0555`,
    46: String.raw`C_{A,k=2,\text{cached}} = \$0.1863 + \$0.0555 = \$0.2418`,
    47: String.raw`C_{A,k=2,\text{uncached}} = \$0.1550 + \frac{33,600 \cdot \$5.00 + 600 \cdot \$25.00}{10^6} = \$0.3380`,
    48: "k = 3", 49: String.raw`\$0.3015`, 50: String.raw`\$0.5400`,
    51: String.raw`k_{\text{breakeven}} = 1.0 + \frac{C_B - C_{A,1}}{\Delta C_{A,2}} = 1.0 - \frac{\$0.2113 - \$0.1863}{\$0.0555} \approx 1.45 \text{ rounds (Cached)}`,
    52: String.raw`k_{\text{breakeven}} = 1.0 + \frac{\$0.1800 - \$0.1550}{\$0.1830} \approx 1.14 \text{ rounds (Uncached)}`,
    53: String.raw`85\%`, 54: String.raw`P^{(1)}_{\text{pass}} \geq 0.85`, 55: String.raw`\$0.010`, 56: String.raw`k \geq 1.5`,
    57: String.raw`+\$0.0100`, 58: String.raw`\rightarrow`, 59: String.raw`T_{\text{repo}} \approx 25,000 \text{ tokens}`,
    60: String.raw`T_{\text{req}} \approx 1,000 \text{ tokens}`,
  },
};
// Version numbers with a citation glued on (checked by hand against the reference list).
const VERSIONS = [];
const KEEP = /^(F1|AVX2|DDR5|EXL2|FP32|INT8|R1|v3|Qwen3|SHA256|GPT4|o3|o1|4o|H100|A100|V100|Opus4|Sonnet4|Haiku3|Llama3|Gemma3|Phi3|Python3|ES6|CUDA12|CUDA11|SWEbench|Verified|bench|Terminal)$/;
const unesc = (s) => s.replace(/\\([-+~.:=!])/g, "$1").replace(/(\w)\\_(?=\w)/g, "$1_");
const LOG = [];
const refTitle = (t) => unesc(t).replace(/\\([\[\]|])/g, "$1");
for (const [f, math] of Object.entries(MATH)) {
  let t = readFileSync(DIR + f, "utf8").replace(/\r/g, "");
  t = t.replace(/\n*\[image\d+\]: <data:image[^>]*>\n*/g, "\n");
  const spans = [];
  t = t.replace(/!\[\]\[image(\d+)\]/g, (_, n) => {
    if (!math[n]) throw new Error(`${f} image${n} has no transcription`);
    spans.push(`$${math[n]}$`);
    return `\u0001${spans.length - 1}\u0002`;
  });
  const cut = t.indexOf("#### **Works cited**");
  if (cut < 0) throw new Error(f + " no works cited");
  let body = t.slice(0, cut), refs = t.slice(cut);
  const nrefs = (refs.match(/^> \d+\. /gm) || []).length;
  for (const [a, b] of VERSIONS) body = body.split(a).join(b);
  // Citation glued to a math span: "$6\times$28" -> "$6\times$[^28]".
  body = body.replace(/(\u0002\)?)(\d{1,2})(?=[,.;:)]?(?: |\||$))/gm, (m, pre, d) => {
    if (+d < 1 || +d > nrefs) { LOG.push(`${f}: math-glued ${d} kept: ${m}`); return m; }
    LOG.push(`${f}: math-glued -> [^${d}]`); return `${pre}[^${+d}]`;
  });
  // Citation glued to a word: "models3." -> "models[^3]".
  body = body.split("\n").map((line, li) => line.replace(/([A-Za-z0-9_.-]*[A-Za-z)%]\**)(\d{1,2})(?=[,.;:)]?(?: |\||$))/g,
    (m, word, d) => {
      const tail = (word.match(/[A-Za-z]+$/) || [""])[0] + d;
      if (KEEP.test(tail) || +d < 1 || +d > nrefs) { LOG.push(`${f}:${li + 1}: kept ${m}`); return m; }
      LOG.push(`${f}:${li + 1}: cite ${m} -> ${word}[^${+d}]`);
      return `${word}[^${+d}]`;
    })).join("\n");
  body = unesc(body).replace(/^(#+) \*\*(.*)\*\*\s*$/gm, "$1 $2");
  body = body.replace(/(?<!\\)\$(?=\d)/g, "\\$");           // currency $ in prose
  body = body.replace(/\u0001(\d+)\u0002/g, (_, n) => spans[+n]);
  refs = refs.replace("#### **Works cited**", "## Works cited")
    .replace(/^> (\d+)\. (.*?), \[[^\]]*\]\(([^)]+)\)\s*$/gm, (_, n, title, url) => `[^${n}]: ${refTitle(title)}, <${url}>`)
    .replace(/^> (\d+)\. \[([^\]]*)\]\(([^)]+)\)\s*$/gm, (_, n, title, url) => `[^${n}]: ${refTitle(title)}, <${url}>`);
  const out = (body + refs).replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  const cites = new Set([...out.matchAll(/\[\^(\d+)\]/g)].map((m) => +m[1]));
  const missing = [...Array(nrefs).keys()].map((i) => i + 1).filter((i) => !cites.has(i));
  console.log(f, "refs", nrefs, "cited", cites.size, "uncited", missing.join(","), "left >", (refs.match(/^> /gm) || []).length, "leftover \\u0001", /[\u0001\u0002]/.test(out));
  if (!DRY) writeFileSync(DIR + f, out);
}
console.error(LOG.join("\n"));
