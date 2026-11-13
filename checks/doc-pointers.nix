# The documents that name what left in the router extraction (M3e): the log
# manual points at the router's outcome-log schema (which the router input
# really ships) and no longer carries it; the scope record is written as what
# left, and the actor is not among what stays; AGENTS.md carries no rule of
# the router or the actor, which are other repositories' now; the Gemini
# research cleanup tool is its own repository (gemini-research-cleanup, command
# gdr-clean), its specification is not here and no document points at the old
# path. Lines are compared whole or by prefix, and searched with
# `replaceStrings` (no regex).
{
  lib,
  pkgs,
  # The pi-task-router input (a source path).
  router,
}: let
  root = ../.;
  lines = f: lib.splitString "\n" (builtins.readFile (root + f));
  has = infix: line: builtins.replaceStrings [infix] [""] line != line;
  anyLine = infix: ls: lib.any (has infix) ls;

  logs = lines "/packages/token-meter/LOGS.md";
  scope = lines "/docs/scope.md";
  agents = lines "/AGENTS.md";
  # Every document that could still point at the specification that moved.
  documents = lib.concatMap (f:
    lib.optional (builtins.pathExists (root + f)) {
      inherit f;
      ls = lines f;
    }) ["/README.md" "/AGENTS.md" "/docs/scope.md" "/docs/pi-economics.md" "/docs/pi-token-economics.md" "/docs/context-folding.md"];
  spec = "research-cleanup-tool";
  # The scope record's lines above the "What left" heading: what stays.
  stays = lib.take (lib.lists.findFirstIndex (l: l == "## What left") (lib.length scope) scope) scope;

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
    ++ lib.concatMap (t: lib.optional (anyLine t agents) "AGENTS.md still carries ${t}") ["router-golden" "local mode" "patches/pi-actor-subagents" "task-router/core"];
in
  pkgs.runCommand "doc-pointers" {
    report = lib.concatStringsSep "\n" (map (f: "doc-pointers: ${f}") failures);
    passAsFile = ["report"];
  } ''
    if [ -s "$reportPath" ]; then cat "$reportPath" >&2; echo >&2; exit 1; fi
    touch $out
  ''
