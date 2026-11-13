# Cases for modules/bench.nix (spec §7).
{
  lib,
  pkgs,
  hm,
  self,
  expect,
}: let
  inherit (expect) eq holds throws evaluates failed;
  pe = cfg: cfg.programs.piEconomics;
  fx = ../fixtures;
  benchVars = cfg: lib.filterAttrs (n: _: lib.hasPrefix "PI_BENCH_" n) cfg.home.sessionVariables;
  on = extra: hm.eval {programs.piEconomics.bench = {enable = true;} // extra;};
  # Registry entries of the two names the bench takes from the registry, as a
  # consumer's setup provides them (router-extraction design §7.3, §8.2).
  registry = {
    actor-subagents = {
      path = fx + "/ext-a";
      forChildren = false;
      description = "an actor";
    };
    task-router = {
      path = fx + "/ext-b";
      forChildren = false;
      description = "a router";
    };
  };
  onRegistry = extra:
    hm.eval {
      programs.piEconomics = {
        bench = {enable = true;} // extra;
        extensions = registry;
      };
    };
in
  {
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

    # (M6.14) The default: the extensions the bench loads by name (spec §7).
    # This flake's own two from their packages; actor-subagents and
    # task-router from the registry entry of that name, and absent without one
    # (router-extraction design §7.3). PI_BENCH_EXT_DIR links exactly these;
    # mkForce {} exports nothing.
    bench-extensions-default = let
      own = p: {
        infinite-context = "${p.infiniteContext.package}/extensions/infinite-context";
        token-meter = "${p.tokenMeter.package}";
      };
      alone = on {};
      reg = onRegistry {};
      # Every component of this flake, the registry filled by its modules,
      # and the actor's and the router's entries as pi-setup and the
      # router's flake add them.
      all = hm.eval {
        programs.piEconomics =
          lib.genAttrs ["bench" "tokenMeter" "cacheLifecycle" "experiments" "infiniteContext"] (_: {enable = true;})
          // {extensions = registry;};
      };
      ext = c: (pe c).bench.extensions;
      shared = c: lib.intersectLists (lib.attrNames (ext c)) (lib.attrNames (pe c).extensions);
      farm = name: c: eq "PI_BENCH_EXT_DIR (${name})" c.home.sessionVariables.PI_BENCH_EXT_DIR "${pkgs.linkFarm "pi-bench-extensions" (ext c)}";
    in
      eq "without registry entries: the own two" (ext alone) (own (pe alone))
      ++ eq "with registry entries: theirs too" (ext reg) (own (pe reg) // lib.mapAttrs (_: e: e.path) registry)
      ++ holds "every component: both registered names" (lib.all (n: lib.elem n (shared all)) ["actor-subagents" "task-router"])
      ++ eq "every component: each name the registry holds is its path" (lib.genAttrs (shared all) (n: (ext all).${n})) (lib.genAttrs (shared all) (n: (pe all).extensions.${n}.path))
      ++ farm "alone" alone
      ++ farm "registry" reg
      ++ farm "every component" all
      ++ eq "failed assertions" (failed "" reg ++ failed "" all) []
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

    # The router base of the orchestrator arms is read at run time from the
    # live router settings (router-extraction design §7.3; the bench's
    # router.test.ts holds the property): with the router enabled and
    # `router` unset, Nix defines no base and exports no PI_BENCH_ROUTER, and
    # the file the bench reads (`PI_BENCH_AGENT_SRC`/task-router/settings.json)
    # is the one the router's module writes. A definition is exported as it
    # is, the explicit override. The router is enabled as its own flake does
    # it: a registry entry beside the settings file.
    bench-router-default = let
      s = {
        models.sonnet.model = "m";
        localHealthUrl = "http://h:1";
        queueMaxSec = 5;
        randomize = {
          enabled = true;
          share = 0.2;
        };
        t0Limits.files = 3;
      };
      live = "task-router/settings.json";
      routerOn = {
        registry = {
          programs.piEconomics.extensions.task-router = {
            path = fx + "/ext-b";
            forChildren = false;
            description = "a router";
          };
          home.file.".pi/agent/${live}".text = builtins.toJSON s;
        };
      };
      one = name: router: let
        ev = bench:
          hm.eval {
            imports = [router];
            programs.piEconomics.bench = {enable = true;} // bench;
          };
        c = ev {};
        v = c.home.sessionVariables;
        set = ev {router.queueMaxSec = 9;};
      in
        eq "router (${name})" (pe c).bench.router {}
        ++ holds "unset: no PI_BENCH_ROUTER (${name})" (!(v ? PI_BENCH_ROUTER))
        ++ eq "the live file is the router's (${name})" (builtins.fromJSON c.home.file.".pi/agent/${live}".text) s
        ++ eq "the bench reads it (${name})" "${v.PI_BENCH_AGENT_SRC}/${live}" "${c.home.homeDirectory}/${c.home.file.".pi/agent/${live}".target}"
        ++ eq "set: exported as defined (${name})" (lib.importJSON set.home.sessionVariables.PI_BENCH_ROUTER) {queueMaxSec = 9;}
        ++ eq "failed assertions (${name})" (failed "" c) [];
    in
      lib.concatLists (lib.mapAttrsToList one routerOn)
      ++ holds "without the router: nothing exported" (!((on {}).home.sessionVariables ? PI_BENCH_ROUTER));

    # The consumer's own extensions (a provider login, a search tool) come in
    # through two lists of names from `extensions`, exported comma-separated:
    # `baseExtensions`, loaded by every run (every arm, the factor arms'
    # children, every judge), and `orchExtensions`, loaded by the orchestrator
    # factor arms and their children only. The bench names only the flake's.
  }
  // lib.concatMapAttrs (opt: var: let
    name = lib.toLower (lib.removeSuffix "Extensions" opt);
    msg = missing: "pi-economics: programs.piEconomics.bench.${opt} names ${missing}, which programs.piEconomics.bench.extensions does not define (the runs load each from the link of that name: define it there or leave it out)";
  in {
    "bench-${name}-extensions" = let
      exts = {
        auth-ext = fx + "/ext-a";
        search-ext = fx + "/ext-b";
      };
      c = on {
        extensions = exts;
        ${opt} = ["auth-ext" "search-ext" "infinite-context"];
      };
      off = hm.eval {programs.piEconomics.bench.${opt} = ["x"];};
    in
      eq var c.home.sessionVariables.${var} "auth-ext,search-ext,infinite-context"
      ++ eq "the link farm holds them" (lib.attrNames (pe c).bench.extensions) (lib.sort lib.lessThan (["auth-ext" "search-ext"] ++ lib.attrNames (pe (on {})).bench.extensions))
      ++ eq "failed assertions" (failed "" c) []
      ++ holds "the default exports nothing" (!((on {}).home.sessionVariables ? ${var}))
      ++ holds "off: nothing" (!(off.home.sessionVariables ? ${var}))
      ++ eq "off: no assertion" (failed "pi-economics:" off) [];

    # A name that `extensions` does not define has no link to load: an
    # assertion names every such name.
    "bench-${name}-extensions-undefined" = eq "failed assertions" (failed "pi-economics:" (on {
      extensions.auth-ext = fx + "/ext-a";
      ${opt} = ["search-ext" "auth-ext" "log-ext"];
    })) [(msg "search-ext, log-ext")];

    # `extensions = lib.mkForce {}` exports no link farm: the bench then looks
    # the names up in <agent source>/pi-economics/extensions (the registry's
    # links, M6) at run time, which evaluation cannot see, so the assertion
    # does not apply.
    "bench-${name}-extensions-no-farm" = let
      c = on {
        extensions = lib.mkForce {};
        ${opt} = ["auth-ext"];
      };
    in
      eq var c.home.sessionVariables.${var} "auth-ext"
      ++ holds "no link farm" (!(c.home.sessionVariables ? PI_BENCH_EXT_DIR))
      ++ eq "the agent source" c.home.sessionVariables.PI_BENCH_AGENT_SRC "/home/u/.pi/agent"
      ++ eq "failed assertions" (failed "" c) [];

    # A comma would split a name in the exported list, and the runtime trims its
    # entries: the type refuses a comma, white space and an empty name.
    "bench-${name}-extensions-type" = let
      v = names: (on {${opt} = names;}).home.sessionVariables.${var};
    in
      throws "a name with a comma" (v ["a,b"])
      ++ throws "an empty name" (v [""])
      ++ throws "a leading space" (v [" auth-ext"])
      ++ throws "a trailing space" (v ["auth-ext "])
      ++ throws "a space inside" (v ["a b"])
      ++ throws "a newline" (v ["a\nb"])
      ++ throws "a tab" (v ["a\tb"])
      ++ evaluates "control: plain names" (v ["infinite-context"]);
  }) {
    baseExtensions = "PI_BENCH_BASE_EXTENSIONS";
    orchExtensions = "PI_BENCH_ORCH_EXTENSIONS";
  }
  // {
    # (from review-m6; M5.13) A host's definition of one default name wins over
    # that name's mkDefault without a conflict and leaves the other defaults (spec
    # §7): checked for every name the default holds, actor-subagents and
    # task-router among them.
    bench-extensions-override = let
      defaults = (pe (onRegistry {})).bench.extensions;
      one = name: let
        c = onRegistry {extensions.${name} = "/x";};
        got = (pe c).bench.extensions;
      in
        eq "${name} is the host's" got.${name} "/x"
        ++ eq "the other defaults stay (${name})" (removeAttrs got [name]) (removeAttrs defaults [name])
        ++ eq "failed assertions (${name})" (failed "" c) [];
    in
      holds "the defaults hold actor-subagents and task-router" (defaults ? actor-subagents && defaults ? task-router)
      ++ lib.concatMap one (lib.attrNames defaults);
  }
