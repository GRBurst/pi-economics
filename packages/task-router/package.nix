# The task-router pi package (spec §2, §6), tested at build time: node --test
# over test/*.test.ts in checkPhase. pi loads index.ts and core/ uncompiled.
{
  lib,
  stdenvNoCC,
  nodejs,
  git,
}: let
  manifest = lib.importJSON ./package.json;
in
  stdenvNoCC.mkDerivation {
    pname = manifest.name;
    inherit (manifest) version;
    src = lib.cleanSource ./.;
    nativeBuildInputs = [nodejs];
    # The worktree and merge tests run real git in temporary repositories (test/git-repo.ts).
    nativeCheckInputs = [git];
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
      runHook postInstall
    '';
  }
