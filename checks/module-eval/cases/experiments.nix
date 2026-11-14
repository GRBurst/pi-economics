# Cases for modules/experiments.nix (spec §4, §4.1, §5.1), and the host's
# combination of M2–M4's components.
{
  lib,
  hm,
  self,
  expect,
  version,
}: let
  inherit (expect) eq holds failed;
  pe = cfg: cfg.programs.piEconomics;
  dirs = [".pi/agent" "custom/agent"];
  # dir: agentDir; ex: experiments options, null = not enabled; more: other
  # programs.piEconomics options.
  eval = dir: ex: more:
    hm.eval {
      programs.piEconomics =
        {agentDir = dir;}
        // lib.optionalAttrs (ex != null) {experiments = {enable = true;} // ex;}
        // more;
    };
  sorted = lib.sort lib.lessThan;
  targets = cfg: map (f: f.target) (lib.attrValues cfg.home.file);
  fileAt = target: cfg: lib.findFirst (f: f.target == target) null (lib.attrValues cfg.home.file);
  units = cfg: lib.attrNames cfg.systemd.user.services ++ lib.attrNames cfg.systemd.user.timers;
  bare = hm.evalBare {};
  # The actor in the registry, as pi-setup's bridge puts it there.
  withActor = {extensions.actor-subagents = import ../fixtures/actor-entry.nix;};
  warning = "pi-economics: experiments without actor-subagents in the registry (pi-setup's programs.pi.actorSubagents) does not recognise in-memory children (it reads the actor's agent list from __subagentsApi_v1; children with a session file still run their root's arm)";
