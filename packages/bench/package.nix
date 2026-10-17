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
    src = lib.cleanSource ./.;
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
      runHook postInstall
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
