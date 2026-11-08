# The pi package manifest (spec D1, §4.1). The root `package.json`, what a pi
# user without Nix installs, is the output of this flake's module evaluated
# for one fixture, F_P, through the checks' Home Manager evaluation (user
# `u`); only `nix run .#render` writes it into the checkout, and the check
# `render-package` compares the committed file with `tree`.
#
# The manifest maps registry names, never store paths (no
# import-from-derivation): an own component `<n>` is `./packages/<n>/index.ts`,
# the prerequisites (the patched upstreams, which the user installs) are
# skipped, and any other entry is an evaluation error, so no extension is
# Nix-only by accident.
{
  lib,
  pkgs,
  home-manager,
  homeModule,
}: let
  hm = import ../checks/lib/hm-eval.nix {inherit lib pkgs home-manager homeModule;};

  # Spec §7 Q6: one constant; the tag is `v` + version.
  version = "0.1.1";

  # F_P: every component on but bench (Nix-only, spec D10), the
  # prerequisites included, so the registry is the whole set the flake knows.
  fp = hm.eval {
    programs.piEconomics = {
      tokenMeter.enable = true;
      analysisSkill.enable = true;
      cacheLifecycle.enable = true;
      experiments.enable = true;
      taskRouter.enable = true;
      actorSubagents.enable = true;
      infiniteContext.enable = true;
      retry.enable = true;
    };
  };
  pe = fp.programs.piEconomics;

  # `rawModule` skips Home Manager's assertion check: the render does it.
  failed = map (a: a.message) (lib.filter (a: !a.assertion) fp.assertions);

  # Spec D2: installed by the user, never shipped.
  prereq = ["actor-subagents" "infinite-context" "pi-retry"];
  names = lib.attrNames pe.extensions;
  own = lib.filter (n: !lib.elem n prereq) names;
  entry = n:
    if builtins.pathExists (../packages + "/${n}/index.ts")
    then "./packages/${n}/index.ts"
    else throw "render: no package path for ${n}";

  # What pi itself provides (pi's packages documentation): peers, never bundled.
  host = [
    "@earendil-works/pi-agent-core"
    "@earendil-works/pi-ai"
    "@earendil-works/pi-coding-agent"
    "@earendil-works/pi-tui"
    "typebox"
  ];

  manifest = {
    name = "pi-economics";
    inherit version;
    private = true;
    type = "module";
    license = "MIT";
    keywords = ["pi-package"];
    description = "pi token economics: a token meter, online experiments, prompt-cache lifecycle and a task-card router, plus an analysis skill.";
    peerDependencies = lib.genAttrs host (_: "*");
    # The token meter's two CLIs (spec D8): `npm install -g <the pi clone>` links them.
    bin = lib.optionalAttrs pe.tokenMeter.enable {
      meter-report = "./packages/token-meter/bin/meter-report.ts";
      pi-analyse = "./packages/token-meter/bin/pi-analyse.ts";
    };
    pi =
      {extensions = map entry own;}
      // lib.optionalAttrs pe.analysisSkill.enable {skills = ["./skills"];};
  };

  tree = assert lib.assertMsg (failed == []) "render: F_P fails its assertions: ${lib.concatStringsSep "; " failed}";
    pkgs.runCommand "pi-economics-rendered" {nativeBuildInputs = [pkgs.jq pkgs.gnugrep];} ''
      mkdir $out
      jq -S . ${pkgs.writeText "package.json" (builtins.toJSON manifest)} >$out/package.json
      # Hygiene: no store path in a rendered file.
      if grep -qF /nix/store $out/package.json; then
        echo "render: a store path in package.json" >&2
        exit 1
      fi
    '';

  # `nix run .#render`, from the repository root: the only writer of package.json.
  app = pkgs.writeShellApplication {
    name = "pi-economics-render";
    runtimeInputs = [pkgs.coreutils];
    text = ''
      if ! { [ -f render/default.nix ] && [ -f packages/token-meter/index.ts ]; }; then
        echo "run from the pi-economics repository root" >&2
        exit 2
      fi
      cp --no-preserve=mode ${tree}/package.json package.json
    '';
  };
in {inherit fp own manifest tree app version;}
