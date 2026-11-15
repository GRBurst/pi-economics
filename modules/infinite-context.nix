# pi-infinite-context (spec §2, §4, §5.2): folds ranges of the agent's own
# conversation and reads the folded originals back on demand. The upstream
# extension, unpatched
# since 0.3.2 (packages/infinite-context/package.nix), linked through the
# registry for sessions and children, and its settings file, always written.
{
  config,
  lib,
  options,
  pkgs,
  ...
}: let
  pe = config.programs.piEconomics;
  cfg = pe.infiniteContext;

  r = cfg.reminders;

  # The fields of upstream's settings file, at its top level and per model
  # override; null = inherit.
  ruleOptions = inherits: {
    nudgeAtTokens = lib.mkOption {
      type = with lib.types; nullOr (either ints.positive (listOf ints.positive));
      default = null;
      example = [100000 300000];
      description = ''
        Context size, in tokens, from which fold reminders start, or a range
        `[min, max]` (min < max): each session branch then draws one limit
        from it and records it, and keeps the latest draw it recorded for the
        same range (also after a model switch away and back). null inherits
        ${inherits}.
      '';
    };
    nudgeAtPercent = lib.mkOption {
      type = lib.types.nullOr (lib.types.numbers.between 0 100);
      default = null;
      description = "Share of the model window, in percent (above 0), from which reminders start at the latest: the earlier of the two limits applies. null inherits ${inherits}.";
    };
  };
  modelRule = lib.types.submodule {
    options = ruleOptions "the top level's value";
  };

  # Nulls mean "inherit" and are left out, so the file carries only what was
  # set; an override that sets nothing is left out too.
  renderRule = rule: lib.filterAttrs (_: v: v != null) rule;
  modelOverrides = lib.filterAttrs (_: rule: rule != {}) (lib.mapAttrs (_: renderRule) r.modelOverrides);

  # (M6.9) The reminder options as the extension reads them (upstream
  # settings.ts parseSettings): the top level, then `modelOverrides`.
  rendered =
    renderRule {inherit (r) nudgeAtTokens nudgeAtPercent;}
    // lib.optionalAttrs (modelOverrides != {}) {inherit modelOverrides;};

  # Every rule with the option path its assertion messages use.
  namedRules =
    [
      {
        name = "";
        rule = {inherit (r) nudgeAtTokens nudgeAtPercent;};
      }
    ]
    ++ lib.mapAttrsToList (key: rule: {
      name = ".modelOverrides.${builtins.toJSON key}";
      inherit rule;
    })
    r.modelOverrides;
  goodRange = t: !builtins.isList t || (lib.length t == 2 && lib.elemAt t 0 < lib.elemAt t 1);
  # Upstream looks an override up by the model's exact "provider/id": a key
  # needs a provider before its first "/" and a model id after it (which may
  # hold more slashes). A key is short, so splitting it is cheap.
  exactKey = key: let
    parts = lib.splitString "/" key;
  in
    lib.length parts >= 2 && lib.head parts != "" && lib.concatStringsSep "/" (lib.tail parts) != "";

  # The settings shape the module renders is upstream's since 9c08a04 (its
  # settings.ts unchanged up to 0c7f021, the locked revision). An older input
  # would drop modelOverrides silently (fail-open), so the source is probed: a
  # path of the input, read at evaluation (no IFD); a short file, searched
  # without a regex.
  settingsTs = "${cfg.src}/extensions/infinite-context/settings.ts";
  readsModelOverrides =
    builtins.pathExists settingsTs
    && (let
      t = builtins.readFile settingsTs;
    in
      builtins.replaceStrings ["modelOverrides"] [""] t != t);

  # 0.3.2: the options before upstream's names, hidden stubs. Defined, each
  # fails one assertion naming its replacement (modules/removed.nix's pattern).
  renamed = {
    default = "pi-economics: infiniteContext.reminders.default was removed in 0.3.2: set infiniteContext.reminders.nudgeAtTokens and infiniteContext.reminders.nudgeAtPercent (the top level of the extension's settings file)";
    overrides = "pi-economics: infiniteContext.reminders.overrides was renamed in 0.3.2 to infiniteContext.reminders.modelOverrides, keyed by exact \"provider/modelId\" only: the extension has no provider-wide rules";
  };
