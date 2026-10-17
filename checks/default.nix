# Every check of the flake. Build them one at a time, capped (AGENTS.md,
# "Commands"); never `nix flake check` without a memory cap.
{
  self,
  pkgs,
  lib,
  home-manager,
}: let
  leakLib = import ./leak {inherit lib pkgs;};
  # Until P (spec §8.3): the spec and the plans name the owner's hosts and home.
  leakSrc = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.difference ../. (lib.fileset.unions [../docs/specs ../docs/plans]);
  };
  npm = import ./npm {inherit lib pkgs;};
in {
  leak = leakLib.check leakSrc;
  leak-selftest = leakLib.selftest;
  npm-deps = npm.check;
}
