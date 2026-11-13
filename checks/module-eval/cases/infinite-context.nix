# Cases for modules/infinite-context.nix (spec §4, §5.1, §5.2).
{
  lib,
  hm,
  self,
  expect,
}: let
  inherit (expect) eq holds failed;
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
  # Example values: exact overrides for two models.
  exampleReminders = {
    overrides = {
      "example/model-a" = {
        startTokens = 200000;
        everyTokens = 50000;
      };
      "example/model-b" = {
        startTokens = 200000;
        everyTokens = 50000;
      };
    };
  };
in {
  # The cache patch's options left with it (upstream rejected the fold hint).
  infinite-context-removed = let
    o = (hm.options {}).programs.piEconomics.infiniteContext.reminders;
  in
    eq "options of the dropped cache patch" (lib.filter (n: o ? ${n}) ["prices" "cacheTtlMinutes" "foldHint"]) [];

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
  # option at its default the file is today's, byte for byte (spec §9.1 W5).
  infinite-context-files = lib.concatMap (dir:
    eq "home.file targets (${dir})" (sorted (targets (eval dir {})))
    (sorted (targets bare ++ ["${dir}/extensions/infinite-context" "${dir}/infinite-context/settings.json"]))
    ++ eq "settings text (${dir})" (settingsOf dir {}) ''{"reminders":{"default":{},"overrides":{}}}'')
  dirs;

  # (M6.9) The reminder options render as the host's piContextReminders did (spec §5.2):
  # nulls are left out.
  infinite-context-reminders = let
    example = builtins.fromJSON (settingsOf ".pi/agent" {reminders = exampleReminders;});
    all = builtins.fromJSON (settingsOf ".pi/agent" {
      reminders = {
        default.startTokens = 150000;
        overrides.anthropic.everyTokens = 20000;
      };
    });
  in
    eq "example values" example {
      reminders = {
        default = {};
        inherit (exampleReminders) overrides;
      };
    }
    ++ eq "every option" all {
      reminders = {
        default.startTokens = 150000;
        overrides.anthropic.everyTokens = 20000;
      };
    };

  # (M6.10) settings merge with lib.recursiveUpdate, the user's on the right:
  # a nested key replaces its own leaf, the rendered siblings survive.
  infinite-context-settings = lib.concatMap (dir: let
    got = builtins.fromJSON (settingsOf dir {
      reminders = exampleReminders;
      settings = {
        nudgeAtPercent = 60;
        reminders.default.everyTokens = 5000;
        reminders.overrides."example/model-a".startTokens = 300000;
      };
    });
  in
    eq "merged (${dir})" got {
      nudgeAtPercent = 60;
      reminders = {
        default.everyTokens = 5000;
        overrides =
          exampleReminders.overrides
          // {
            "example/model-a" = {
              startTokens = 300000;
              everyTokens = 50000;
            };
          };
      };
    })
  dirs;
}
