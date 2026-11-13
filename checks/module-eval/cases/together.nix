# Every component together (spec §8.1): enabling them all renders the union of
# what each renders alone, with no failed assertion and no warning. A milestone
# adds its component to `components`.
{
  lib,
  pkgs,
  hm,
  expect,
}: let
  inherit (expect) eq holds failed;
  components = ["bench" "tokenMeter" "analysisSkill" "cacheLifecycle" "experiments" "infiniteContext"];
  # Each evaluation has the actor in the registry, as pi-setup's bridge puts it there.
  with' = cs: hm.eval {programs.piEconomics = lib.genAttrs cs (_: {enable = true;}) // {extensions.actor-subagents = actor;};};
  set = l: lib.sort lib.lessThan (lib.unique l);
  targets = cfg: map (f: f.target) (lib.attrValues cfg.home.file);
  # hm-session-vars.sh is built from the session variables, compared below.
  packages = cfg: lib.filter (p: !lib.hasSuffix "-hm-session-vars.sh" p) (map toString cfg.home.packages);
  union = f: set (lib.concatMap (c: f (with' [c])) components);
  all = with' components;
  # Whether the actor is there is read from the registry (router-extraction
  # design §7.3): the warnings of cacheLifecycle and experiments.
  actor = import ../fixtures/actor-entry.nix;
  warnCl = "pi-economics: cacheLifecycle without actor-subagents in the registry (pi-setup's programs.pi.actorSubagents) loses warming while a session waits on its children (the warm policy reads __subagentsApi_v1)";
  warnEx = "pi-economics: experiments without actor-subagents in the registry (pi-setup's programs.pi.actorSubagents) loses arm inheritance by children (it reads spawn events from __subagentsApi_v1)";
  users = registry:
    hm.eval {
      programs.piEconomics =
        lib.genAttrs ["cacheLifecycle" "experiments"] (_: {enable = true;})
        // {extensions = registry;};
    };
in {
  actor-presence = let
    present = users {actor-subagents = actor;};
    absent = users {};
    bare = hm.evalBare {};
  in
    eq "registry entry: no new warning" present.warnings bare.warnings
    ++ eq "registry entry: failed assertions" (failed "" present) []
    ++ eq "no entry: one warning each" (lib.sort lib.lessThan (lib.subtractLists bare.warnings absent.warnings)) [warnCl warnEx]
    ++ eq "no entry: failed assertions" (failed "" absent) [];

  # (M6.15, from cases/retry.nix) The host's combination of M2-M6 from W5 on
  # (spec §9.1): the flake's children (the list pi-setup's bridge writes into
  # the actor's settings file), no activation entry while the host's script
  # runs.
  m6-host-like = let
    c = hm.eval {
      programs.piEconomics = {
        extensions.actor-subagents = actor;
        tokenMeter.enable = true;
        cacheLifecycle.enable = true;
        experiments.enable = true;
        infiniteContext.enable = true;
        piSettings.enable = false;
      };
    };
    childNames = map baseNameOf c.programs.piEconomics.childExtensions;
  in
    eq "children" childNames ["token-meter" "cache-lifecycle" "infinite-context"]
    ++ holds "no activation entry" (!(c.home.activation ? piSettingsMigrate))
    ++ eq "failed assertions" (failed "" c) []
    # (M6) The registry is no longer auto-discovered: one warning.
    ++ eq "new warnings" (lib.subtractLists (hm.evalBare {}).warnings c.warnings) ["pi-economics: piSettings.enable is false, so nothing lists the registry in settings.json's `extensions`, and pi does not auto-discover its links in .pi/agent/pi-economics/extensions: put programs.piEconomics.loadOrder at the front of `extensions` yourself"];

  components-together =
    eq "home.file targets" (set (targets all)) (union targets)
    ++ eq "home.packages" (set (packages all)) (union packages)
    ++ eq "session variables" (removeAttrs all.home.sessionVariables ["PI_BENCH_EXT_DIR"]) (removeAttrs (lib.foldl' (acc: c: acc // (with' [c]).home.sessionVariables) {} components) ["PI_BENCH_EXT_DIR"])
    # The one variable only a combination renders: the bench links
    # actor-subagents and task-router from their registry entries, those the
    # registry holds (router-extraction design §7.3).
    ++ eq "PI_BENCH_EXT_DIR" all.home.sessionVariables.PI_BENCH_EXT_DIR "${pkgs.linkFarm "pi-bench-extensions" ((with' ["bench"]).programs.piEconomics.bench.extensions
        // lib.mapAttrs (_: e: e.path) (lib.filterAttrs (n: _: lib.elem n ["actor-subagents" "task-router"]) all.programs.piEconomics.extensions))}"
    # The bench reads the router's base at run time (router-extraction design §7.3).
    ++ holds "no PI_BENCH_ROUTER" (!(all.home.sessionVariables ? PI_BENCH_ROUTER))
    ++ eq "activation entries" (set (lib.attrNames all.home.activation)) (union (cfg: lib.attrNames cfg.home.activation))
    ++ eq "failed assertions" (failed "" all) []
    ++ eq "warnings" all.warnings (hm.evalBare {}).warnings;
}