in {
  # (M4.13) Off by default: no registry entry, no file.
  experiments-off = let
    c = eval ".pi/agent" null {};
  in
    holds "no registry entry" (!(pe c).extensions ? experiments)
    ++ eq "home.file targets" (targets c) (targets bare);

  # (M4.13) On, with the actor in the registry (no warning): the registry entry, main
  # session only, its link following agentDir; no timer (the host's
  # checks/pi-extensions.nix:264-269).
  experiments-defaults = lib.concatMap (dir: let
    c = eval dir {} withActor;
    e = (pe c).extensions.experiments;
  in
    eq "registry entry (${dir})" {inherit (e) path input forChildren;} {
      path = "${(pe c).experiments.package}";
      input = null;
      # (redesign M5b.2) Children load it too: in child mode it derives the
      # child's assignment from the root's row and serves it on the child's bus.
      forChildren = true;
    }
    ++ holds "checkPath is the source's index.ts (${dir})" (lib.hasSuffix "/packages/experiments/index.ts" (toString e.checkPath))
    ++ eq "derivations behind checkPath (${dir})"
    (lib.filter (v: v ? outputs) (lib.attrValues (builtins.getContext (toString e.checkPath)))) []
    ++ holds "link target (${dir})" (lib.elem "${dir}/pi-economics/extensions/experiments" (targets c))
    ++ eq "systemd user units (${dir})" (units c) (units bare)
    ++ eq "failed assertions (${dir})" (failed "" c) []
    ++ eq "warnings (${dir})" c.warnings bare.warnings)
  dirs;

  # (M4.13) The package is the flake's, under the name the host's
  # checks/pi-extensions.nix:150 matches in the link target.
  experiments-package = let
    x = (pe (eval ".pi/agent" {} {})).experiments;
  in
    eq "drvPath" x.package.drvPath self.packages.x86_64-linux.experiments.drvPath
    ++ eq "name" x.package.name "pi-experiments-${version}";

  # (M4.13; N4, spec D15) Files: the link and the settings file, the
  # extension's opt-in, with `mode` explicit while settings = {} (given settings are
  # written as given: experiments-settings).
  experiments-files = lib.concatMap (dir: let
    c = eval dir {} {};
    f = fileAt "${dir}/experiments/settings.json" c;
  in
    eq "home.file targets (${dir})" (sorted (targets c))
    (sorted (targets bare ++ ["${dir}/pi-economics/extensions/experiments" "${dir}/experiments/settings.json"]))
    ++ eq "settings file (${dir})" (
      if f == null
      then null
      else builtins.fromJSON f.text
    ) {mode = "explore";})
  dirs;

  # (M4.14) settings: written as given (the host's check value,
  # checks/pi-extensions.nix:262).
  experiments-settings = lib.concatMap (dir: let
    s = {minExplore = 0.15;};
    f = fileAt "${dir}/experiments/settings.json" (eval dir {settings = s;} {});
  in
    eq "settings file (${dir})" (
      if f == null
      then null
      else builtins.fromJSON f.text
    )
    s)
  dirs;

  # (M4.15) Alone, without the actor: one warning, no assertion.
  experiments-warning = let
    c = eval ".pi/agent" {} {};
  in
    eq "new warnings" (lib.subtractLists bare.warnings c.warnings) [warning]
    ++ eq "failed assertions" (failed "" c) [];

  # (redesign M5a T5a.6) A stratum's design has at most six factors (the
  # generator table of packages/experiments/core/design.ts).
  experiments-strata-seven = let
    factor = n: {
      name = "f${toString n}";
      lever = "session-entry(t,f${toString n})";
      target = "t";
      levels = ["a" "b"];
    };
    withFactors = k:
      eval ".pi/agent" {
        settings.strata = {
          cloud = {
            match.billing = ["api"];
            factors = map factor (lib.range 1 k);
          };
          local.factors = [];
        };
      }
      withActor;
  in
    eq "seven factors" (failed "pi-economics:" (withFactors 7)) ["pi-economics: experiments stratum cloud has more than 6 factors"]
    ++ eq "six factors" (failed "pi-economics:" (withFactors 6)) [];

  # (redesign M5a T5a.7) Two-level factors only (redesign §7.2).
  experiments-strata-three-levels = let
    withLevels = levels:
      eval ".pi/agent" {
        settings.strata.cloud.factors = [
          {
            name = "ttl";
            lever = "cache-lifecycle.mainCacheTtl";
            inherit levels;
          }
          {
            name = "one";
            lever = "session-entry(t,one)";
            target = "t";
            levels = lib.take 1 levels;
          }
          {
            name = "two";
            lever = "session-entry(t,two)";
            target = "t";
            levels = ["a" "b"];
          }
        ];
      }
      withActor;
  in
    eq "three levels and one level" (failed "pi-economics:" (withLevels ["5m" "1h" "2h"])) [
      "pi-economics: experiments factor one in stratum cloud needs exactly two levels"
      "pi-economics: experiments factor ttl in stratum cloud needs exactly two levels"
    ]
    ++ eq "only the one-level factor" (failed "pi-economics:" (withLevels ["5m" "1h"])) [
      "pi-economics: experiments factor one in stratum cloud needs exactly two levels"
    ];

  # (redesign M5a review) Two equal levels, no levels or a non-list are not two
  # levels; a factor whose name is no string still gets the message.
  experiments-strata-bad-levels = let
    c =
      eval ".pi/agent" {
        settings.strata = {
          cloud.factors = [
            {
              name = "same";
              lever = "session-entry(t,a)";
              target = "t";
              levels = ["a" "a"];
            }
            {
              name = "none";
              lever = "session-entry(t,b)";
              target = "t";
            }
            {
              name = "text";
              lever = "session-entry(t,c)";
              target = "t";
              levels = "ab";
            }
            {
              name = "ok";
              lever = "session-entry(t,d)";
              target = "t";
              levels = ["a" "b"];
            }
          ];
          named.factors = [
            {
              name = {x = 1;};
              lever = "session-entry(t,e)";
              target = "t";
              levels = ["a"];
            }
          ];
        };
      }
      withActor;
  in
    eq "equal, missing and non-list levels; a set as name" (failed "pi-economics:" c) [
      "pi-economics: experiments factor ? in stratum named needs exactly two levels"
      "pi-economics: experiments factor none in stratum cloud needs exactly two levels"
      "pi-economics: experiments factor same in stratum cloud needs exactly two levels"
      "pi-economics: experiments factor text in stratum cloud needs exactly two levels"
    ];

  # (redesign M7b) The levels of a lever that sets pi itself are what pi
  # accepts (redesign §7.4): pi.thinkingLevel takes pi's six names,
  # pi.activeTool(<name>) booleans.
  experiments-pi-levels = let
    thinking = ["off" "minimal" "low" "medium" "high" "xhigh"];
    withFactors = fs: eval ".pi/agent" {settings.strata.cloud.factors = fs;} withActor;
    one = lever: levels:
      withFactors [
        {
          name = "f";
          inherit lever levels;
        }
      ];
    msg = lever: "pi-economics: experiments factor f in stratum cloud has a level that ${lever} does not accept";
    # (redesign M7c) a level name is also what a levers line can record
    nameMsg = "pi-economics: experiments factor f in stratum cloud has a level that is not a level name, a number or a boolean";
  in
    lib.concatMap (l:
      eq "thinking level ${l}" (failed "pi-economics:" (one "pi.thinkingLevel" [
        l
        (
          if l == "off"
          then "xhigh"
          else "off"
        )
      ])) [])
    thinking
    ++ eq "an unknown thinking level" (failed "pi-economics:" (one "pi.thinkingLevel" ["low" "extreme"])) [(msg "pi.thinkingLevel")]
    ++ eq "wrong case and a bool" (failed "pi-economics:" (one "pi.thinkingLevel" ["Low" true])) [nameMsg (msg "pi.thinkingLevel")]
    ++ eq "a number" (failed "pi-economics:" (one "pi.thinkingLevel" ["low" 3])) [(msg "pi.thinkingLevel")]
    ++ eq "tool, booleans" (failed "pi-economics:" (one "pi.activeTool(codemode)" [false true])) []
    ++ eq "tool, booleans, other order" (failed "pi-economics:" (one "pi.activeTool(codemode)" [true false])) []
    ++ eq "tool, strings" (failed "pi-economics:" (one "pi.activeTool(codemode)" ["off" "on"])) [(msg "pi.activeTool(codemode)")]
    ++ eq "tool, one boolean" (failed "pi-economics:" (one "pi.activeTool(codemode)" [false "on"])) [(msg "pi.activeTool(codemode)")]
    ++ eq "another lever keeps any levels" (failed "pi-economics:" (one "cache-lifecycle.mainCacheTtl" ["5m" "extreme"])) []
    ++ eq "levels that are no list are the two-levels assertion's" (failed "pi-economics:" (one "pi.thinkingLevel" "low")) ["pi-economics: experiments factor f in stratum cloud needs exactly two levels"]
    ++ eq "the catalogue the module reads lists pi's six" (lib.importJSON ../../../packages/experiments/addons/catalogue.json).thinkingLevels thinking;

  # (redesign M7c) A factor's lever is one the engine can set: an id of the
  # package's add-on catalogue or a data-only kind (pi.activeTool(<name>),
  # session-entry(<customType>,<field>)); another id would randomize nothing.
  experiments-unknown-lever = let
    catalogue = lib.importJSON ../../../packages/experiments/addons/catalogue.json;
    prefix = "pi-economics: experiments factor f in stratum cloud has an unknown lever";
    one = lever:
      eval ".pi/agent" {
        settings.strata.cloud.factors = [
          {
            name = "f";
            inherit lever;
            levels = ["a" "b"];
          }
        ];
      }
      withActor;
    unknown = lever: failed prefix (one lever);
    kinds = ["pi.activeTool(codemode)" "pi.activeTool(mcp__srv.tool-1)" "session-entry(entry-ext:settings,nudge)" "session-entry(a,b)"];
    bad = ["t.lever" "" "pi.thinkingLevl" "pi.thinkingLevel " "Pi.thinkingLevel" "cache-lifecycle.nope" "pi.activeTool()" "pi.activeTool(a b)" "pi.activeTool(a,b)" "pi.activeTool(a(b))" "pi.activeTool(a)x" "session-entry(a)" "session-entry()" "session-entry(a,)" "session-entry(,b)" "session-entry(a,b,c)" "session-entry(a, b)" "session-entry(a,b)x" "session-entry(a,(b))" "infinite-context.nudgeAtTokens.x"];
  in
    lib.concatMap (id: eq "catalogue lever ${id}" (unknown id) []) catalogue.levers
    ++ lib.concatMap (id: eq "kind ${id}" (unknown id) []) kinds
    ++ lib.concatMap (id: eq "unknown ${builtins.toJSON id}" (unknown id) ["${prefix} ${id}"]) bad
    ++ eq "a lever that is no string" (failed prefix (one 3)) ["${prefix} 3"]
    ++ eq "no lever at all" (failed prefix (eval ".pi/agent" {
        settings.strata.cloud.factors = [
          {
            name = "f";
            levels = ["a" "b"];
          }
        ];
      }
      withActor)) ["${prefix} null"];

  # (redesign M7c, carried from the M5b.2 review) A level reaches a levers
  # line as a value: a level name (lowercase letters, digits, "_" and "-", at
  # most 32 characters, as token-meter's core/levers.ts and the package's
  # core/settings.ts say in the same literal line), a number or a boolean.
  experiments-level-names = let
    msg = "pi-economics: experiments factor f in stratum cloud has a level that is not a level name, a number or a boolean";
    withLevels = levels:
      eval ".pi/agent" {
        settings.strata.cloud.factors = [
          {
            name = "f";
            lever = "session-entry(t,f)";
            target = "t";
            inherit levels;
          }
        ];
      }
      withActor;
    bad = levels: failed "pi-economics: experiments factor f in stratum cloud has a level that is not" (withLevels levels);
    line = "const LEVEL = /^[a-z0-9][a-z0-9_-]{0,31}$/;";
    lines = f: lib.splitString "\n" (builtins.readFile f);
    long = n: lib.concatStrings (lib.genList (_: "x") n);
  in
    lib.concatMap (l: eq "ok ${builtins.toJSON l}" (bad l) []) [["5m" "1h"] ["a_b-c" "x"] [(long 32) "y"] ["0" "9"] [0.25 0.75] [false true] ["1" 2] [(-1) 1000000]]
    ++ lib.concatMap (l: eq "not a level name: ${builtins.toJSON l}" (bad ["ok" l]) [msg]) ["1H" "" " a" "a b" "a\n" "-a" "_a" (long 33) "é" "a.b" "Medium"]
    ++ eq "a list as a level" (bad ["ok" ["a"]]) [msg]
    ++ eq "an attribute set as a level" (bad ["ok" {a = 1;}]) [msg]
    ++ eq "null as a level" (bad ["ok" null]) [msg]
    ++ holds "token-meter and experiments say the rule in the same line" (lib.elem line (lines ../../../packages/token-meter/core/levers.ts) && lib.elem line (lines ../../../packages/experiments/core/settings.ts));

  # (redesign M7b review F1b) A session-entry factor names its target: the
  # extension whose tool or command shows it is loaded. Without one the
  # read-back can never confirm (the seed is no evidence), so the factor is
  # refused; other levers have no use for it.
  experiments-session-entry-target = let
    msg = "pi-economics: experiments factor f in stratum cloud has a session-entry lever without a target";
    one = factor:
      eval ".pi/agent" {
        settings.strata.cloud.factors = [
          ({
              name = "f";
              levels = ["a" "b"];
            }
            // factor)
        ];
      }
      withActor;
    bad = factor: failed msg (one ({lever = "session-entry(t,f)";} // factor));
  in
    eq "a target" (bad {target = "entry-ext";}) []
    ++ eq "no target" (bad {}) [msg]
    ++ eq "an empty target" (bad {target = "";}) [msg]
    ++ eq "a target that is no string" (bad {target = 3;}) [msg]
    ++ eq "a list as target" (bad {target = ["a"];}) [msg]
    ++ eq "other levers need none" (failed msg (one {lever = "cache-lifecycle.mainCacheTtl";})) []
    ++ eq "a pi control needs none" (failed msg (one {
      lever = "pi.activeTool(codemode)";
      levels = [false true];
    })) []
    ++ eq "no other assertion fails for a target" (failed "pi-economics:" (one {
      lever = "session-entry(t,f)";
      target = "entry-ext";
    })) [];

  # (M4.16) The host's combination from W3 on (spec §9.1): M2–M4's extension
  # components, piSettings off (the host's own script runs until W6). Children
  # load cache-lifecycle and token-meter, not experiments: the list pi-setup's
  # bridge writes into the actor's settings file (host pi-extensions.nix:389-390);
  # the file is pi-setup's (router-extraction design §7.2).
  cache-experiments-host-like = let
    c = hm.eval {
      programs.piEconomics = {
        inherit (withActor) extensions;
        tokenMeter.enable = true;
        cacheLifecycle.enable = true;
        experiments.enable = true;
        piSettings.enable = false;
      };
    };
    kids = map (n: "/home/u/.pi/agent/pi-economics/extensions/${n}") ["experiments" "token-meter" "cache-lifecycle"];
  in
    eq "childExtensions" (pe c).childExtensions kids
    ++ eq "no actor-subagents/settings.json here" (fileAt ".pi/agent/actor-subagents/settings.json" c) null
    ++ eq "links" (sorted (lib.filter (lib.hasPrefix ".pi/agent/pi-economics/extensions/") (targets c)))
    (map (n: ".pi/agent/pi-economics/extensions/${n}") ["actor-subagents" "cache-lifecycle" "experiments" "token-meter"])
    ++ holds "no piSettingsMigrate entry" (!(c.home.activation ? piSettingsMigrate))
    ++ eq "failed assertions" (failed "" c) []
    # (M6) The registry is no longer auto-discovered: one warning.
    ++ eq "new warnings" (lib.subtractLists bare.warnings c.warnings) ["pi-economics: piSettings.enable is false, so nothing lists the registry in settings.json's `extensions`, and pi does not auto-discover its links in .pi/agent/pi-economics/extensions: put programs.piEconomics.loadOrder at the front of `extensions` yourself"];

  # (redesign M5b.1, review m3) The v1 engine's keys: one warning naming
  # those set; none without them.
  experiments-legacy-keys = let
    new = s: lib.subtractLists bare.warnings (eval ".pi/agent" {settings = s;} withActor).warnings;
    tail = "(the v1 engine's): its factors come from settings.strata (default: one stratum per billing class); baseline only labels the analyses of v1–v4 designs";
  in
    eq "factors, maxArms, baseline" (new {
      factors = [];
      maxArms = 8;
      baseline = "---";
      mode = "explore";
    }) ["pi-economics: experiments ignores settings.factors, settings.maxArms, settings.baseline ${tail}"]
    ++ eq "maxArms alone" (new {maxArms = 4;}) ["pi-economics: experiments ignores settings.maxArms ${tail}"]
    ++ eq "none" (new {
      mode = "exploit";
      strata = {};
    }) []
    ++ eq "default" (new {}) [];
}