in {
  options.programs.piEconomics.infiniteContext = {
    enable = lib.mkEnableOption "pi-infinite-context, folds of the agent's own conversation with fold reminders, limits set for all models and per model";

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
      description = "The extension source (`extensions/infinite-context`), a copy of the unpatched upstream.";
    };

    # (M6.9) The host's piContextReminders (spec §5.2), in upstream's names:
    # the top level for every model, modelOverrides per exact model.
    reminders =
      ruleOptions "the extension's default (150000 tokens, 75%)"
      // {
        modelOverrides = lib.mkOption {
          type = lib.types.attrsOf modelRule;
          default = {};
          example = {
            "anthropic/claude-opus-5-5".nudgeAtPercent = 50;
            "llama/qwen3.8".nudgeAtTokens = [100000 200000];
          };
          description = ''
            Fold-reminder limits keyed by the exact `provider/modelId` of a
            model (the convention of pi's `compaction.modelOverrides`); a key
            without a provider and a model id is rejected, as it would match no
            model. Each field resolves on its own: the model's override, then
            the top level (`nudgeAtTokens`, `nudgeAtPercent`), then the
            extension's 150000 tokens / 75%. The step between reminders is
            upstream's (15000 tokens, less when little room is left). A model
            switch re-resolves the session's limits. The extension reads the
            file once per load, so a changed file (a Home Manager switch)
            applies to sessions and subagents started afterwards, or after
            `/reload`.
          '';
        };
      }
      // lib.mapAttrs (_: message:
        lib.mkOption {
          type = lib.types.anything;
          visible = false;
          description = message;
        })
      renamed;

    # (M6.10)
    settings = lib.mkOption {
      type = lib.types.attrsOf (pkgs.formats.json {}).type;
      default = {};
      example = {nudgeAtPercent = 60;};
      description = ''
        Merged into `<agentDir>/infinite-context/settings.json` with
        `lib.recursiveUpdate`, on the right of what `reminders` renders: a
        nested key replaces only its own leaf. The extension reads
        `nudgeAtTokens`, `nudgeAtPercent` and `modelOverrides` (per exact
        `provider/modelId` the same two fields); it ignores unknown keys and an
        invalid value of its own, so neither is reported.
      '';
    };
  };

  config = lib.mkMerge [
    {
      # Enabled or not: a leftover old name is reported, never dropped.
      # Reads whether the option is defined, never its value.
      assertions =
        lib.mapAttrsToList (name: message: {
          assertion = !options.programs.piEconomics.infiniteContext.reminders.${name}.isDefined;
          inherit message;
        })
        renamed;
    }
    (lib.mkIf cfg.enable {
      # The extension drops an invalid value without a word (fail-open per
      # field), so the module rejects what its types let through.
      assertions =
        lib.concatMap ({
          name,
          rule,
        }: [
          {
            assertion = goodRange rule.nudgeAtTokens;
            message = "pi-economics: infiniteContext.reminders${name}.nudgeAtTokens is a token count or a range [min, max] with min < max, not ${builtins.toJSON rule.nudgeAtTokens}";
          }
          {
            assertion = rule.nudgeAtPercent == null || rule.nudgeAtPercent > 0;
            message = "pi-economics: infiniteContext.reminders${name}.nudgeAtPercent is a share of the model window in (0, 100], not 0";
          }
        ])
        namedRules
        ++ [
          {
            assertion = readsModelOverrides;
            message = "pi-economics: infiniteContext.src (the input pi-infinite-context) is older than upstream 9c08a04: its extensions/infinite-context/settings.ts reads no modelOverrides, so the extension would ignore reminders.modelOverrides; let the input follow 9c08a04 or later";
          }
        ]
        ++ map (key: {
          assertion = exactKey key;
          message = "pi-economics: infiniteContext.reminders.modelOverrides key ${builtins.toJSON key} is no exact \"provider/modelId\": the extension matches an override by the exact model only, so this one would apply to none";
        }) (lib.attrNames r.modelOverrides);

      programs.piEconomics.extensions.infinite-context = {
        path = "${cfg.package}/extensions/infinite-context";
        checkPath = "${cfg.src}/extensions/infinite-context/index.ts";
        input = "pi-infinite-context";
        forChildren = true;
        description = "context_map, context_fold, context_peek and context_search: folds ranges of the agent's own conversation by message id and reads the folded originals back on demand, without rewriting live messages. Also reminds the agent to fold: by default from 150k tokens or 75% of the model window, whichever comes first, then every 15k tokens; the limits (a token limit may be a range, drawn per branch) come from infiniteContext.reminders, for all models and per exact model.";
      };

      # Always written, even with every option at its default: the path stays
      # Home Manager-owned instead of a file the agent could create. Literal
      # text (spec §4).
      home.file."${pe.agentDir}/infinite-context/settings.json".text =
        builtins.toJSON (lib.recursiveUpdate rendered cfg.settings);
    })
  ];
}
