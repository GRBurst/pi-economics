// Clean the two new Gemini Deep Research exports (prompts 7 & 8) the way
// docs/research/cleanup.md describes. Usage: node clean.mjs <worktree>
import { readFileSync, writeFileSync } from "node:fs";

const worktree = process.argv[2];
if (!worktree) throw new Error("usage: node clean.mjs <worktree>");

const orig = (n) => `${worktree}/docs/research/originals/${n}.md`;
const outp = (n) => `${worktree}/docs/research/${n}.md`;

// ── formula transcriptions (read from the export's PNGs; see cleanup.md batch 2) ──
const MERGE_IMG = {
  image1: "$\\le 30$",
  image2: "$\\le 2{,}000$",
  image3: "\\$0.10 Input / \\$0.50 Output ($\\le 100k$",
  // closing $: the cell continues " tokens)" in the raw text
  image4: "$\\le 50$",
  image5: "$C^*_{\\mathrm{merge}}$",
  image6: "$S$",
  image7: "$L$",
  image8: "$F$",
  image9:
    "$C^*_{\\mathrm{merge}}(S) = C^*_{\\mathrm{exec}}(S) + P_{\\mathrm{reject}}(L, F)\\cdot" +
    "\\big[R(S)\\cdot C_{\\mathrm{review}}(S) + C_{\\mathrm{fix}}(S)\\cdot(1 - P_{\\mathrm{correct}})\\big]" +
    " + D_{\\mathrm{revert}}\\cdot C_{\\mathrm{review}}(S)$",
  image10: "$C^*_{\\mathrm{exec}}$",
  image11: "$R(S)$",
  image12: "$C_{\\mathrm{review}}$",
  image13: "$P_{\\mathrm{reject}}$",
  image14: "$C_{\\mathrm{fix}}$",
  image15: "$P_{\\mathrm{correct}}$",
  image16: "$D_{\\mathrm{revert}}$",
};
const LOOP_IMG = {
  image1: "$N = 20$",
  image2: "$\\lambda = 0.9$",
  image3: "$A \\to B \\to A \\to B$",
  image4: "$V_i$",
  image5: "$K$",
  image6: "$K + 1$",
  image7: "$K + 2$",
};

