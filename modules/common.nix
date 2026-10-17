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

  # (M0.12) One edit of pi's settings.json.
  opModule = {
    options = {
      op = lib.mkOption {
        type = lib.types.enum ["set" "ensureContains" "removeWhere"];
        description = ''
          `set`: the leaf becomes `value`. `ensureContains`: `value` is appended
          to the list at `path` unless an equal element is there. `removeWhere`:
          the list's elements equal to `value` are removed.
        '';
      };
      path = lib.mkOption {
        type = lib.types.nonEmptyListOf lib.types.str;
        example = ["piRetry" "subagents" "match" "systemPromptRegex"];
        description = "Object keys from the root to the leaf: a list, never a dotted string, and never empty (no whole-object set).";
      };
      value = lib.mkOption {
        type = (pkgs.formats.json {}).type;
        description = "The leaf (`set`) or the list element (`ensureContains`, `removeWhere`).";
      };
      order = lib.mkOption {
        type = lib.types.int;
        default = 1000;
        description = "Ops run sorted by (order, contributor key, position in the contributor's list).";
      };
    };
  };

  # (M0.12) Every contributor's ops by (order, key, index): keying by
  # contributor makes the order independent of the modules' import order.
  sortedOps = let
    flat = lib.concatLists (lib.mapAttrsToList
      (key: ops: lib.imap0 (index: op: op // {inherit key index;}) ops)
      cfg.piSettings.ops);
    before = a: b:
      if a.order != b.order
      then a.order < b.order
      else if a.key != b.key
      then a.key < b.key
      else a.index < b.index;
  in
    lib.sort before flat;
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

    piSettings = {
      # (M0.11)
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether the activation entry `piSettingsMigrate` is rendered. While false, none is, whatever ops exist.";
      };
      file = lib.mkOption {
        type = lib.types.str;
        default = "${cfg.agentDir}/settings.json";
        defaultText = lib.literalExpression ''"''${config.programs.piEconomics.agentDir}/settings.json"'';
        description = "pi's settings.json: an absolute path, or one relative to home.";
      };
      after = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [];
        description = "Activation entries `piSettingsMigrate` runs after, besides `writeBoundary`.";
      };

      # (M0.12)
      ops = lib.mkOption {
        type = lib.types.attrsOf (lib.types.listOf (lib.types.submodule opModule));
        default = {};
        description = ''
          Leaf edits of pi's mutable settings.json, keyed by contributor (a
          component's name, or a key of the host's own such as `host`). All
          contributors' ops run in one jq program, sorted by (order,
          contributor key, position in the list), each skipped on its own
          when the file has another shape on the path; `false` on the way
          leaves the whole file untouched. See docs/pi-economics.md.
        '';
      };
      sortedOps = lib.mkOption {
        type = lib.types.listOf lib.types.attrs;
        readOnly = true;
        internal = true;
        description = "The ops in execution order, each with its contributor `key` and `index` (read by the checks).";
      };
    };
  };

  config = {
    # (M0.12)
    programs.piEconomics.piSettings = {
      inherit sortedOps;
    };

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
