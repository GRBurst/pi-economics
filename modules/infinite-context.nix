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

  r = cfg.reminders;

  reminderRule = lib.types.submodule {
    options = {
      startTokens = lib.mkOption {
        type = lib.types.nullOr lib.types.ints.positive;
        default = null;
        description = "Context size, in tokens, at which the first fold reminder is sent. null inherits (provider, then default, then 75% of the model window). Never later than 75% of the window.";
      };
      everyTokens = lib.mkOption {
        type = lib.types.nullOr lib.types.ints.positive;
        default = null;
        description = "Tokens between further reminders above startTokens. null inherits (provider, then default, then 5% of the model window).";
      };
    };
  };

  # Nulls mean "inherit" and are left out, so the file carries only what was set.
  renderRule = rule: lib.filterAttrs (_: v: v != null) rule;

  # (M6.9) The reminder options as the extension reads them.
  rendered =
    {
      reminders = {
        default = renderRule r.default;
        overrides = lib.mapAttrs (_: renderRule) r.overrides;
      };
    }
    // lib.optionalAttrs (r.prices != {}) {inherit (r) prices;}
    // lib.optionalAttrs (r.cacheTtlMinutes != null) {inherit (r) cacheTtlMinutes;}
    // lib.optionalAttrs (r.foldHint != null) {inherit (r) foldHint;};
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

    # (M6.9) The host's piContextReminders (spec §5.2).
    reminders = {
      prices = lib.mkOption {
        type = lib.types.attrsOf (lib.types.submodule {
          options = {
            w = lib.mkOption {
              type = lib.types.numbers.positive;
              description = "Cache-write price (any unit; only w/r matters).";
            };
            r = lib.mkOption {
              type = lib.types.numbers.positive;
              description = "Cache-read price, same unit; at most w.";
            };
          };
        });
        default = {};
        example = {
          "anthropic/claude-opus-5-5" = {
            w = 5;
            r = 0.2;
          };
        };
        description = ''
          Prompt-cache prices per exact `provider/modelId` or provider. With a
          price the fold reminder says after how many turns a fold pays off
          (((w - r) / r) · K/R, 24·K/R on Opus 5.5); without one it carries no
          cost hint. A cold cache always gets "folding is free now".
        '';
      };
      cacheTtlMinutes = lib.mkOption {
        type = lib.types.nullOr lib.types.ints.positive;
        default = null;
        description = "Prompt-cache lifetime the fold hint uses to tell warm from cold. null keeps the extension's 5 minutes.";
      };
      foldHint = lib.mkOption {
        type = lib.types.nullOr (lib.types.enum ["fixed" "cache-aware"]);
        default = null;
        description = ''
          "fixed": reminders carry no cost hint. "cache-aware": they carry the
          fold hint. null keeps the extension's default (cache-aware). The
          experiments package (factor foldHint) overrides this per session.
        '';
      };
      default = lib.mkOption {
        type = reminderRule;
        default = {};
        description = "Fold-reminder thresholds for every model without an override.";
      };
      overrides = lib.mkOption {
        type = lib.types.attrsOf reminderRule;
        default = {};
        example = {
          anthropic = {
            startTokens = 200000;
            everyTokens = 20000;
          };
        };
        description = ''
          Fold-reminder thresholds keyed by pi provider (`anthropic`) or exact
          `provider/modelId`. Each field resolves on its own: exact model, then
          provider, then `default`, then infinite-context's built-in 75% / 5%
          of the model window. Read once per extension instance, so a change
          applies to sessions and subagents started after the switch.
        '';
      };
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
