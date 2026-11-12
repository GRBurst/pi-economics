{
  programs.piEconomics = {
    # The patched subagent runner; the meter hooks into it.
    actorSubagents.enable = true;
    tokenMeter.enable = true;
    cacheLifecycle.enable = true;
  };
}
