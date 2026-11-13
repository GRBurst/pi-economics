# pi-infinite-context with one local patch (spec §2):
#
# - reminders: absolute fold-reminder thresholds per provider or model
#   (`reminders.default` / `reminders.overrides`, fields startTokens /
#   everyTokens: exact provider/modelId, then provider, then default), read
#   from getAgentDir()/infinite-context/settings.json, which
#   programs.piEconomics.infiniteContext writes. Without a rule the reminder
#   starts at 75% of the model window and repeats every 5% of it. The
#   `reminders` block is strict: an invalid value or an unknown key rejects
#   the whole file with a session-start warning. Upstream's `nudgeAtTokens`
#   range (9918c40: one limit drawn per branch and recorded) is kept:
#   resolveSettings() resolves it on top of these settings.
#
# The former cache patch (a cost-aware fold hint, which also read the
# experiments flag `foldHint`) is dropped: upstream rejected the fold hint
# (PR #7) and an extension never reads pi-economics' experiments API.
#
# Foreign messages that other context handlers insert need no patch: upstream
# matches the projection as an ordered subsequence (e6ff6803);
# checks/infinite-context pins that (overlay-foreign.test.ts).
#
# The patch file keeps the host's name, so the store path, and with the
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
  ];
}
