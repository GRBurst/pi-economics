# pi-infinite-context (spec §2, §4, §5.2): folds ranges of the agent's own
# conversation and unfolds them on demand. The upstream extension with two
# local patches (packages/infinite-context/package.nix), linked through the
# registry for sessions and children, and its settings file, always written.
{
  config,
  lib,
  pkgs,
  ...
}: let
  pe = config.programs.piEconomics;
  cfg = pe.infiniteContext;

  rendered = {
    reminders = {
      default = {};
      overrides = {};
    };
  };
in {
  options.programs.piEconomics.infiniteContext = {
    enable = lib.mkEnableOption "pi-infinite-context, folds of the agent's own conversation with cost-aware fold reminders";

    src = lib.mkOption {
      type = lib.types.path;
      internal = true;
      description = ''
        The unpatched upstream source. The flake's homeModules.default sets it
        from its input `pi-infinite-context`; the registry's existence assertion
        probes it.
      '';
    };

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../packages/infinite-context/package.nix {inherit (cfg) src;};
      defaultText = lib.literalExpression "pkgs.callPackage <pi-economics>/packages/infinite-context/package.nix { src = <input pi-infinite-context>; }";
      description = "The patched extension source (`extensions/infinite-context`).";
    };
  };

  config = lib.mkIf cfg.enable {
    programs.piEconomics.extensions.infinite-context = {
      path = "${cfg.package}/extensions/infinite-context";
      checkPath = "${cfg.src}/extensions/infinite-context/index.ts";
      input = "pi-infinite-context";
      forChildren = true;
      description = "context_map, context_fold, context_unfold, context_peek and context_search: folds ranges of the agent's own conversation by message id and unfolds them on demand, without rewriting live messages. Also steers a maintenance reminder: by default from 75% of the model window, every 5 points; patched to take absolute token thresholds per provider or model from infiniteContext.reminders.";
    };

    # Always written, even with every option at its default: the path stays
    # Home Manager-owned instead of a file the agent could create. Literal
    # text (spec §4).
    home.file."${pe.agentDir}/infinite-context/settings.json".text =
      builtins.toJSON rendered;
  };
}
