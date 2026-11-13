# The pi-bench harness, tested at build time: `pi-bench` (run, judge, report, …) and `bench-report`.
# Data stays outside the repo (~/.pi/agent/bench, see README.md); the node test runner is the toolchain.
{
  lib,
  stdenvNoCC,
  nodejs,
  git,
  gnutar,
  bash,
  coreutils,
  writeShellApplication,
  symlinkJoin,
}: let
  manifest = lib.importJSON ./package.json;
  runtimeInputs = [nodejs git gnutar bash coreutils];
  # Sources with their tests run in checkPhase; the wrappers depend on this output.
  code = stdenvNoCC.mkDerivation {
    pname = "pi-bench-src";
    inherit (manifest) version;
    # The bench with the experiments' design module (redesign §7.2), at the
    # repository's relative path: src/orch.ts imports
    # ../../experiments/core/design.ts (its package.json keeps it ESM).
    src = lib.fileset.toSource {
      root = ../.;
      fileset = lib.fileset.unions [./. ../experiments/core/design.ts ../experiments/package.json];
    };
    sourceRoot = "source/bench";
    nativeBuildInputs = runtimeInputs;
    dontBuild = true;
    doCheck = true;
    checkPhase = ''
      runHook preCheck
      export HOME=$TMPDIR/home
      mkdir -p "$HOME"
      node --test --experimental-strip-types test/*.test.ts
      runHook postCheck
    '';
    installPhase = ''
      runHook preInstall
      mkdir -p $out/share/pi-bench
      cp -r package.json src probe bin $out/share/pi-bench/
      mkdir -p $out/share/experiments/core
      cp ../experiments/package.json $out/share/experiments/
      cp ../experiments/core/design.ts $out/share/experiments/core/
      runHook postInstall
    '';
    # The installed tree resolves its imports (src/orch.ts imports the
    # experiments' design module from ../../experiments/core).
    doInstallCheck = true;
    installCheckPhase = ''
      runHook preInstallCheck
      node --experimental-strip-types --no-warnings --input-type=module \
        -e "const m = await import('$out/share/pi-bench/src/orch.ts'); if (Object.keys(m.orchArms()).length !== 4) process.exit(1);"
      runHook postInstallCheck
    '';
  };
  entry = "${code}/share/pi-bench/src/cli.ts";
  pi-bench = writeShellApplication {
    name = "pi-bench";
    inherit runtimeInputs;
    text = ''exec node --experimental-strip-types --no-warnings ${entry} "$@"'';
  };
  bench-report = writeShellApplication {
    name = "bench-report";
    inherit runtimeInputs;
    text = ''exec node --experimental-strip-types --no-warnings ${entry} report "$@"'';
  };
in
  symlinkJoin {
    name = "pi-bench-${manifest.version}";
    paths = [pi-bench bench-report];
    passthru = {inherit code;};
  }
