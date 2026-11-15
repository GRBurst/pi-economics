# pi-infinite-context as upstream publishes it, unpatched (spec §2). The
# settings file (getAgentDir()/infinite-context/settings.json, which
# programs.piEconomics.infiniteContext writes) is upstream's: `nudgeAtTokens`
# (a token count or a range [min, max]) and `nudgeAtPercent` at the top level,
# and `modelOverrides` keyed by an exact provider/id with the same two fields,
# each resolved on its own (the model's key, then the top level, then
# 150000 / 75). The branch's settings follow its model (session_start,
# session_tree, model_select); a drawn limit is recorded in
# `infinite-context:settings` and kept while a later resolution has the same
# range and the record lies in it, which is what pi-economics' seed relies on
# (checks/ic-seed-contract).
#
# The former reminders patch (rules per provider, a `rule` field in the
# record, a model follow at turn_end) is dropped (0.3.2): upstream resolves
# per exact model since 9c08a04 and pi 1.4 announces every model change with
# model_select. The former cache patch (a cost-aware fold hint) is dropped
# too: upstream rejected the fold hint (PR #7) and an extension never reads
# pi-economics' experiments API.
#
# Foreign messages that other context handlers insert need no patch: upstream
# matches the projection as an ordered subsequence (e6ff6803);
# checks/infinite-context pins that (overlay-foreign.test.ts).
#
# A copy of the source, so the flake's package stays a derivation.
{
  runCommand,
  src,
}:
runCommand "pi-infinite-context" {} ''
  cp -r ${src} $out
''