// Names with digits that must keep their digits (MERGE word-cite pass).
const PROTECT_MERGE = ["Qwen3", "NVFP4", "Q4", "NL2", "F1", "v6"];
// Version + citation fused into one number (the generic pass cannot split them).
const FUSIONS_MERGE = [
  ["relative to Opus 518.", "relative to Opus 5[^18]."],
  ["Terminal-Bench 2.14.", "Terminal-Bench 2.1[^4]."],
  ["Terminal-Bench 2.19.", "Terminal-Bench 2.1[^9]."],
  ["Terminal-Bench 4.016.", "Terminal-Bench 4.0[^16]."],
  ["arXiv:2610.3350927", "arXiv:2610.33509[^27]"],
];
const LOOP_TAGS = new Set(["Peer-Reviewed", "Preprint", "Vendor or practitioner blog"]);
const UNESCAPE = /\\([\-+~.:=!_#<>()\[\]|])/g; // \$ stays: prose dollars

const unescape = (t) => t.replace(UNESCAPE, "$1");
const HEAD = /^(#{1,4}) \*\*(.+?)\*\*$/gm;

function clean(raw, img, mode) {
  let text = raw;
  for (const [k, v] of Object.entries(img)) {
    const ref = `![][${k}]`;
    if (!text.includes(ref)) throw new Error(`${mode}: ${ref} not found`);
    text = text.split(ref).join(v);
  }
  text = text.split("\n").filter((l) => !/^\[image\d+\]:\s/.test(l)).join("\n");

  const wcAt = text.indexOf("#### **Works cited**");
  if (wcAt === -1) throw new Error(`${mode}: works cited heading not found`);
  const body0 = text.slice(0, wcAt);
  const wc = text.slice(wcAt);
  const wcLines = wc.slice("#### **Works cited**".length).split("\n");
  const stray = wcLines.filter((l) => l.trim() !== "" && !/^> \d+\. /.test(l) && !/^\[image\d+\]:/.test(l));
  if (stray.length) throw new Error(`${mode}: unparsed works-cited lines: ${stray.slice(0, 3).join(" | ")}`);
  const refMatches = [...wc.matchAll(/^> (\d+)\. (.+?) \[([^\]]+)\]\(([^)]+)\)\s*$/gm)];
  const refLineCount = wcLines.filter((l) => /^> \d+\. /.test(l)).length;
  if (refMatches.length !== refLineCount) throw new Error(`${mode}: ref parse mismatch ${refMatches.length}/${refLineCount}`);
  const refDefs = refMatches.map((m) => `[^${m[1]}]: ${unescape(m[2].trim()).replace(/,\s*$/, "")}, <${m[4]}>`);

  // reference transform: same non-citation steps; the cleaned prose (minus
  // footnote markers) must equal this exactly
  const reference = unescape(body0).replace(HEAD, "$1 $2").replace(/\n{3,}/g, "\n\n");

  let body = unescape(body0);
  if (mode === "word") {
    for (const [a, b] of FUSIONS_MERGE) {
      if (!body.includes(a)) throw new Error(`${mode}: fusion source missing: ${a}`);
      body = body.split(a).join(b);
    }
    const slots = [];
    for (const p of PROTECT_MERGE) body = body.split(p).join(`\u0000${slots.push(p) - 1}\u0000`);
    // cite after a closed bold span (span: no *, no table pipes)
    body = body.replace(/\*\*([^*|\n]+)\*\*(\d{1,3})(?!\.\d)(?=[\s.,;:!?)\]]|$)/gm, "**$1**[^$2]");
    // cite fused to a word / percent / closing paren
    body = body.replace(/([A-Za-z%)])(\d{1,3})(?=[\s.,;:!?)\]]|$)/gm, "$1[^$2]");
    for (let i = 0; i < slots.length; i++) body = body.split(`\u0000${i}\u0000`).join(slots[i]);
  } else {
    body = body.replace(/\](\d{1,2})(?=[\s.,;:!?)\]]|$)/gm, (m, n, off, s) => {
      const line = s.slice(0, off).split("\n").pop();
      const tag = line.match(/\[([^\][]*)\s*$/)?.[1] ?? "";
      if (!LOOP_TAGS.has(tag)) return m;
      return `][^${n}]`;
    });
  }
  body = body.replace(HEAD, "$1 $2").replace(/\n{3,}/g, "\n\n");

  // put the footnote digits back: the result must equal the reference
  // transform exactly (prose unchanged, only cite digits re-marked)
  const restored = body.replace(/\[\^(\d+)\]/g, "$1");
  if (restored !== reference) {
    let i = 0;
    while (i < Math.min(restored.length, reference.length) && restored[i] === reference[i]) i++;
    throw new Error(
      `${mode}: prose drift at char ${i}:\n  cleaned: ${JSON.stringify(restored.slice(i - 40, i + 40))}\n  ref    : ${JSON.stringify(reference.slice(i - 40, i + 40))}`,
    );
  }

  const defined = new Set(refDefs.map((d) => Number(d.slice(2, d.indexOf("]")))));
  const citeCounts = {};
  const contexts = {};
  for (const m of body.matchAll(/\[\^(\d+)\]/g)) {
    const n = m[1];
    citeCounts[n] = (citeCounts[n] ?? 0) + 1;
    (contexts[n] ??= []).push(body.slice(Math.max(0, m.index - 25), m.index + m[0].length + 5).replace(/\s+/g, " "));
  }
  const undefinedCites = Object.keys(citeCounts).filter((n) => !defined.has(Number(n))).map((n) => ({ n, ctx: contexts[n] }));
  const uncited = [...defined].filter((n) => !citeCounts[String(n)]).sort((a, b) => a - b);

  writeFileSync(outp(mode === "word" ? "autonomous-merge-pipeline-size-limits" : "coding-agent-loop-harness-research"), `${body}## Works cited\n\n${refDefs.join("\n")}\n`);
  return { mode, refs: refDefs.length, cites: Object.values(citeCounts).reduce((a, b) => a + b, 0), citeCounts, contexts, uncited, undefinedCites };
}

const results = [
  clean(readFileSync(orig("Autonomous Merge Pipeline Size Limits"), "utf8"), MERGE_IMG, "word"),
  clean(readFileSync(orig("Coding Agent Loop Harness Research"), "utf8"), LOOP_IMG, "tag"),
];
for (const r of results) {
  console.log(`\n### ${r.mode}: ${r.cites} citations, ${r.refs} refs, uncited refs: [${r.uncited.join(", ")}]`);
  const nums = Object.keys(r.citeCounts).map(Number).sort((a, b) => a - b);
  console.log("cite counts:", nums.map((n) => `${n}:${r.citeCounts[n]}`).join(" "));
  for (const n of nums) console.log(`  [^${n}] x${r.citeCounts[n]}: ${r.contexts[n][0]}`);
  if (r.undefinedCites) for (const { n, ctx } of r.undefinedCites) for (const c of ctx) console.log(`  UNDEFINED [^${n}]: ${c}`);
  // leftover glued digits in the final text (expect only protected names)
  const glued = [...new Set([...readFileSync(outp(r.mode === "word" ? "autonomous-merge-pipeline-size-limits" : "coding-agent-loop-harness-research"), "utf8").matchAll(/(?<=[A-Za-z0-9%)\*])\d{1,4}(?![\d])/g)].map((m) => m[0]))];
  console.log("glued-digit sites:", JSON.stringify(glued));
}
console.log("\ndone");
