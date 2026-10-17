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
  # (M2.1)
  actorSubagents = self.packages.${pkgs.stdenv.hostPlatform.system}.actor-subagents;
  # (M2.2) The patched source without upstream's tsconfig.json: tsc refuses
  # files named on its command line next to one (TS5112), and the type check's
  # flags are ours. package.json keeps the files ESM ("type": "module").
  actorSubagentsTs = pkgs.runCommand "actor-subagents-ts" {} ''
    mkdir $out
    cp -r ${actorSubagents}/extensions ${actorSubagents}/package.json $out/
  '';
  # (M2.3)
  iface = import ./iface {inherit lib pkgs typecheck;};
in {
  leak = leakLib.check leakSrc;
  leak-selftest = leakLib.selftest;
  npm-deps = npm.check;
  typecheck-harness = typecheck.selftest;
  iface-harness = iface.selftest;
  module-eval = import ./module-eval {inherit lib pkgs hm self;};
  pi-settings-migrate = import ./pi-settings-migrate {inherit lib pkgs hm;};
  # The bench's own tests run when its code builds (spec §8.1, "Package tests").
  bench = self.packages.${pkgs.stdenv.hostPlatform.system}.bench.code;
  typecheck-bench = typecheck.typecheck {
    name = "bench";
    src = ../packages/bench;
  };
  # The upstream suite of the patched pi-actor-subagents (spec §8.1), with the
  # host's check (checks/actor-subagents/default.nix, copied).
  actor-subagents = pkgs.callPackage ./actor-subagents {src = actorSubagents;};
  typecheck-actor-subagents = typecheck.typecheck {
    name = "actor-subagents";
    src = actorSubagentsTs;
  };
  # The bench probe's copy of __subagentsApi_v1 (spec §5.3, §8.1).
  iface-subagents-bench-probe = iface.compare {
    name = "subagents-bench-probe";
    provider = {
      src = actorSubagentsTs;
      file = "extensions/actor-subagents/api.ts";
      type = "SubagentsApiV1";
    };
    consumer = {
      src = ../packages/bench;
      file = "probe/index.ts";
      type = "SubagentsApi";
    };
  };
}
