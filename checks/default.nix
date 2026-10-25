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
  # (M4.5) The provider of the globalThis API __subagentsApi_v1 (spec §5.3).
  subagentsProvider = {
    src = actorSubagentsTs;
    file = "extensions/actor-subagents/api.ts";
    type = "SubagentsApiV1";
  };
  # (M4.7) The provider of the globalThis API __piExperimentsApi_v1 (spec §5.3).
  experimentsProvider = {
    src = ../packages/experiments;
    file = "core/api.ts";
    type = "ExperimentsApiV1";
  };
  # (M6.4) The patched pi-infinite-context.
  infiniteContext = self.packages.${pkgs.stdenv.hostPlatform.system}.infinite-context;
  # (M6.5) The type-check copy: the extension without upstream's tsconfig.json
  # (TS5112, M2.2) and without the two property tests that import fast-check,
  # which the shared lock does not hold (the check does not run them either).
  infiniteContextTs = pkgs.runCommand "infinite-context-ts" {} ''
    mkdir $out
    cp -r ${infiniteContext}/extensions ${infiniteContext}/package.json $out/
    chmod -R u+w $out
    rm $out/extensions/infinite-context/{archive-properties,forest}.test.ts
  '';
  # (M6.6) The patched pi-retry.
  retry = self.packages.${pkgs.stdenv.hostPlatform.system}.retry;
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
  # The token-meter tests run when it builds (spec §8.1, "Package tests").
  token-meter = self.packages.${pkgs.stdenv.hostPlatform.system}.token-meter;
  typecheck-token-meter = typecheck.typecheck {
    name = "token-meter";
    src = ../packages/token-meter;
  };
  # The cache-lifecycle tests run when it builds (spec §8.1, "Package tests").
  cache-lifecycle = self.packages.${pkgs.stdenv.hostPlatform.system}.cache-lifecycle;
  typecheck-cache-lifecycle = typecheck.typecheck {
    name = "cache-lifecycle";
    src = ../packages/cache-lifecycle;
  };
  # The experiments tests run when it builds.
  experiments = self.packages.${pkgs.stdenv.hostPlatform.system}.experiments;
  typecheck-experiments = typecheck.typecheck {
    name = "experiments";
    src = ../packages/experiments;
  };
  # (M4.5, M4.6) The copies of __subagentsApi_v1 in cache-lifecycle and experiments (spec §5.3, §8.1).
  iface-subagents-cache-lifecycle = iface.compare {
    name = "subagents-cache-lifecycle";
    provider = subagentsProvider;
    consumer = {
      src = ../packages/cache-lifecycle;
      file = "core/api.ts";
      type = "SubagentsApiV1";
    };
  };
  iface-subagents-experiments = iface.compare {
    name = "subagents-experiments";
    provider = subagentsProvider;
    consumer = {
      src = ../packages/experiments;
      file = "core/shell.ts";
      type = "SubagentsApi";
    };
  };
  # (M4.7, M4.8) The copies of __piExperimentsApi_v1 in token-meter and cache-lifecycle.
  iface-experiments-token-meter = iface.compare {
    name = "experiments-token-meter";
    provider = experimentsProvider;
    consumer = {
      src = ../packages/token-meter;
      file = "core/shell.ts";
      type = "ExperimentsApi";
    };
  };
  iface-experiments-cache-lifecycle = iface.compare {
    name = "experiments-cache-lifecycle";
    provider = experimentsProvider;
    consumer = {
      src = ../packages/cache-lifecycle;
      file = "core/shell.ts";
      type = "ExperimentsApi";
    };
  };
  # The patched upstreams' suites, with the host's checks (spec §8.1).
  infinite-context = pkgs.callPackage ./infinite-context {src = infiniteContext;};
  typecheck-infinite-context = typecheck.typecheck {
    name = "infinite-context";
    src = infiniteContextTs;
  };
  retry = pkgs.callPackage ./retry {
    src = retry;
    inherit (npm) nodeModules;
  };
  home-files = import ./home-files {inherit lib pkgs hm;};
}
