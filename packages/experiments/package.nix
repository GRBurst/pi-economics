# The experiments pi package (spec §2), tested at build time: node --test over
# test/*.test.ts in checkPhase.
{
  lib,
  stdenvNoCC,
  nodejs,
}: let
  manifest = lib.importJSON ./package.json;
in
  stdenvNoCC.mkDerivation {
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
      cp -r package.json index.ts core $out/
      if [ -d bin ]; then cp -r bin $out/; fi
      runHook postInstall
    '';
  }
