# pi-retry (spec §2, §4, §5.4): retries transient provider errors with
# backoff. The upstream extension with one local patch
# (packages/retry/package.nix), linked through the registry for sessions and
# children; no file of its own: its settings live in pi's mutable
# settings.json, edited through piSettings ops.
{
  config,
  lib,
  pkgs,
  ...
}: let
  pe = config.programs.piEconomics;
  cfg = pe.retry;

  removePackage = value: {
    op = "removeWhere";
    path = ["packages"];
    inherit value;
  };

  # (M6.13) One `set` per leaf of settings, under piRetry, at order 500: before
  # the child rule's ensureContains (1000). A list is a leaf, replaced whole;
  # no whole object is set, so keys written by pi or the user survive.
  leaves = path: v:
    if lib.isAttrs v
    then lib.concatLists (lib.mapAttrsToList (k: leaves (path ++ [k])) v)
    else [
      {
        op = "set";
        inherit path;
        value = v;
        order = 500;
      }
    ];
in {
  options.programs.piEconomics.retry = {
    enable = lib.mkEnableOption "pi-retry, retries of transient provider errors with backoff";

    src = lib.mkOption {
      type = lib.types.path;
      internal = true;
      description = ''
        The unpatched upstream source. The flake's homeModules.default sets it
        from its input `pi-retry`; the registry's existence assertion probes it.
      '';
    };

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../packages/retry/package.nix {inherit (cfg) src;};
      defaultText = lib.literalExpression "pkgs.callPackage <pi-economics>/packages/retry/package.nix { src = <input pi-retry>; }";
      description = "The patched extension, the whole repository (pi finds `retry.ts` through `package.json`).";
    };

    # (M6.13)
    settings = lib.mkOption {
      type = lib.types.attrsOf (pkgs.formats.json {}).type;
      default = {};
      example = {
        maxDelayMs = 60000;
        subagents.enabled = true;
      };
      description = ''
        pi-retry's keys under `piRetry` in pi's mutable settings file
        (`piSettings.file`), one `set` per leaf at order 500 (upstream keys:
        `maxRetriesAtMaxDelay`, `baseDelayMs`, `maxDelayMs`, `multiplier`,
        `messageFreeRetries`, `subagents.*`). Applied by the activation entry
        `piSettingsMigrate`, so only while `piSettings.enable`. With
        actorSubagents enabled, the child rule is added to
        `piRetry.subagents.match.systemPromptRegex` after these.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    programs.piEconomics.extensions.pi-retry = {
      path = "${cfg.package}";
      checkPath = "${cfg.src}/retry.ts";
      input = "pi-retry";
      forChildren = true;
      description = "Retries 400/413, credit and connection errors with backoff, inline for children and one-shot (print/json) hosts; never retries a hard quota such as OpenRouter's daily free-tier cap.";
    };

    # (M6.12) Today's ops (checks/pi-settings-migrate/today-ops.nix): the two
    # stale-package removals, then the child rule only with actorSubagents
    # (spec §4.1, no warning), then the settings' leaves.
    programs.piEconomics.piSettings.ops.retry =
      [
        (removePackage "https://github.com/monotykamary/pi-retry")
        (removePackage "git:github.com/monotykamary/pi-retry")
      ]
      ++ lib.optional pe.actorSubagents.enable {
        op = "ensureContains";
        path = ["piRetry" "subagents" "match" "systemPromptRegex"];
        value = {
          pattern = ''^You were spawned by "'';
          flags = "m";
        };
      }
      ++ leaves ["piRetry"] cfg.settings;
  };
}
