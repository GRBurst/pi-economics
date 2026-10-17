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
  hm = import ./lib/hm-eval.nix {
    inherit lib pkgs home-manager;
    homeModule = self.homeModules.default;
  };
  typecheck = import ./typecheck {
    inherit lib pkgs;
    inherit (npm) nodeModules;
  };
in {
  leak = leakLib.check leakSrc;
  leak-selftest = leakLib.selftest;
  npm-deps = npm.check;
  typecheck-harness = typecheck.selftest;
  module-eval = import ./module-eval {inherit lib pkgs hm self;};
  pi-settings-migrate = import ./pi-settings-migrate {inherit lib pkgs hm;};
  # The bench's own tests run when its code builds (spec §8.1, "Package tests").
  bench = self.packages.${pkgs.stdenv.hostPlatform.system}.bench.code;
}
