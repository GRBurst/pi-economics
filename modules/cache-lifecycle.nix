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
      expiry, 1 h TTL for the main session, orchestrator-aware warming). It
      also sets cacheWarming = "idle" in pi's settings.json through the
      piSettings activation entry: its warm policy fires only in that mode,
      and pi's default is "streaming". Standalone, pi keeps its default while
      there is no settings.json (the entry edits an existing file only) and
      while piSettings.enable is false'';

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../packages/cache-lifecycle/package.nix {};
      defaultText = lib.literalExpression "pkgs.callPackage <pi-economics>/packages/cache-lifecycle/package.nix { }";
      description = "The extension (package.json, index.ts, core/); its tests run when it builds.";
    };

    # (M4.10)
    settings = lib.mkOption {
      type = lib.types.attrsOf (pkgs.formats.json {}).type;
      default = {};
      example = {maskOnCold = "tools";};
      description = ''
        Written to `<agentDir>/cache-lifecycle/settings.json` when non-empty.
        Every key has a default in the package's core/settings.ts
        (`warmPolicy`, `mainCacheTtl`, `maskOnCold`, `protectedTailTokens`,
        `identityShim`), so `{}` writes no file.
      '';
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

    # (M4.10) Literal text (spec §4): checks read it with builtins.fromJSON.
    home.file."${pe.agentDir}/cache-lifecycle/settings.json" =
      lib.mkIf (cfg.settings != {}) {text = builtins.toJSON cfg.settings;};

    # (M4.11) Replaces the host's positional `idle` flag (spec §5.4). Order
    # 1500: after the removals and the child rule (1000), as today's script
    # edits, so a file that lacks both keys gets today's bytes.
    programs.piEconomics.piSettings.ops.cacheLifecycle = [
      {
        op = "set";
        path = ["cacheWarming"];
        value = "idle";
        order = 1500;
      }
    ];

    # (M4.12) A soft dependency (spec §4.1): shell.ts tolerates a missing API.
    warnings = lib.optional (!pe.actorSubagents.enable) "pi-economics: cacheLifecycle without actorSubagents loses warming while a session waits on its children (the warm policy reads __subagentsApi_v1)";
  };
}
