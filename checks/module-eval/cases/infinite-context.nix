# Cases for modules/infinite-context.nix (spec §4, §5.1, §5.2).
{
  lib,
  hm,
  self,
  expect,
}: let
  inherit (expect) eq holds failed throws evaluates;
  pe = cfg: cfg.programs.piEconomics;
  dirs = [".pi/agent" "custom/agent"];
  # dir: agentDir; ic: infiniteContext options, null = not enabled.
  eval = dir: ic:
    hm.eval {
      programs.piEconomics =
        {agentDir = dir;}
        // lib.optionalAttrs (ic != null) {infiniteContext = {enable = true;} // ic;};
    };
  sorted = lib.sort lib.lessThan;
  targets = cfg: map (f: f.target) (lib.attrValues cfg.home.file);
  fileAt = target: cfg: lib.findFirst (f: f.target == target) null (lib.attrValues cfg.home.file);
  settingsOf = dir: ic: (fileAt "${dir}/infinite-context/settings.json" (eval dir ic)).text;
  bare = hm.evalBare {};
  # Example values: a default range, exact overrides for two models (one a
  # range), and a provider rule that sets nothing.
  exampleReminders = {
    default.nudgeAtTokens = [100000 300000];
    overrides = {
      "example/model-a".nudgeAtTokens = 400000;
      "example/model-b" = {
        nudgeAtTokens = [200000 250000];
        nudgeAtPercent = 50;
      };
      example = {};
    };
  };
  # The file those values render: nulls and empty rules left out.
  exampleRendered = {
    nudgeAtTokens = [100000 300000];
    overrides = {
      "example/model-a".nudgeAtTokens = 400000;
      "example/model-b" = {
        nudgeAtTokens = [200000 250000];
        nudgeAtPercent = 50;
      };
    };
  };
  # The assertion messages of the infinite-context options.
  icFailed = ic: failed "pi-economics: infiniteContext." (eval ".pi/agent" ic);
