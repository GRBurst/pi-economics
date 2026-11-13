# pi-infinite-context with one local patch (spec §2):
#
# - reminders: fold-reminder limits per provider or model. The settings file
#   (getAgentDir()/infinite-context/settings.json, which
#   programs.piEconomics.infiniteContext writes) is upstream's plus
#   `overrides`: rules keyed by provider or exact provider/modelId with
#   upstream's two fields, `nudgeAtTokens` (a token count or a range
#   [min, max]) and `nudgeAtPercent`. Each field comes from the exact model,
#   then the provider, then the top level, then upstream's defaults; parsing
#   stays fail-open per field. The branch's settings follow its current model
#   (session_start, model_select, turn_end): upstream's record
#   `infinite-context:settings` keeps its shape and gains `rule` (the
#   override that set nudgeAtTokens); a rule's range is drawn and kept like
#   upstream's (same range and within it: kept), so a switch to a rule with
#   another range draws anew and appends a record, and a record appended
#   before session_start (pi-economics' seed) holds the draw. The reminder
#   step stays upstream's. Tests: the patch's settings.test.ts and
#   index.test.ts (checks/infinite-context).
#
# The former cache patch (a cost-aware fold hint, which also read the
# experiments flag `foldHint`) is dropped: upstream rejected the fold hint
# (PR #7) and an extension never reads pi-economics' experiments API.
#
# Foreign messages that other context handlers insert need no patch: upstream
# matches the projection as an ordered subsequence (e6ff6803);
# checks/infinite-context pins that (overlay-foreign.test.ts).
#
# The patch file keeps the host's name. A patch that no longer applies fails
# this build; checks/infinite-context runs the tests on it.
{
  applyPatches,
  src,
}:
applyPatches {
  name = "pi-infinite-context-patched";
  inherit src;
  patches = [
    ../../patches/pi-infinite-context/pi-infinite-context-reminders.patch
  ];
}
