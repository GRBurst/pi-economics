# The task-router (spec §2, §6): routes subagent spawns by task card through
# actor-subagents' spawn policy. Main session only: children do not route, and
# the router's policy, guards and outcome log belong to the orchestrator.
{
  config,
  lib,
  pkgs,
  ...
}: let
  pe = config.programs.piEconomics;
  cfg = pe.taskRouter;
in {
  options.programs.piEconomics.taskRouter = {
    enable = lib.mkEnableOption "the pi task-router extension (card-based routing of subagent spawns; requires actorSubagents)";
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../packages/task-router/package.nix {};
      defaultText = lib.literalExpression "pkgs.callPackage <pi-economics>/packages/task-router/package.nix { }";
      description = "The extension (package.json, index.ts, core/); its tests run when it builds.";
    };
    # (M5.9)
    settings = lib.mkOption {
      type = lib.types.attrsOf (pkgs.formats.json {}).type;
      default = {};
      example = {
        models = {
          qwen-local.health = "http://localhost:11545";
          haiku.model = "";
        };
        queueMaxSec = 60;
      };
      description = ''
        Written to `<agentDir>/task-router/settings.json` when non-empty.
        Free-form (spec §6.2): every key has a default in the package's
        core/settings.ts, which owns the schema, so `{}` writes no file.
        `models.<member>` merges field by field over the default member;
        `model = ""` removes it. `randomize` and `spotCheck` default to
        `enabled = false`.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    # (M5.8) Main session only (the host's pi-extensions.nix entry).
    programs.piEconomics.extensions.task-router = {
      path = "${cfg.package}";
      # The source, not the package: probing a build output would be
      # import-from-derivation.
      checkPath = ../packages/task-router/index.ts;
      forChildren = false;
      description = "Routes subagent spawns by task card: tier and effort by rule, Qwen chain, attempts and an outcome log (<agentDir>/task-router/outcomes/YYYY-MM.jsonl); registers the task_verdict tool.";
    };
    # (M5.9) Literal text (spec §4): checks read it with builtins.fromJSON.
    home.file."${pe.agentDir}/task-router/settings.json" =
      lib.mkIf (cfg.settings != {}) {text = builtins.toJSON cfg.settings;};
    # (M5.10) A hard dependency (spec §4.1).
    assertions = [
      {
        assertion = pe.actorSubagents.enable && (pe.actorSubagents.package.passthru.spawnPolicyApi or 0) >= 1;
        message = "pi-economics: taskRouter requires actorSubagents with passthru.spawnPolicyApi >= 1 (the router registers through registerSpawnPolicy, and shell.ts swallows its absence: without the patched build the router does nothing)";
      }
    ];
  };
}
