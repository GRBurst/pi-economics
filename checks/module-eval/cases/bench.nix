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
      # (M6.14) The default extensions (bench-extensions-default).
      PI_BENCH_EXT_DIR = "${pkgs.linkFarm "pi-bench-extensions" (pe c).bench.extensions}";
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
    # (M6.14) Definitions add to the defaults.
    eq "PI_BENCH_EXT_DIR" v.PI_BENCH_EXT_DIR "${pkgs.linkFarm "pi-bench-extensions" ((pe (on {})).bench.extensions // exts)}";

  # (M6.14) The default: the flake's packages the bench loads by name (spec
  # §7), each the path its registry entry links; mkForce {} exports nothing.
  bench-extensions-default = let
    c = on {};
    p = pe c;
  in
    eq "extensions" p.bench.extensions {
      actor-subagents = "${p.actorSubagents.package}/extensions/actor-subagents";
      infinite-context = "${p.infiniteContext.package}/extensions/infinite-context";
      pi-retry = "${p.retry.package}";
      token-meter = "${p.tokenMeter.package}";
      task-router = "${p.taskRouter.package}";
    }
    ++ holds "mkForce {} exports nothing" (!((on {extensions = lib.mkForce {};}).home.sessionVariables ? PI_BENCH_EXT_DIR));

  # (M1.8) The router base as a JSON file, read back without building.
  bench-router = let
    router = {
      models.worker = "m";
      localHealthUrl = "http://h:1";
      randomize.enabled = false;
    };
    v = (on {inherit router;}).home.sessionVariables;
  in
    eq "PI_BENCH_ROUTER" (lib.importJSON v.PI_BENCH_ROUTER) router;

  # (M5.12) With taskRouter, the arms get its model keys and both switches
  # off; a definition replaces one key; without taskRouter nothing (spec §7).
  bench-router-default = let
    s = {
      models.sonnet.model = "m";
      localHealthUrl = "http://h:1";
      queueMaxSec = 5;
      randomize = {
        enabled = true;
        share = 0.2;
      };
      spotCheck = {
        enabled = true;
        share = 0.1;
      };
      t0Limits.files = 3;
      profiles.x.ability = "read";
    };
    ev = more:
      hm.eval {
        programs.piEconomics =
          {
            bench.enable = true;
            actorSubagents.enable = true;
            taskRouter = {
              enable = true;
              settings = s;
            };
          }
          // more;
      };
    want = {
      models.sonnet.model = "m";
      localHealthUrl = "http://h:1";
      queueMaxSec = 5;
      randomize.enabled = false;
      spotCheck.enabled = false;
    };
    c = ev {};
  in
    eq "router" (pe c).bench.router want
    ++ eq "PI_BENCH_ROUTER" (lib.importJSON c.home.sessionVariables.PI_BENCH_ROUTER) want
    ++ eq "a definition replaces one key" (pe (ev {
      bench = {
        enable = true;
        router.queueMaxSec = 9;
      };
    })).bench.router (want // {queueMaxSec = 9;})
    ++ eq "empty settings: the switches only" (pe (ev {taskRouter.enable = true;})).bench.router {
      randomize.enabled = false;
      spotCheck.enabled = false;
    }
    ++ holds "without taskRouter: nothing exported" (!((hm.eval {programs.piEconomics.bench.enable = true;}).home.sessionVariables ? PI_BENCH_ROUTER));

  # (from review-m6; M5.13) A host's definition of one default name wins over
  # that name's mkDefault without a conflict and leaves the other defaults (spec
  # §7): checked for every name the default holds, pi-retry and task-router
  # among them.
  bench-extensions-override = let
    defaults = (pe (on {})).bench.extensions;
    one = name: let
      c = on {extensions.${name} = "/x";};
      got = (pe c).bench.extensions;
    in
      eq "${name} is the host's" got.${name} "/x"
      ++ eq "the other defaults stay (${name})" (removeAttrs got [name]) (removeAttrs defaults [name])
      ++ eq "failed assertions (${name})" (failed "" c) [];
  in
    holds "the defaults hold pi-retry and task-router" (defaults ? pi-retry && defaults ? task-router)
    ++ lib.concatMap one (lib.attrNames defaults);
}
