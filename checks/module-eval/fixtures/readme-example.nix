{
  programs.piEconomics = {
    # Children are metered and kept warm when pi-setup's patched
    # actor-subagents (programs.pi.actorSubagents) is in the registry.
    tokenMeter.enable = true;
    cacheLifecycle.enable = true;
  };
}
