# Cases for modules/bench.nix (spec §7).
{
  lib,
  pkgs,
  hm,
  self,
  expect,
}: let
  inherit (expect) eq holds failed;
  pe = cfg: cfg.programs.piEconomics;
  fx = ../fixtures;
  benchVars = cfg: lib.filterAttrs (n: _: lib.hasPrefix "PI_BENCH_" n) cfg.home.sessionVariables;
  on = extra: hm.eval {programs.piEconomics.bench = {enable = true;} // extra;};
in {
  # (M1.5) Off by default: no variable, no package.
  bench-off = let
    c = hm.eval {};
    b = hm.evalBare {};
  in
    eq "PI_BENCH_ variables" (benchVars c) {}
    ++ eq "home.packages" (map toString c.home.packages) (map toString b.home.packages);

  # (M1.5) Enabled with defaults: the package and the two variables that
  # follow agentDir. Every other option is empty and exports nothing.
  bench-defaults = lib.concatMap (dir: let
    c = hm.eval {
      programs.piEconomics = {
        agentDir = dir;
        bench.enable = true;
      };
    };
    src = "${c.home.homeDirectory}/${dir}";
  in
    eq "PI_BENCH_ variables (${dir})" (benchVars c) {
      PI_BENCH_DATA = "${src}/bench";
      PI_BENCH_AGENT_SRC = src;
    }
    ++ holds "home.packages holds the bench (${dir})" (lib.elem (toString (pe c).bench.package) (map toString c.home.packages))
    ++ eq "home.file names (${dir})" (lib.attrNames c.home.file) (lib.attrNames (hm.evalBare {}).home.file)
    ++ eq "failed assertions (${dir})" (failed "" c) []
    ++ eq "warnings (${dir})" c.warnings (hm.evalBare {}).warnings)
  [".pi/agent" "custom/agent"];

  # (M1.5) With the default agentDir, PI_BENCH_DATA is the bench's own default
  # (packages/bench/src/config.ts, `data`); the default package is the flake's.
  bench-today = let
    c = on {};
  in
    eq "PI_BENCH_DATA" c.home.sessionVariables.PI_BENCH_DATA "/home/u/.pi/agent/bench"
    ++ eq "package" (pe c).bench.package.drvPath self.packages.x86_64-linux.bench.drvPath;

  # (M1.6)
  bench-paths = let
    v =
      (on {
        dataDir = "/d";
        workDir = "/w";
        agentsBaseline = "/b.md";
      }).home.sessionVariables;
  in
    eq "PI_BENCH_DATA" v.PI_BENCH_DATA "/d"
    ++ eq "PI_BENCH_WORK" v.PI_BENCH_WORK "/w"
    ++ eq "PI_BENCH_AGENTS_OFF" v.PI_BENCH_AGENTS_OFF "/b.md";

  # (M1.7) One link per name, in a directory of links.
  bench-extensions = let
    exts = {
      ext-a = fx + "/ext-a";
      ext-b = fx + "/ext-b";
    };
    v = (on {extensions = exts;}).home.sessionVariables;
  in
    eq "PI_BENCH_EXT_DIR" v.PI_BENCH_EXT_DIR "${pkgs.linkFarm "pi-bench-extensions" exts}";
}
