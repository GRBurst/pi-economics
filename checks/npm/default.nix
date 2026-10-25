# The shared npm lock (spec §3, "npm dependencies"). ./package.json and
# ./package-lock.json are the host's checks/pi-retry files at 4c714f0, byte for
# byte: pi-retry's devDependencies, which pin typescript, @types/node and pi's
# own packages for the type check and, from M6, vitest for pi-retry's suite.
# pname and source set are the host's, so the derivation is the host's.
{
  lib,
  pkgs,
}: rec {
  nodeModules = pkgs.buildNpmPackage {
    pname = "pi-retry-test-deps";
    version = "0";
    src = lib.fileset.toSource {
      root = ./.;
      fileset = lib.fileset.unions [./package.json ./package-lock.json];
    };
    npmDepsHash = "sha256-S8lO6fS9S3hRNlUdv7hztyfECeHBzeNArqaDjDQYqBE=";
    npmDepsFetcherVersion = 2;
    dontNpmBuild = true;
    installPhase = ''
      runHook preInstall
      mkdir -p $out
      cp -r node_modules $out/node_modules
      runHook postInstall
    '';
  };

  # The type check's toolchain is what the lock declares.
  check = let
    declared = (lib.importJSON ./package.json).devDependencies;
    pinned = ["typescript" "@types/node" "@earendil-works/pi-coding-agent"];
  in
    pkgs.runCommand "npm-deps" {nativeBuildInputs = [pkgs.jq];} ''
      set -euo pipefail
      ${lib.concatMapStrings (name: ''
          got=$(jq -r .version ${nodeModules}/node_modules/${name}/package.json)
          if [ "$got" != ${lib.escapeShellArg declared.${name}} ]; then
            echo "FAIL ${name}: installed $got, package.json declares ${declared.${name}}" >&2
            exit 1
          fi
          echo "ok ${name} $got"
        '')
        pinned}
      touch $out
    '';
}
