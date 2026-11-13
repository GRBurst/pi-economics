# pi-infinite-context (spec §2, §4, §5.2): folds ranges of the agent's own
# conversation and unfolds them on demand. The upstream extension with one
# local patch (packages/infinite-context/package.nix), linked through the
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

  # One rule: the fields of upstream's settings file, null = inherit.
  reminderRule = lib.types.submodule {
    options = {
      nudgeAtTokens = lib.mkOption {
        type = with lib.types; nullOr (either ints.positive (listOf ints.positive));
        default = null;
        example = [100000 300000];
        description = ''
          Context size, in tokens, from which fold reminders start, or a range
          `[min, max]` (min < max): each session branch then draws one limit
          from it and records it, again when a model switch selects a rule with
          another range. null inherits (exact model, then provider, then
          `default`, then the extension's 150000).
        '';
      };
      nudgeAtPercent = lib.mkOption {
        type = lib.types.nullOr (lib.types.numbers.between 0 100);
        default = null;
        description = "Share of the model window, in percent (above 0), from which reminders start at the latest: the earlier of the two limits applies. null inherits like nudgeAtTokens (the extension's default is 75).";
      };
    };
  };

  # Nulls mean "inherit" and are left out, so the file carries only what was
  # set; a rule that sets nothing is left out too.
  renderRule = rule: lib.filterAttrs (_: v: v != null) rule;
  overrides = lib.filterAttrs (_: rule: rule != {}) (lib.mapAttrs (_: renderRule) r.overrides);

  # (M6.9) The reminder options as the extension reads them: `default` is the
  # file's top level, the rest its `overrides`.
  rendered = renderRule r.default // lib.optionalAttrs (overrides != {}) {inherit overrides;};

  # Every rule with the name its assertion messages use.
  namedRules =
    [
      {
        name = "default";
        rule = r.default;
      }
    ]
    ++ lib.mapAttrsToList (key: rule: {
      name = "overrides.${builtins.toJSON key}";
      inherit rule;
    })
    r.overrides;
  goodRange = t: !builtins.isList t || (lib.length t == 2 && lib.elemAt t 0 < lib.elemAt t 1);
in {
  options.programs.piEconomics.infiniteContext = {
    enable = lib.mkEnableOption "pi-infinite-context, folds of the agent's own conversation with fold reminders per provider or model";

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
      default = lib.mkOption {
        type = reminderRule;
        default = {};
        description = "Fold-reminder limits for every model, as far as no override sets them.";
      };
      overrides = lib.mkOption {
        type = lib.types.attrsOf reminderRule;
        default = {};
        example = {
          anthropic.nudgeAtTokens = [100000 300000];
          "anthropic/claude-opus-5-5" = {
            nudgeAtTokens = 400000;
            nudgeAtPercent = 50;
          };
        };
        description = ''
          Fold-reminder limits keyed by pi provider (`anthropic`) or exact
          `provider/modelId`. Each field resolves on its own: exact model, then
          provider, then `default`, then the extension's 150000 tokens / 75%.
          The step between reminders is upstream's (15000 tokens, less when
          little room is left). The session follows its current model; the
          file is read once per extension instance, so a change applies to
          sessions and subagents started after the switch.
        '';
      };
    };

    # (M6.10)
    settings = lib.mkOption {
      type = lib.types.attrsOf (pkgs.formats.json {}).type;
      default = {};
      example = {nudgeAtPercent = 60;};
      description = ''
        Merged into `<agentDir>/infinite-context/settings.json` with
        `lib.recursiveUpdate`, on the right of what `reminders` renders: a
        nested key replaces only its own leaf. The extension reads
        `nudgeAtTokens`, `nudgeAtPercent` and `overrides` (per rule the
        same two fields); it ignores unknown keys and an invalid value of its
        own, so neither is reported.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    # The extension drops an invalid value without a word (fail-open per
    # field), so the module rejects what its types let through.
    assertions =
      lib.concatMap ({
        name,
        rule,
      }: [
        {
          assertion = goodRange rule.nudgeAtTokens;
          message = "pi-economics: infiniteContext.reminders.${name}.nudgeAtTokens is a token count or a range [min, max] with min < max, not ${builtins.toJSON rule.nudgeAtTokens}";
        }
        {
          assertion = rule.nudgeAtPercent == null || rule.nudgeAtPercent > 0;
          message = "pi-economics: infiniteContext.reminders.${name}.nudgeAtPercent is a share of the model window in (0, 100], not 0";
        }
      ])
      namedRules;

    programs.piEconomics.extensions.infinite-context = {
      path = "${cfg.package}/extensions/infinite-context";
      checkPath = "${cfg.src}/extensions/infinite-context/index.ts";
      input = "pi-infinite-context";
      forChildren = true;
      description = "context_map, context_fold, context_unfold, context_peek and context_search: folds ranges of the agent's own conversation by message id and unfolds them on demand, without rewriting live messages. Also reminds the agent to fold: by default from 150k tokens or 75% of the model window, whichever comes first, then every 15k tokens; patched to take these limits (a token limit may be a range, drawn per branch) per provider or model from infiniteContext.reminders.";
    };

    # Always written, even with every option at its default: the path stays
    # Home Manager-owned instead of a file the agent could create. Literal
    # text (spec §4).
    home.file."${pe.agentDir}/infinite-context/settings.json".text =
      builtins.toJSON (lib.recursiveUpdate rendered cfg.settings);
  };
}
