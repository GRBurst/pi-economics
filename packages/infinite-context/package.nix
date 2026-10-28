# pi-infinite-context with two local patches, applied in this order (spec §2):
#
# - reminders: absolute fold-reminder thresholds per provider or model
#   (`reminders.default` / `reminders.overrides`, fields startTokens /
#   everyTokens: exact provider/modelId, then provider, then default), read
#   from getAgentDir()/infinite-context/settings.json, which
#   programs.piEconomics.infiniteContext writes. Without a rule the reminder
#   starts at 75% of the model window and repeats every 5% of it. The
#   `reminders` block and the cache patch's keys are strict: an invalid value
#   or an unknown key rejects the whole file with a session-start warning.
#   Upstream's `nudgeAtTokens` range (9918c40: one limit drawn per branch and
#   recorded) is kept: resolveSettings() resolves it on top of these settings.
# - cache: a cost-aware fold hint (payoff in turns while the prompt cache is
#   warm, "folding is free" when cold; prices and TTL from the same file;
#   `foldHint = "fixed"` turns it off; the experiments flag `foldHint`
#   overrides it per session through __piExperimentsApi_v1, cast inline,
#   spec §5.3), a fold_timing prompt section, a re-sync of a snapshot that no
#   longer matches the branch, and a handoff notice instead of the raw
#   transcript when folds cannot be applied.
#
# Foreign messages that other context handlers insert need no patch: upstream
# matches the projection as an ordered subsequence (e6ff6803);
# checks/infinite-context pins that (overlay-foreign.test.ts).
#
# The patch files keep the host's names, so the store paths, and with the
# same nixpkgs the derivation, are the host's. A patch that no longer applies
# fails this build; checks/infinite-context runs the tests on it.
{
  applyPatches,
  src,
}:
applyPatches {
  name = "pi-infinite-context-patched";
  inherit src;
  patches = [
    ../../patches/pi-infinite-context/pi-infinite-context-reminders.patch
    ../../patches/pi-infinite-context/pi-infinite-context-cache.patch
  ];
}
