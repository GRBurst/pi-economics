# pi-actor-subagents with two local patches, applied in this order (spec §2):
#
# - child-prompt: upstream builds every child with `systemPromptOverride`, and
#   in pi a custom system prompt drops the default `tools` and `rules`
#   sections, where extensions' promptGuidelines land. A child therefore got
#   the context_* and web_* tools without infinite-context's "fold
#   proactively" guidance. The patch hands the agent preamble to pi as an
#   append prompt instead, so the default sections stay. Offer it upstream.
# - spawn-policy: the stable `globalThis.__subagentsApi_v1` (api.ts) that the
#   task router drives (spec §5.3): a spawn-policy hook (model, effort, brief,
#   tools, tool guard), an optional `task` parameter, neutral model wording,
#   send/list, childSessionId on spawn events, and a grace period before a
#   child's transient error (429 under pi-retry) wakes its parent.
#
# The patch files keep the host's names, so the store paths, and with the
# same nixpkgs the derivation, are the host's. A patch that no longer applies
# fails this build; checks/actor-subagents runs the upstream suite on it.
{
  applyPatches,
  src,
}:
(applyPatches {
  name = "pi-actor-subagents-patched";
  inherit src;
  patches = [
    ../../patches/pi-actor-subagents/pi-actor-subagents-child-prompt.patch
    ../../patches/pi-actor-subagents/pi-actor-subagents-spawn-policy.patch
  ];
}).overrideAttrs (old: {
  # The version of __subagentsApi_v1 this build provides; taskRouter asserts
  # it (spec §4.1). Through overrideAttrs: applyPatches refuses `passthru`.
  passthru = (old.passthru or {}) // {spawnPolicyApi = 1;};
})
