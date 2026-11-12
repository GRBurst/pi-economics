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
  components = ["bench" "actorSubagents" "tokenMeter" "analysisSkill" "cacheLifecycle" "experiments" "infiniteContext" "retry"];
  with' = cs: hm.eval {programs.piEconomics = lib.genAttrs cs (_: {enable = true;});};
  set = l: lib.sort lib.lessThan (lib.unique l);
  targets = cfg: map (f: f.target) (lib.attrValues cfg.home.file);
  # hm-session-vars.sh is built from the session variables, compared below.
  packages = cfg: lib.filter (p: !lib.hasSuffix "-hm-session-vars.sh" p) (map toString cfg.home.packages);
  union = f: set (lib.concatMap (c: f (with' [c])) components);
  all = with' components;
in {
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
