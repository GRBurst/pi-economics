# The prompt-cache lifecycle (spec §2, §4): elides stale tool results and
# thinking on the first request after the prompt cache expired, can request a
# 1 h cache TTL for the main session, and decides pi's idle cache warming,
# which pi asks for only while its settings.json says cacheWarming = "idle"
# (the piSettings op below). Loaded into children too: each session has its
# own prompt cache.
{
  config,
  lib,
  pkgs,
  ...
}: let
  pe = config.programs.piEconomics;
  cfg = pe.cacheLifecycle;
in {
  options.programs.piEconomics.cacheLifecycle = {
    enable = lib.mkEnableOption ''
      the pi cache-lifecycle extension (elides stale context after cache
      expiry, 1 h TTL for the main session, orchestrator-aware warming)'';

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../packages/cache-lifecycle/package.nix {};
      defaultText = lib.literalExpression "pkgs.callPackage <pi-economics>/packages/cache-lifecycle/package.nix { }";
      description = "The extension (package.json, index.ts, core/); its tests run when it builds.";
    };
  };

  config = lib.mkIf cfg.enable {
    # (M4.9) Children too: each session has its own prompt cache, which the
    # elision and (main only) the 1 h TTL manage.
    programs.piEconomics.extensions.cache-lifecycle = {
      path = "${cfg.package}";
      # The source, not the package: probing a build output would be
      # import-from-derivation.
      checkPath = ../packages/cache-lifecycle/index.ts;
      forChildren = true;
      description = "Elides stale tool results and thinking on the first request after the prompt cache expired (outside a protected tail) and can request a 1 h cache TTL for the main session; settings in <agentDir>/cache-lifecycle/settings.json.";
    };
  };
}
