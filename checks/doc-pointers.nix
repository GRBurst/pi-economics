# The documents that name what left in the router extraction (M3e): the log
# manual points at the router's outcome-log schema (which the router input
# really ships) and no longer carries it; the scope record is written as what
# left, and the actor is not among what stays; AGENTS.md carries no rule of
# the router or the actor, which are other repositories' now; the Gemini
# research cleanup tool is its own repository (gemini-research-cleanup, command
# gdr-clean), its specification is not here and no document points at the old
# path. (redesign M11) A pointer must point: every code span that names a file
# or directory of this repository, and every relative Markdown link, exists
# (a span on a line that names the router or pi-setup may name theirs: it must
# exist in that input's sources); every check has its row in docs/pi-economics.md;
# the prose of the redesign is there (headings and terms per document) and what
# it replaced is gone. Lines are compared whole or by prefix, and searched with
# `replaceStrings` (no regex).
{
  lib,
  pkgs,
  # The pi-task-router and pi-setup inputs (source paths).
  router,
  setup,
  # The names of every check of the flake (checks/default.nix).
  checkNames,
}: let
  root = ../.;
  lines = f: lib.splitString "\n" (builtins.readFile (root + f));
  has = infix: line: builtins.replaceStrings [infix] [""] line != line;
  anyLine = infix: ls: lib.any (has infix) ls;

  logs = lines "/packages/token-meter/LOGS.md";
  scope = lines "/docs/scope.md";
  agents = lines "/AGENTS.md";
  economics = lines "/docs/pi-economics.md";
  # Every document that could still point at the specification that moved.
  documents = lib.concatMap (f:
    lib.optional (builtins.pathExists (root + f)) {
      inherit f;
      ls = lines f;
    }) ["/README.md" "/AGENTS.md" "/docs/scope.md" "/docs/pi-economics.md" "/docs/pi-token-economics.md" "/docs/context-folding.md"];
  spec = "research-cleanup-tool";
  # The scope record's lines above the "What left" heading: what stays.
  stays = lib.take (lib.lists.findFirstIndex (l: l == "## What left") (lib.length scope) scope) scope;

  # (redesign M11) Pointers. A document is a file name below the root; its lines are numbered from 1.
  numbered = ls: lib.imap1 (n: l: {inherit n l;}) ls;
  # The code spans of a line: the odd parts of its split at the backtick.
  spansOf = l: lib.concatLists (lib.imap0 (i: s: lib.optional (lib.mod i 2 == 1) s) (lib.splitString "`" l));
  isPath = s:
    lib.any (p: lib.hasPrefix p s) ["docs/" "packages/" "checks/" "modules/" "patches/" "skills/" "render/"]
    && !(lib.any (c: has c s) [" " "<" ">" "*" "{" "}" "…" ":" "$" "(" ")" "|" ","]);
  # Where a span of this line may exist: here, and in the input of a repository the line names.
  basesOf = l: [root] ++ lib.optional (has "router" l) "${router}" ++ lib.optional (has "pi-setup" l) "${setup}";
  there = bases: s: lib.any (b: builtins.pathExists (b + "/${lib.removeSuffix "/" s}")) bases;
  # The target of each relative Markdown link of a line (a `](target)` that is no URL or anchor, without its anchor).
  linksOf = l:
    lib.filter (t: t != "" && !(lib.hasPrefix "http" t) && !(lib.hasPrefix "#" t) && !(lib.hasPrefix "mailto:" t))
    (map (p: builtins.head (lib.splitString "#" (builtins.head (lib.splitString ")" p)))) (lib.tail (lib.splitString "](" l)));
  pointerDocs = ["/README.md" "/AGENTS.md" "/docs/scope.md" "/docs/pi-economics.md" "/docs/pi-token-economics.md" "/docs/context-folding.md" "/docs/meter-analysis-2026-11-12.md" "/packages/token-meter/LOGS.md" "/skills/pi-token-economics-analysis/SKILL.md" "/packages/bench/README.md"];
  # The scope record's "What left" section and what follows name paths that are gone from here, by design.
  gone = f: ls:
    if f == "/docs/scope.md"
    then lib.drop (lib.lists.findFirstIndex (l: l == "## What left") (lib.length ls) ls) ls
    else [];
  dangling = f: let
    ls = lines f;
    skip = gone f ls;
    live = lib.filter (x: !(lib.elem x.l skip)) (numbered ls);
  in
    lib.concatMap (x:
      lib.concatMap (s: lib.optional (isPath s && !there (basesOf x.l) s) "${lib.removePrefix "/" f}:${toString x.n} points at `${s}`, which does not exist")
      (spansOf x.l)
      ++ lib.concatMap (t: lib.optional (!builtins.pathExists (dirOf (root + f) + "/${t}")) "${lib.removePrefix "/" f}:${toString x.n} links to ${t}, which does not exist") (linksOf x.l))
    live;

  # (redesign M11) The prose of the redesign: per document the headings and the terms it must carry.
  tokenEconomics = lines "/docs/pi-token-economics.md";
  required = [
    {
      f = "docs/pi-token-economics.md";
      ls = tokenEconomics;
      headings = ["## Units and money" "### Local cost and currencies" "## Strata, designs and objectives" "## Levers, add-ons and read-back" "### Bench process levers" "## Load order" "## Quota waits"];
      terms = ["API-eq $" "cash $" "est. points" "machine hours" "currencyRates" "not measurable" "intention to treat" "per-protocol" "refusal rate" "`confirmed`" "`refused`" "`unverified`" "`session-entry(" "`target`" "`infinite-context.nudgeAtTokens`" "`pi.compaction.reserveTokens`" "`ensurePrefix`" "quota waiter"];
    }
    {
      f = "docs/pi-economics.md";
      ls = economics;
      headings = ["## Removed and moved options" "## Quota waits"];
      terms = ["quota waiter" "`retry`" "`taskRouter`" "`actorSubagents`"];
    }
    {
      f = "docs/scope.md";
      ls = scope;
      headings = [];
      terms = ["quota waiter" "0.3.0"];
    }
    {
      f = "README.md";
      ls = lines "/README.md";
      headings = [];
      terms = ["quota waiter" "0.3.0"];
    }
    {
      f = "packages/token-meter/LOGS.md";
      ls = logs;
      headings = [];
      terms = ["quota waiter"];
    }
  ];
  # What the redesign replaced, said nowhere as present: (document, phrase) pairs.
  replaced = [
    {
      f = "packages/token-meter/LOGS.md";
      t = "does not inherit its arm again";
    }
    {
      f = "docs/pi-token-economics.md";
      t = "task-router and experiments are main";
    }
    {
      f = "docs/pi-token-economics.md";
      t = "`maxArms: 16`";
    }
    {
      f = "README.md";
      t = "two patched upstreams";
    }
    {
      f = "README.md";
      t = "Three components build patched copies";
    }
    {
      f = "docs/scope.md";
      t = "nothing here implements it";
    }
    {
      f = "docs/pi-token-economics.md";
      t = "pi-retry";
    }
    {
      f = "README.md";
      t = "pi-retry";
    }
    {
      f = "docs/pi-economics.md";
      t = "pi-retry";
    }
  ];

  failures =
    lib.optional (!builtins.pathExists "${router}/docs/outcome-log.md") "the pi-task-router input has no docs/outcome-log.md"
    ++ lib.optional (!anyLine "docs/outcome-log.md" logs) "LOGS.md does not point at the router's docs/outcome-log.md"
    ++ lib.optional (lib.any (lib.hasPrefix "| `spawn` |") logs) "LOGS.md still carries the outcome log's `spawn` row (the router owns the schema)"
    ++ lib.optional (!lib.elem "### Examples: task-router local mode" logs) "LOGS.md lost the heading of the consumer examples (logs-examples.test.ts reads it)"
    ++ lib.optional (!lib.elem "## What left" scope) "scope.md has no \"## What left\" section"
    ++ lib.optional (lib.elem "## What is leaving" scope) "scope.md still announces what \"is leaving\""
    ++ lib.optional (lib.any (lib.hasPrefix "| `actorSubagents` |") stays) "scope.md lists actorSubagents among what stays"
    ++ lib.optional (!anyLine "pi-setup" (lib.drop (lib.length stays) scope)) "scope.md does not say the actor went to pi-setup"
    ++ lib.optional (!anyLine "gemini-research-cleanup" (lib.drop (lib.length stays) scope)) "scope.md does not say the research cleanup tool moved to gemini-research-cleanup"
    ++ lib.optional (!anyLine "gdr-clean" (lib.drop (lib.length stays) scope)) "scope.md does not name the tool's command gdr-clean"
    ++ lib.optional (builtins.pathExists (root + "/docs/prompts/research-cleanup-tool.md")) "docs/prompts/research-cleanup-tool.md is still here (the specification lives in gemini-research-cleanup)"
    ++ lib.concatMap (d: lib.optional (anyLine spec d.ls) "${lib.removePrefix "/" d.f} still names the moved specification (${spec})") documents
    ++ lib.concatMap (t: lib.optional (anyLine t agents) "AGENTS.md still carries ${t}") ["router-golden" "local mode" "patches/pi-actor-subagents" "task-router/core"]
    # (redesign M5b.2) The global __piExperimentsApi_v1 and its iface checks are gone: a document names the global only
    # as removed (or as what a grep must not find), names no iface-experiments check, and lists the checks that
    # replaced them.
    ++ lib.concatMap (d: lib.optional (lib.any (l: has "__piExperimentsApi" l && !has "removed" l && !has "no `__piExperimentsApi" l) d.ls) "${lib.removePrefix "/" d.f} still describes __piExperimentsApi_v1 as present") documents
    ++ lib.concatMap (d: lib.optional (anyLine "iface-experiments-" d.ls) "${lib.removePrefix "/" d.f} still names an iface-experiments check") documents
    ++ lib.concatMap (c: lib.optional (!lib.any (lib.hasPrefix "| `${c}` |") economics) "docs/pi-economics.md has no check row for ${c}") ["internal-channel" "dependency-direction" "state-contract"]
    # (redesign M11) Pointers point, every check has its row, the redesign's prose is there, what it replaced is gone.
    ++ lib.concatMap dangling pointerDocs
    ++ lib.concatMap (c: lib.optional (!anyLine "`${c}`" economics) "docs/pi-economics.md has no row for the check ${c}") checkNames
    ++ lib.concatMap (d:
      map (h: "${d.f} has no heading \"${h}\"") (lib.filter (h: !lib.elem h d.ls) d.headings)
      ++ map (t: "${d.f} does not carry the term ${t}") (lib.filter (t: !anyLine t d.ls) d.terms))
    required
    ++ lib.concatMap (r: lib.optional (anyLine r.t (lines "/${r.f}")) "${r.f} still says \"${r.t}\"") replaced
    # (redesign M5b.2, review m3) Children no longer inherit through spawn events: a child runtime derives its root's arm.
    ++ lib.concatMap (t: lib.concatMap (d: lib.optional (anyLine t d.ls) "${lib.removePrefix "/" d.f} still says children ${t}") documents) ["inherit only on the spawn event" "do not inherit an arm" "spawn inheritance"];
in
  pkgs.runCommand "doc-pointers" {
    report = lib.concatStringsSep "\n" (map (f: "doc-pointers: ${f}") failures);
    passAsFile = ["report"];
  } ''
    if [ -s "$reportPath" ]; then cat "$reportPath" >&2; echo >&2; exit 1; fi
    touch $out
  ''