in {
  # The cache patch's options left with it (upstream rejected the fold hint).
  infinite-context-removed = let
    o = (hm.options {}).programs.piEconomics.infiniteContext.reminders;
  in
    eq "options of the dropped cache patch" (lib.filter (n: o ? ${n}) ["prices" "cacheTtlMinutes" "foldHint"]) []
    # The former rule fields (startTokens, everyTokens) are no options: a
    # consumer still setting them fails evaluation instead of losing them.
    ++ throws "startTokens" (settingsOf ".pi/agent" {reminders.default.startTokens = 100000;})
    ++ throws "everyTokens" (settingsOf ".pi/agent" {reminders.overrides.anthropic.everyTokens = 100000;})
    ++ evaluates "nudgeAtTokens (control)" (settingsOf ".pi/agent" {reminders.overrides.anthropic.nudgeAtTokens = 100000;});

  # (M6.8) Off by default: no registry entry, no file.
  infinite-context-off = let
    c = eval ".pi/agent" null;
  in
    holds "no registry entry" (!(pe c).extensions ? infinite-context)
    ++ eq "home.file targets" (targets c) (targets bare);

  # (M6.8) On: the registry entry, loaded into children, its link following
  # agentDir; the existence probe reads the unpatched input, so evaluation
  # builds nothing.
  infinite-context-defaults = lib.concatMap (dir: let
    c = eval dir {};
    e = (pe c).extensions.infinite-context;
  in
    eq "registry entry (${dir})" {inherit (e) path input forChildren;} {
      path = "${(pe c).infiniteContext.package}/extensions/infinite-context";
      input = "pi-infinite-context";
      forChildren = true;
    }
    ++ eq "checkPath (${dir})" (toString e.checkPath) "${self.inputs.pi-infinite-context}/extensions/infinite-context/index.ts"
    ++ eq "derivations behind checkPath (${dir})"
    (lib.filter (v: v ? outputs) (lib.attrValues (builtins.getContext (toString e.checkPath)))) []
    ++ eq "failed assertions (${dir})" (failed "" c) []
    ++ eq "warnings (${dir})" c.warnings bare.warnings)
  dirs;

  # (M6.8) The package is the flake's, under the host's derivation name.
  infinite-context-package = let
    ic = (pe (eval ".pi/agent" {})).infiniteContext;
  in
    eq "drvPath" ic.package.drvPath self.packages.x86_64-linux.infinite-context.drvPath
    ++ eq "name" ic.package.name "pi-infinite-context-patched";

  # (M6.8) Files: the link and the settings file, always written; with every
  # option at its default the file is empty, so the extension runs on
  # upstream's defaults.
  infinite-context-files = lib.concatMap (dir:
    eq "home.file targets (${dir})" (sorted (targets (eval dir {})))
    (sorted (targets bare ++ ["${dir}/pi-economics/extensions/infinite-context" "${dir}/infinite-context/settings.json"]))
    ++ eq "settings text (${dir})" (settingsOf dir {}) "{}")
  dirs;

  # (M6.9) The reminder rules render as the extension reads them: `default` at
  # the top level, the rest under `overrides`; nulls and empty rules are left
  # out.
  infinite-context-reminders = let
    example = builtins.fromJSON (settingsOf ".pi/agent" {reminders = exampleReminders;});
    percent = builtins.fromJSON (settingsOf ".pi/agent" {
      reminders = {
        default.nudgeAtPercent = 60;
        overrides.anthropic.nudgeAtPercent = 100;
      };
    });
  in
    eq "example values" example exampleRendered
    ++ eq "percentages" percent {
      nudgeAtPercent = 60;
      overrides.anthropic.nudgeAtPercent = 100;
    }
    ++ eq "failed assertions" (icFailed {reminders = exampleReminders;}) [];

  # A range is [min, max] with min < max, a percentage is above 0: the
  # extension would drop any other value silently (fail-open per field).
  infinite-context-assertions = let
    range = name: v: "pi-economics: infiniteContext.reminders.${name}.nudgeAtTokens is a token count or a range [min, max] with min < max, not ${builtins.toJSON v}";
    zero = name: "pi-economics: infiniteContext.reminders.${name}.nudgeAtPercent is a share of the model window in (0, 100], not 0";
  in
    lib.concatMap (v:
      eq "default range ${builtins.toJSON v}" (icFailed {reminders.default.nudgeAtTokens = v;}) [(range "default" v)]
      ++ eq "override range ${builtins.toJSON v}" (icFailed {reminders.overrides."a/b".nudgeAtTokens = v;}) [(range ''overrides."a/b"'' v)])
    [[5 5] [6 5] [1] [1 2 3] []]
    ++ eq "default percent 0" (icFailed {reminders.default.nudgeAtPercent = 0;}) [(zero "default")]
    ++ eq "override percent 0" (icFailed {reminders.overrides.anthropic.nudgeAtPercent = 0;}) [(zero ''overrides."anthropic"'')]
    ++ eq "valid values (control)" (icFailed {
      reminders = {
        default = {
          nudgeAtTokens = [1 2];
          nudgeAtPercent = 0.5;
        };
        overrides.anthropic.nudgeAtTokens = 1;
      };
    }) [];

  # (M6.10) settings merge with lib.recursiveUpdate, the user's on the right:
  # a nested key replaces its own leaf, the rendered siblings survive.
  infinite-context-settings = lib.concatMap (dir: let
    got = builtins.fromJSON (settingsOf dir {
      reminders = exampleReminders;
      settings = {
        nudgeAtPercent = 60;
        overrides."example/model-a".nudgeAtPercent = 40;
      };
    });
  in
    eq "merged (${dir})" got (exampleRendered
      // {
        nudgeAtPercent = 60;
        overrides =
          exampleRendered.overrides
          // {
            "example/model-a" = {
              nudgeAtTokens = 400000;
              nudgeAtPercent = 40;
            };
          };
      }))
  dirs;
}
