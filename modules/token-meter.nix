# The token meter (spec §2, §4): one JSONL line per provider request (tokens,
# cost, quota) under <agentDir>/meter, loaded into children too; the reports
# meter-report and pi-analyse on PATH, and LOGS.md, the manual of every log
# pi-analyse reads.
{
  config,
  lib,
  pkgs,
  ...
}: let
  pe = config.programs.piEconomics;
  cfg = pe.tokenMeter;
  # settings.json: `settings`, `plans` without unset rates, and `currency.rates`.
  plan = p: {inherit (p) billing windows;} // lib.optionalAttrs (p.rate != null) {inherit (p) rate;};
  file =
    cfg.settings
    // lib.optionalAttrs (cfg.plans != {}) {plans = lib.mapAttrs (_: plan) cfg.plans;}
    // lib.optionalAttrs (cfg.currencyRates != {}) {currency.rates = cfg.currencyRates;};
in {
  options.programs.piEconomics.tokenMeter = {
    enable = lib.mkEnableOption "the pi token-meter extension (per-request token, cost and quota log) and its reports";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../packages/token-meter/package.nix {};
      defaultText = lib.literalExpression "pkgs.callPackage <pi-economics>/packages/token-meter/package.nix { }";
      description = ''
        The extension (package.json, index.ts, core/, LOGS.md); its tests run
        when it builds. `passthru.report` and `passthru.analyse` are the
        commands put on PATH (`meter-report`, `pi-analyse`).
      '';
    };

    settings = lib.mkOption {
      type = lib.types.attrsOf (pkgs.formats.json {}).type;
      default = {};
      example = {dir = "meter";};
      description = ''
        Written to `<agentDir>/token-meter/settings.json` when non-empty.
        Every key has a default in the package's core/settings.ts (`enabled`,
        `dir`, `rawRatelimit`), so `{}` writes no file.
      '';
    };

    # (M3a, design §9.2) The meter's input for `billing` on every line; the
    # analysis reads windows and the local rate from the same file.
    plans = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule {
        options = {
          billing = lib.mkOption {
            type = lib.types.enum ["subscription" "api" "free" "local"];
            description = "Billing class of the provider's requests.";
          };
          windows = lib.mkOption {
            type = lib.types.listOf (lib.types.enum ["5h" "7d"]);
            default = [];
            description = "Quota windows of a subscription.";
          };
          rate = lib.mkOption {
            type = lib.types.nullOr (lib.types.submodule {
              options = {
                amount = lib.mkOption {type = lib.types.numbers.nonnegative;};
                currency = lib.mkOption {type = lib.types.strMatching "[A-Z]{3}";};
                per = lib.mkOption {
                  type = lib.types.enum ["hour"];
                  default = "hour";
                };
              };
            });
            default = null;
            description = "Price of a local provider's active (serving) time; only with `billing = \"local\"`.";
          };
        };
      });
      default = {};
      example = {
        anthropic = {
          billing = "subscription";
          windows = ["5h" "7d"];
        };
        llama = {
          billing = "local";
          rate = {
            amount = 0.13;
            currency = "EUR";
          };
        };
      };
      description = ''
        Billing class, quota windows and local rate per provider name;
        unknown providers count as "api". Written to the key `plans` of
        `<agentDir>/token-meter/settings.json` when non-empty (it replaces a
        `plans` key in `settings`).
      '';
    };
  };

  options.programs.piEconomics.tokenMeter.currencyRates = lib.mkOption {
    type = lib.types.attrsOf lib.types.numbers.positive;
    default = {};
    example = {"USD/EUR" = 0.92;};
    description = ''
      Conversion rates between the currencies of the analysis (design §9.3):
      the key `"FROM/TO"` (three capitals each) says how many TO one FROM
      is; the inverse is used when only the opposite key is given. The
      Budget section sums costs across currencies (the API-eq cash dollars,
      each local rate's currency) only with a rate between them, and
      otherwise keeps separate columns. Written to `currency.rates` of
      `<agentDir>/token-meter/settings.json`.
    '';
  };

  config = lib.mkIf cfg.enable {
    # (M3.3) Loaded into children too: their requests are what the meter is for.
    programs.piEconomics.extensions.token-meter = {
      path = "${cfg.package}";
      # The source, not the package: probing a build output would be
      # import-from-derivation.
      checkPath = ../packages/token-meter/index.ts;
      forChildren = true;
      description = "Appends one JSONL line per provider request (tokens, cost, quota headers, retries) to <agentDir>/meter/YYYY-MM.jsonl; no prompt or response text.";
    };

    # (M3a) A rate prices a local provider's active time (design §9.3).
    assertions = let
      bad = lib.attrNames (lib.filterAttrs (_: p: p.rate != null && p.billing != "local") cfg.plans);
    in
      [
        {
          assertion = bad == [];
          message = "pi-economics: tokenMeter.plans: a rate is set but billing is not \"local\" for ${lib.concatStringsSep ", " bad}";
        }
      ]
      # (M8) A key is two ISO-style codes; the key is short, so a regex is fine.
      ++ map (k: {
        assertion = builtins.match "[A-Z]{3}/[A-Z]{3}" k != null;
        message = "pi-economics: tokenMeter.currencyRates key ${k} is not \"XXX/YYY\"";
      }) (lib.attrNames cfg.currencyRates);

    # (M3.4)
    home.packages = [cfg.package.report cfg.package.analyse];
    home.file."${pe.agentDir}/LOGS.md".source = "${cfg.package}/LOGS.md";

    # (M3.5) Literal text (spec §4): checks read it with builtins.fromJSON.
    home.file."${pe.agentDir}/token-meter/settings.json" =
      lib.mkIf (file != {}) {text = builtins.toJSON file;};
  };
}
