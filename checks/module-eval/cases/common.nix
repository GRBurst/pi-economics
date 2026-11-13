# Cases for modules/common.nix: agentDir, the extension registry, piSettings.
{
  lib,
  hm,
  self,
  expect,
}: let
  inherit (expect) eq holds throws evaluates failed;
  # Bindings are lazy: a binding whose file or option arrives later (fx in
  # M0.8, today in M0.13) may be written in M0.6 already.
  pe = cfg: cfg.programs.piEconomics;
  fx = ../fixtures;
  extA = {
    path = fx + "/ext-a";
    forChildren = true;
    description = "fixture a";
  };
  extB = {
    path = fx + "/ext-b";
    forChildren = false;
    description = "fixture b";
  };
  today = import ../../pi-settings-migrate/today-ops.nix;
  setX = value: order: {
    op = "set";
    path = ["x"];
    inherit value order;
  };
  activation = cfg: cfg.home.activation.piSettingsMigrate or null;
  dataOf = cfg: let
    e = activation cfg;
  in
    if e == null
    then null
    else e.data;
  runLine = cfg: file: "run ${lib.getExe (pe cfg).piSettings.package} ${lib.escapeShellArg file}\n";
in {
  # (M0.6) The packages are the components' builds; the task router's is the
  # pi-task-router flake's, the patched actor-subagents pi-setup's
  # (router-extraction design §7.3).
  exports =
    eq "homeModules" (lib.attrNames self.homeModules) ["default"]
    ++ eq "packages" (lib.attrNames self.packages.x86_64-linux) ["bench" "cache-lifecycle" "experiments" "infinite-context" "token-meter"];

  # (M0.6) With every default the module renders nothing.
  inert = let
    c = hm.eval {};
    b = hm.evalBare {};
  in
    eq "home.file names" (lib.attrNames c.home.file) (lib.attrNames b.home.file)
    ++ eq "activation names" (lib.attrNames c.home.activation) (lib.attrNames b.home.activation)
    ++ eq "failed assertions" (failed "" c) []
    ++ eq "warnings" c.warnings b.warnings;

  # (M0.7)
  agentDir-default = eq "agentDir" (pe (hm.eval {})).agentDir ".pi/agent";
  agentDir-type = let
    t = (hm.options {}).programs.piEconomics.agentDir.type;
  in
    lib.concatMap (v: holds "agentDir rejects ${builtins.toJSON v}" (!t.check v)) ["/abs" "x/" ""]
    ++ lib.concatMap (v: holds "agentDir accepts ${v}" (t.check v)) [".pi/agent" "a" "custom/agent"];

  # (M0.8) Links follow agentDir and point at path, whatever their home.file
  # key (the key itself: registry-double-link-key).
  registry-links = lib.concatMap (dir: let
    c = hm.eval {
      programs.piEconomics = {
        agentDir = dir;
        extensions = {
          ext-a = extA;
          ext-b = extB;
        };
      };
    };
    under = lib.filterAttrs (_: f: lib.hasPrefix "${dir}/pi-economics/extensions/" f.target) c.home.file;
  in
    eq "links under ${dir}"
    (lib.mapAttrs' (_: f: lib.nameValuePair f.target (toString f.source)) under)
    (lib.mapAttrs' (n: e: lib.nameValuePair "${dir}/pi-economics/extensions/${n}" (toString e.path)) (pe c).extensions)
    # (M6) pi auto-discovers <agentDir>/extensions and loads it in directory
    # order; the registry is listed in settings.json instead (load-order).
    ++ holds "no link in the auto-discovered ${dir}/extensions"
    (!lib.any (f: lib.hasPrefix "${dir}/extensions/" f.target) (lib.attrValues c.home.file))
    ++ eq "failed assertions (${dir})" (failed "" c) [])
  [".pi/agent" "custom/agent"];

  # (M0.9)
  registry-missing = let
    missingFile = fx + "/no-such-ext/index.ts";
    missingDir = fx + "/no-such-ext";
    c = hm.eval {
      programs.piEconomics.extensions = {
        ext-a = extA;
        gone =
          extA
          // {
            checkPath = missingFile;
            input = "upstream-x";
          };
        gone-local = {
          path = missingDir;
          forChildren = false;
          description = "d";
        };
      };
    };
  in
    eq "failed assertions" (failed "pi-economics:" c) (lib.sort lib.lessThan [
      "pi-economics: extension 'gone' not found at ${toString missingFile}; the upstream-x input may have renamed or removed it."
      "pi-economics: extension 'gone-local' not found at ${toString missingDir}."
    ]);

  # (M0.10) Home Manager rejects a second link (spec §5.1).
  registry-double-link-key = let
    key = ".pi/agent/pi-economics/extensions/ext-a";
    c = hm.eval {
      programs.piEconomics.extensions.ext-a = extA;
      home.file.${key}.source = extB.path;
    };
    alone = hm.eval {programs.piEconomics.extensions.ext-a = extA;};
  in
    holds "the registry links under the key ${key}" (alone.home.file ? ${key})
    ++ throws "a second home.file definition of the link" c.home.file.${key}.source;
  registry-double-link-target = let
    c = hm.eval {
      programs.piEconomics.extensions.ext-a = extA;
      home.file.other-ext-a = {
        target = ".pi/agent/pi-economics/extensions/ext-a";
        source = extB.path;
      };
    };
  in
    holds "Home Manager's conflicting-target assertion fires"
    (lib.any (lib.hasPrefix "Conflicting managed target files: .pi/agent/pi-economics/extensions/ext-a") (failed "" c));

  # (M2.5) The registry's children: link paths of the forChildren entries,
  # in load order (M6: the components first, then by name), whatever else
  # the registry holds; pi-setup's economics bridge hands the list to the
  # actor's settings file (router-extraction design §7.2). Children out of
  # name order, and two entries withheld.
  child-extensions = lib.concatMap (dir: let
    c = hm.eval {
      programs.piEconomics = {
        agentDir = dir;
        extensions = {
          zeta = extA;
          alpha = extA // {description = "fixture alpha";};
          mid = extB;
          infinite-context = extA;
          experiments = extB;
          cache-lifecycle = extA;
          token-meter = extA;
        };
      };
    };
    kids = (pe c).childExtensions;
    targets = map (f: f.target) (lib.attrValues c.home.file);
    names = ["token-meter" "cache-lifecycle" "infinite-context" "alpha" "zeta"];
  in
    eq "childExtensions (${dir})" kids (map (n: "/home/u/${dir}/pi-economics/extensions/${n}") names)
    ++ holds "every child is a link the registry renders (${dir})"
    (lib.all (p: lib.elem p (map (t: "${c.home.homeDirectory}/${t}") targets)) kids)
    ++ eq "names from the last path component (${dir})" (map (p: lib.last (lib.splitString "/" p)) kids) names)
  [".pi/agent" "custom/agent"];

  # (M6) settings.json's `extensions` lists the registry first, in load order:
  # experiments, token-meter, cache-lifecycle, infinite-context, then the
  # others by name (redesign §7.6), relative to the agent directory as pi
  # resolves them. The op runs after the default-order ones; without a
  # registry entry there is none.
  load-order = let
    rel = n: "pi-economics/extensions/${n}";
    reg = names: lib.genAttrs names (_: extA);
    c = hm.eval {programs.piEconomics.extensions = reg ["zeta" "infinite-context" "alpha" "token-meter" "cache-lifecycle" "experiments"];};
    some = hm.eval {programs.piEconomics.extensions = reg ["zeta" "token-meter" "alpha"];};
    none = hm.eval {};
  in
    eq "loadOrder" (pe c).loadOrder (map rel ["experiments" "token-meter" "cache-lifecycle" "infinite-context" "alpha" "zeta"])
    ++ eq "loadOrder, one of the four" (pe some).loadOrder (map rel ["token-meter" "alpha" "zeta"])
    ++ eq "ops.loadOrder" (pe c).piSettings.ops.loadOrder [
      {
        op = "ensurePrefix";
        path = ["extensions"];
        value = (pe c).loadOrder;
        order = 2000;
      }
    ]
    ++ holds "an activation entry runs it" (activation c != null)
    ++ eq "warnings" c.warnings (hm.evalBare {}).warnings
    ++ eq "no registry entry: loadOrder" (pe none).loadOrder []
    ++ holds "no registry entry: no op" (!((pe none).piSettings.ops ? loadOrder));

  # (M6) Without piSettings nothing lists the registry, and pi does not
  # discover its links: one warning, naming the agent directory; none
  # without a registry entry.
  load-order-pisettings-disabled = lib.concatMap (dir: let
    c = hm.eval {
      programs.piEconomics = {
        agentDir = dir;
        extensions.ext-a = extA;
        piSettings.enable = false;
      };
    };
    empty = hm.eval {programs.piEconomics.piSettings.enable = false;};
    bare = hm.evalBare {};
  in
    eq "new warnings (${dir})" (lib.subtractLists bare.warnings c.warnings) [
      "pi-economics: piSettings.enable is false, so nothing lists the registry in settings.json's `extensions`, and pi does not auto-discover its links in ${dir}/pi-economics/extensions: put programs.piEconomics.loadOrder at the front of `extensions` yourself"
    ]
    ++ eq "no registry entry: warnings (${dir})" empty.warnings bare.warnings)
  [".pi/agent" "custom/agent"];

  # (M0.11; the ops and order lines: M0.12)
  pisettings-defaults = let
    s = (pe (hm.eval {})).piSettings;
    moved = (pe (hm.eval {programs.piEconomics.agentDir = "custom/agent";})).piSettings;
    one =
      (pe (hm.eval {
        programs.piEconomics.piSettings.ops.t = [
          {
            op = "set";
            path = ["y"];
            value = 1;
          }
        ];
      })).piSettings;
  in
    eq "enable" s.enable true
    ++ eq "file" s.file ".pi/agent/settings.json"
    ++ eq "file follows agentDir" moved.file "custom/agent/settings.json"
    ++ eq "after" s.after []
    ++ eq "ops" s.ops {}
    ++ eq "default order" (lib.head one.sortedOps).order 1000;

  # (M0.12) (order, key, index); same order -> by contributor key (§8.1).
  pisettings-order = let
    s =
      (pe (hm.eval {
        programs.piEconomics.piSettings.ops = {
          zeta = [(setX "z0" 1000) (setX "z1" 1000)];
          alpha = [(setX "a0" 1000) (setX "a1" 2000)];
          mid = [(setX "m0" 500)];
        };
      })).piSettings;
  in
    eq "execution order" (map (o: "${o.key}#${toString o.index}") s.sortedOps)
    ["mid#0" "alpha#0" "zeta#0" "zeta#1" "alpha#1"];

  # (M0.12) No whole-object set.
  pisettings-path-empty = let
    pathOf = path:
      (lib.head
        (pe (hm.eval {
          programs.piEconomics.piSettings.ops.t = [
            {
              op = "set";
              inherit path;
              value = 1;
            }
          ];
        })).piSettings.ops.t).path;
  in
    throws "path = []" (pathOf [])
    ++ evaluates "path = [\"y\"]" (pathOf ["y"]);

  # (M0.13) One function per op, in execution order, then the pipe.
  pisettings-program = let
    s = (pe (hm.eval {programs.piEconomics.piSettings.ops = today.withWarming;})).piSettings;
    lines = lib.filter (l: l != "") (lib.splitString "\n" s.program);
    n = lib.length s.sortedOps;
  in
    eq "program without ops" (pe (hm.eval {})).piSettings.program ".\n"
    ++ eq "line count" (lib.length lines) (n + 1)
    ++ eq "pipe" (lib.last lines) (lib.concatMapStringsSep " | " (i: "op${toString i}") (lib.range 1 n))
    ++ lib.concatLists (lib.imap1 (i: op: let
      line = lib.elemAt lines (i - 1);
    in
      holds "line ${toString i} defines op${toString i} with its path and value" (
        lib.hasPrefix "def op${toString i}: " line
        && lib.hasInfix (lib.concatMapStrings (k: "[${builtins.toJSON k}]") op.path) line
        && lib.hasInfix (builtins.toJSON op.value) line
      ))
    s.sortedOps);

  # (M0.17)
  pisettings-activation = let
    c = hm.eval {
      programs.piEconomics.piSettings = {
        ops = today.withWarming;
        after = ["seed" "reclaim"];
      };
    };
    e = activation c;
  in
    holds "entry piSettingsMigrate exists" (e != null)
    ++ lib.optionals (e != null) (
      eq "data" e.data (runLine c "${c.home.homeDirectory}/${(pe c).piSettings.file}")
      ++ eq "after" e.after ["writeBoundary" "seed" "reclaim"]
      ++ eq "before" e.before []
    );
  pisettings-disabled = let
    c = hm.eval {
      programs.piEconomics.piSettings = {
        enable = false;
        ops = today.withWarming;
      };
    };
  in
    holds "no entry while enable = false, with ops from ${toString (lib.attrNames today.withWarming)}" (activation c == null);
  pisettings-no-ops =
    holds "no entry without ops" (activation (hm.eval {}) == null)
    ++ holds "no entry with only empty lists" (activation (hm.eval {programs.piEconomics.piSettings.ops.x = [];}) == null);
  pisettings-file =
    lib.concatMap ({
      file,
      abs,
    }: let
      c = hm.eval {
        programs.piEconomics.piSettings = {
          inherit file;
          ops = today.withoutWarming;
        };
      };
    in
      eq "data for file = ${file}" (dataOf c) (runLine c (abs c)))
    [
      {
        file = ".local/state/pi/settings.json";
        abs = c: "${c.home.homeDirectory}/.local/state/pi/settings.json";
      }
      {
        file = "/var/lib/pi/settings.json";
        abs = _: "/var/lib/pi/settings.json";
      }
    ];
}
