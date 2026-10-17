# The token-meter pi package (spec §2), tested at build time: node --test over
# test/*.test.ts in checkPhase. passthru.report and passthru.analyse are the
# two commands the tokenMeter component puts on PATH.
{
  lib,
  stdenvNoCC,
  nodejs,
  writeShellApplication,
}: let
  manifest = lib.importJSON ./package.json;
in
  stdenvNoCC.mkDerivation (finalAttrs: {
    pname = manifest.name;
    inherit (manifest) version;
    src = lib.cleanSource ./.;
    nativeBuildInputs = [nodejs];
    dontBuild = true;
    doCheck = true;
    # pi loads the sources uncompiled with type stripping; node's test runner
    # is the whole toolchain.
    checkPhase = ''
      runHook preCheck
      export HOME=$TMPDIR/home
      mkdir -p "$HOME"
      node --test --experimental-strip-types test/*.test.ts
      runHook postCheck
    '';
    installPhase = ''
      runHook preInstall
      mkdir -p $out
      cp -r package.json index.ts core LOGS.md $out/
      if [ -d bin ]; then cp -r bin $out/; fi
      runHook postInstall
    '';

    # `meter-report [--dir D] [--from YYYY-MM-DD] [--to YYYY-MM-DD]`: markdown
    # totals per day, session and model from <agentDir>/meter/*.jsonl.
    passthru.report = writeShellApplication {
      name = "meter-report";
      runtimeInputs = [nodejs];
      text = ''exec node --experimental-strip-types --no-warnings ${finalAttrs.finalPackage}/bin/meter-report.ts "$@"'';
    };

    # `pi-analyse [--since D] [--until D] [--agent-dir P] [--out DIR] [--check]
    # [--apply]`: the on-demand analysis of every pi log (cost, experiment,
    # delegation, guards, data quality) into <out>/<date>-<HHMM>-analysis.{md,json};
    # LOGS.md documents the files it reads.
    passthru.analyse = writeShellApplication {
      name = "pi-analyse";
      runtimeInputs = [nodejs];
      text = ''exec node --experimental-strip-types --no-warnings ${finalAttrs.finalPackage}/bin/pi-analyse.ts "$@"'';
    };
  })
