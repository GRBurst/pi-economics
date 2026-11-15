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
  # Example values: a top-level range, exact overrides for two models (one a
  # range), and an override that sets nothing.
  exampleReminders = {
    nudgeAtTokens = [100000 300000];
    modelOverrides = {
      "example/model-a".nudgeAtTokens = 400000;
      "example/model-b" = {
        nudgeAtTokens = [200000 250000];
        nudgeAtPercent = 50;
      };
      "example/model-c" = {};
    };
  };
  # The file those values render: nulls and empty overrides left out.
  exampleRendered = {
    nudgeAtTokens = [100000 300000];
    modelOverrides = {
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
    ++ throws "startTokens" (settingsOf ".pi/agent" {reminders.startTokens = 100000;})
    ++ throws "everyTokens" (settingsOf ".pi/agent" {reminders.modelOverrides."a/b".everyTokens = 100000;})
    ++ evaluates "nudgeAtTokens (control)" (settingsOf ".pi/agent" {reminders.modelOverrides."a/b".nudgeAtTokens = 100000;});

  # 0.3.2: the reminders patch is gone, the options take upstream's names
  # (`default` became the top level, `overrides` modelOverrides). The old
  # names are hidden stubs: defined, enabled or not, each fails one assertion
  # naming its replacement, and renders nothing.
  infinite-context-renamed = let
    messages = {
      default = "pi-economics: infiniteContext.reminders.default was removed in 0.3.2: set infiniteContext.reminders.nudgeAtTokens and infiniteContext.reminders.nudgeAtPercent (the top level of the extension's settings file)";
      overrides = "pi-economics: infiniteContext.reminders.overrides was renamed in 0.3.2 to infiniteContext.reminders.modelOverrides, keyed by exact \"provider/modelId\" only: the extension has no provider-wide rules";
    };
    o = (hm.options {}).programs.piEconomics.infiniteContext.reminders;
    off = ic: failed "pi-economics:" (hm.eval {programs.piEconomics.infiniteContext = ic;});
  in
    eq "default, enabled" (icFailed {reminders.default.nudgeAtTokens = 400000;}) [messages.default]
    ++ eq "overrides, enabled" (icFailed {reminders.overrides."a/b".nudgeAtTokens = 400000;}) [messages.overrides]
    ++ eq "overrides with a provider key, enabled" (icFailed {reminders.overrides.anthropic.nudgeAtPercent = 50;}) [messages.overrides]
    ++ eq "default, not enabled" (off {reminders.default.nudgeAtPercent = 50;}) [messages.default]
    ++ eq "overrides, not enabled" (off {reminders.overrides."a/b" = {};}) [messages.overrides]
    ++ eq "renders nothing" (settingsOf ".pi/agent" {reminders.default.nudgeAtTokens = 400000;}) "{}"
    ++ holds "default hidden from the option docs" ((o.default.visible or null) == false)
    ++ holds "overrides hidden from the option docs" ((o.overrides.visible or null) == false)
    ++ eq "the new names (control)" (icFailed {
      reminders = {
        nudgeAtTokens = 400000;
        modelOverrides."a/b".nudgeAtPercent = 50;
      };
    }) [];

  # Upstream matches an override by the exact "provider/id" of the model
  # (settings.ts parseSettings): a key without a provider and a model id would
  # apply to no model, silently.
  infinite-context-keys = let
    key = k: "pi-economics: infiniteContext.reminders.modelOverrides key ${builtins.toJSON k} is no exact \"provider/modelId\": the extension matches an override by the exact model only, so this one would apply to none";
  in
    lib.concatMap (k: eq "key ${builtins.toJSON k}" (icFailed {reminders.modelOverrides.${k}.nudgeAtTokens = 1;}) [(key k)])
    ["anthropic" "" "/m" "a/" "/"]
    ++ eq "a key that sets nothing" (icFailed {reminders.modelOverrides.anthropic = {};}) [(key "anthropic")]
    ++ eq "exact keys (control)" (icFailed {
      reminders.modelOverrides = {
        "a/b".nudgeAtTokens = 1;
        "llama/qwen3.8".nudgeAtTokens = [1 2];
        "openrouter/org/model".nudgeAtPercent = 50;
      };
    }) [];

  # The module renders upstream's settings shape since 9c08a04 (modelOverrides,
  # re-resolved at model_select). A consumer's input of an older upstream would
  # ignore modelOverrides silently (fail-open), so the module probes the
  # source (a path of the input, read at evaluation: no IFD).
  infinite-context-upstream = let
    old = "pi-economics: infiniteContext.src (the input pi-infinite-context) is older than upstream 9c08a04: its extensions/infinite-context/settings.ts reads no modelOverrides, so the extension would ignore reminders.modelOverrides; let the input follow 9c08a04 or later";
  in
    eq "an input before 9c08a04" (icFailed {src = ../fixtures/ic-before-9c08a04;}) [old]
    ++ eq "an input before 9c08a04, overrides set" (icFailed {
      src = ../fixtures/ic-before-9c08a04;
      reminders.modelOverrides."a/b".nudgeAtTokens = 1;
    }) [old]
    ++ eq "a source without settings.ts" (icFailed {src = ../fixtures/ext-a;}) [old]
    ++ eq "the locked input (control)" (icFailed {}) [];

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

  # (M6.8) The package is the flake's: a copy of the unpatched upstream (0.3.2).
  infinite-context-package = let
    ic = (pe (eval ".pi/agent" {})).infiniteContext;
  in
    eq "drvPath" ic.package.drvPath self.packages.x86_64-linux.infinite-context.drvPath
    ++ eq "name" ic.package.name "pi-infinite-context";

  # (M6.8) Files: the link and the settings file, always written; with every
  # option at its default the file is empty, so the extension runs on
  # upstream's defaults.
  infinite-context-files = lib.concatMap (dir:
    eq "home.file targets (${dir})" (sorted (targets (eval dir {})))
    (sorted (targets bare ++ ["${dir}/pi-economics/extensions/infinite-context" "${dir}/infinite-context/settings.json"]))
    ++ eq "settings text (${dir})" (settingsOf dir {}) "{}")
  dirs;

  # (M6.9) The reminder options render as the extension reads them: the top
  # level as the file's, modelOverrides under its own key; nulls and empty
  # overrides are left out.
  infinite-context-reminders = let
    example = builtins.fromJSON (settingsOf ".pi/agent" {reminders = exampleReminders;});
    percent = builtins.fromJSON (settingsOf ".pi/agent" {
      reminders = {
        nudgeAtPercent = 60;
        modelOverrides."a/b".nudgeAtPercent = 100;
      };
    });
  in
    eq "example values" example exampleRendered
    ++ eq "percentages" percent {
      nudgeAtPercent = 60;
      modelOverrides."a/b".nudgeAtPercent = 100;
    }
    ++ eq "failed assertions" (icFailed {reminders = exampleReminders;}) [];

  # A range is [min, max] with min < max, a percentage is above 0: the
  # extension would drop any other value silently (fail-open per field).
  infinite-context-assertions = let
    range = name: v: "pi-economics: infiniteContext.reminders${name}.nudgeAtTokens is a token count or a range [min, max] with min < max, not ${builtins.toJSON v}";
    zero = name: "pi-economics: infiniteContext.reminders${name}.nudgeAtPercent is a share of the model window in (0, 100], not 0";
  in
    lib.concatMap (v:
      eq "top-level range ${builtins.toJSON v}" (icFailed {reminders.nudgeAtTokens = v;}) [(range "" v)]
      ++ eq "override range ${builtins.toJSON v}" (icFailed {reminders.modelOverrides."a/b".nudgeAtTokens = v;}) [(range ''.modelOverrides."a/b"'' v)])
    [[5 5] [6 5] [1] [1 2 3] []]
    ++ eq "top-level percent 0" (icFailed {reminders.nudgeAtPercent = 0;}) [(zero "")]
    ++ eq "override percent 0" (icFailed {reminders.modelOverrides."a/b".nudgeAtPercent = 0;}) [(zero ''.modelOverrides."a/b"'')]
    ++ eq "valid values (control)" (icFailed {
      reminders = {
        nudgeAtTokens = [1 2];
        nudgeAtPercent = 0.5;
        modelOverrides."a/b".nudgeAtTokens = 1;
      };
    }) [];

  # (M6.10) settings merge with lib.recursiveUpdate, the user's on the right:
  # a nested key replaces its own leaf, the rendered siblings survive.
  infinite-context-settings = lib.concatMap (dir: let
    got = builtins.fromJSON (settingsOf dir {
      reminders = exampleReminders;
      settings = {
        nudgeAtPercent = 60;
        modelOverrides."example/model-a".nudgeAtPercent = 40;
      };
    });
  in
    eq "merged (${dir})" got (exampleRendered
      // {
        nudgeAtPercent = 60;
        modelOverrides =
          exampleRendered.modelOverrides
          // {
            "example/model-a" = {
              nudgeAtTokens = 400000;
              nudgeAtPercent = 40;
            };
          };
      }))
  dirs;
}
