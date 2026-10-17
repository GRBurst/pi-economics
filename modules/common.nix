# Shared by every component (spec §4, §5.1, §5.4):
#  - agentDir: pi's agent directory, relative to home;
#  - extensions: the extension registry, rendered as links and existence
#    assertions (childExtensions follows in M2, with actorSubagents);
#  - piSettings: leaf edits of pi's mutable settings.json, contributed per
#    component under ops.<contributor> and run by one activation entry.
{
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.programs.piEconomics;

  # (M0.8) One registry entry.
  extensionModule = {config, ...}: {
    options = {
      path = lib.mkOption {
        type = lib.types.path;
        description = "What `<agentDir>/extensions/<name>` links to: the extension's directory.";
      };
      checkPath = lib.mkOption {
        type = lib.types.path;
        default = config.path;
        defaultText = lib.literalExpression "path";
        description = ''
          What the existence assertion probes. For a patched source, the
          unpatched input's entry file: probing a derivation's output would be
          import-from-derivation, and a patch that no longer applies fails the
          package's build instead.
        '';
      };
      input = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Where the extension comes from; the existence assertion names it.";
      };
      forChildren = lib.mkOption {
        type = lib.types.bool;
        description = "Whether actor-subagents children load the extension (`childExtensions`, rendered from M2 on).";
      };
      description = lib.mkOption {
        type = lib.types.str;
        description = "What the extension does.";
      };
    };
  };
in {
  options.programs.piEconomics = {
    # (M0.7)
    agentDir = lib.mkOption {
      type = lib.types.strMatching "[^/](.*[^/])?";
      default = ".pi/agent";
      description = ''
        pi's agent directory, relative to home, without a leading or trailing
        slash. pi's PI_CODING_AGENT_DIR is not modelled: a host that moves the
        agent directory sets this option.
      '';
    };

    # (M0.8)
    extensions = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule extensionModule);
      default = {};
      description = ''
        The extension registry, keyed by install name. Each entry is linked as
        `<agentDir>/extensions/<name>` (Home Manager rejects a second link of
        the same name) and its `checkPath` must exist. Components add
        themselves; a host adds its own extensions.
      '';
    };
  };

  config = {
    # (M0.8)
    home.file = lib.mapAttrs' (name: e:
      lib.nameValuePair "${cfg.agentDir}/extensions/${name}" {source = e.path;})
    cfg.extensions;

    # (M0.9) An upstream rename breaks evaluation instead of leaving a link
    # that pi silently skips.
    assertions =
      lib.mapAttrsToList (name: e: {
        assertion = builtins.pathExists e.checkPath;
        message =
          "pi-economics: extension '${name}' not found at ${toString e.checkPath}"
          + (
            if e.input == null
            then "."
            else "; the ${e.input} input may have renamed or removed it."
          );
      })
      cfg.extensions;
  };
}
