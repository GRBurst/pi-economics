# Every check of the flake. Build them one at a time, capped (AGENTS.md,
# "Commands"); never `nix flake check` without a memory cap.
{
  self,
  pkgs,
  lib,
  home-manager,
  render,
  # Check-only inputs (flake.nix): pi-setup's patched actor-subagents and the
  # task router's sources.
  pi-setup,
  pi-task-router,
}: let
  leakLib = import ./leak {inherit lib pkgs;};
  boundaryLib = import ./boundary {inherit lib pkgs;};
  npm = import ./npm {inherit lib pkgs;};
  # The package checks' prelude (checks/pi-package).
  pkgPi = import ./pi-package/lib.nix {inherit pkgs lib self;};
  hm = import ./lib/hm-eval.nix {
    inherit lib pkgs home-manager;
    homeModule = self.homeModules.default;
  };
  typecheck = import ./typecheck {
    inherit lib pkgs;
    inherit (npm) nodeModules;
  };
  # The task router's package, as the pi-task-router input ships it
  # (router-extraction design §7.3), for the checks that observe the router.
  routerSrc = "${pi-task-router}/packages/task-router";
  # (M2.3)
  iface = import ./iface {inherit lib pkgs typecheck;};
  # pi-setup's patched actor-subagents, the provider of __subagentsApi_v1 the
  # consumers meet (router-extraction design §8.3). Its type-check copy
  # (M2.2): the patched source without upstream's tsconfig.json (tsc refuses
  # files named on its command line next to one, TS5112; the type check's
  # flags are ours); package.json keeps the files ESM ("type": "module").
  setupActor = pi-setup.packages.${pkgs.stdenv.hostPlatform.system}.actor-subagents;
  setupActorTs = pkgs.runCommand "setup-actor-subagents-ts" {} ''
    mkdir $out
    cp -r ${setupActor}/extensions ${setupActor}/package.json $out/
  '';
  # pi-setup's actor as a registry entry, as its economics bridge forwards
  # programs.pi.extensions.actor-subagents (router-extraction design §7.3,
  # §8.2): the existence assertion probes the unpatched input, a source (no
  # import-from-derivation).
  actorEntry = {
    path = "${setupActor}/extensions/actor-subagents";
    checkPath = "${pi-setup.inputs.pi-actor-subagents}/extensions/actor-subagents/index.ts";
    input = "pi-actor-subagents";
    forChildren = false;
    description = "the patched actor-subagents (pi-setup)";
  };
  # (redesign M5a) pi-bench's sources: packages/bench as bench/ with the
  # experiments' design module it imports (packages/bench/package.nix).
  benchSrc = self.packages.${pkgs.stdenv.hostPlatform.system}.bench.code.src;
  # (redesign M5a, plan P22) The type-check copy of experiments: packages/experiments
  # as experiments/ with token-meter's core/plans.ts, whose types core/settings.ts
  # imports (`import type`, erased at runtime: the package ships without it).
  experimentsTs = lib.fileset.toSource {
    root = ../packages;
    fileset = lib.fileset.unions [../packages/experiments ../packages/token-meter/core/plans.ts];
  };
  # (M4.5) The provider of the globalThis API __subagentsApi_v1 (spec §5.3).
  subagentsProvider = {
    src = setupActorTs;
    file = "extensions/actor-subagents/api.ts";
    type = "SubagentsApiV1";
  };
  # (M6.4) The patched pi-infinite-context.
  infiniteContext = self.packages.${pkgs.stdenv.hostPlatform.system}.infinite-context;
  # (M6.5) The type-check copy: the extension without upstream's tsconfig.json
  # (TS5112, M2.2) and without the three tests that import fast-check, which
  # the shared lock does not hold (the check does not run them either).
  infiniteContextTs = pkgs.runCommand "infinite-context-ts" {} ''
    mkdir $out
    cp -r ${infiniteContext}/extensions ${infiniteContext}/package.json $out/
    chmod -R u+w $out
    rm $out/extensions/infinite-context/{archive-properties,forest,nudge}.test.ts
  '';
in {
  leak = leakLib.check ../.;
  leak-selftest = leakLib.selftest;
  boundary = boundaryLib.check ../.;
  boundary-selftest = boundaryLib.selftest;
  license = import ./license {inherit lib pkgs;};
  doc-pointers = import ./doc-pointers.nix {
    inherit lib pkgs;
    router = pi-task-router;
  };
  npm-deps = npm.check;
  typecheck-harness = typecheck.selftest;
  iface-harness = iface.selftest;
  module-eval = import ./module-eval {
    inherit lib pkgs hm self;
    inherit (render) version;
  };
  pi-settings-migrate = import ./pi-settings-migrate {inherit lib pkgs hm;};
  # The bench's own tests run when its code builds (spec §8.1, "Package tests").
  bench = self.packages.${pkgs.stdenv.hostPlatform.system}.bench.code;
  typecheck-bench = typecheck.typecheck {
    name = "bench";
    src = benchSrc;
  };
  # The bench probe's copy of __subagentsApi_v1 (spec §5.3, §8.1).
  iface-subagents-bench-probe = iface.compare {
    name = "subagents-bench-probe";
    provider = subagentsProvider;
    consumer = {
      src = benchSrc;
      file = "bench/probe/index.ts";
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
    src = experimentsTs;
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
      src = experimentsTs;
      file = "experiments/core/shell.ts";
      type = "SubagentsApi";
    };
  };
  # The patched upstream's suite, with the host's checks (spec §8.1).
  infinite-context = pkgs.callPackage ./infinite-context {
    src = infiniteContext;
    inherit (npm) nodeModules;
  };
  typecheck-infinite-context = typecheck.typecheck {
    name = "infinite-context";
    src = infiniteContextTs;
  };
  # (redesign M7a, plan T7a.7) The engine's copy of the extension's settings record, the type the seed is written as:
  # the extension's `Settings` must be assignable to it (the seed's fields, same names and types). A type-shape check
  # only: it does not see an optional field dropped or renamed upstream; ic-seed-contract runs the real code.
  iface-infinite-context-seed = iface.compare {
    name = "infinite-context-seed";
    provider = {
      src = infiniteContextTs;
      file = "extensions/infinite-context/settings.ts";
      type = "Settings";
    };
    consumer = {
      src = experimentsTs;
      file = "experiments/addons/infinite-context.ts";
      type = "IcRecord";
    };
  };
  # (redesign M7a) The seed contract on the real code of the extension, the engine and the meter.
  ic-seed-contract = import ./ic-seed-contract {
    inherit pkgs;
    ic = infiniteContext;
    experiments = ../packages/experiments;
    tokenMeter = ../packages/token-meter;
  };
  # (T2.1) The components' runtime check of __subagentsApi_v1 (core/runtime-guard.ts,
  # identical in each package: runtime-guard-copies; token-meter's is the reference).
  iface-subagents-runtime-guard = iface.compare {
    name = "subagents-runtime-guard";
    provider = subagentsProvider;
    consumer = {
      src = ../packages/token-meter;
      file = "core/runtime-guard.ts";
      type = "SubagentsApiShape";
    };
  };
  # (redesign M5b.2, §7.7) The internal channel replaces the process-global
  # __piExperimentsApi_v1 and its iface checks: the engine's payload, lever
  # states and names against the copies token-meter and cache-lifecycle keep.
  # The router's optional read of the old global is dead (redesign §11: the
  # router randomizes itself).
  internal-channel = import ./internal-channel {inherit lib pkgs typecheck;};
  state-contract = import ./state-contract {inherit lib pkgs;};
  # (redesign M5b.2, G5) No extension pi-economics patches or targets reads it:
  # patches/, the built patched infinite-context, the patched actor.
  dependency-direction = import ./dependency-direction {
    inherit pkgs;
    sources = ["${../patches}" "${infiniteContext}" "${setupActor}/extensions"];
  };
  # (M5.11) Every log writer through pi-analyse (spec §8.1); the router's
  # writer is the pi-task-router input's (router-extraction design §7.3).
  log-contract = pkgs.callPackage ./log-contract {router = routerSrc;};
  home-files = import ./home-files {inherit lib pkgs hm actorEntry;};
  # (AC2) The committed package.json against the render.
  render-package = import ./render.nix {inherit lib pkgs self render;};
  # (AC3) The manifest's laws, each named.
  pi-package-manifest = import ./pi-package/manifest.nix {
    inherit pkgs lib self;
    inherit (render) own;
  };
  # (AC1) pi install of the repository, offline.
  pi-install-smoke = import ./pi-package/smoke.nix {inherit (pkgPi) installed;};
  # (AC10) The npm step of the git route is a no-op offline.
  pi-git-route = import ./pi-package/git-route.nix {inherit pkgs self;};
  # (AC8) The runtime-guard.ts copies are token-meter's; its claim channel line
  # stands in the router's copy too (router-extraction design §8.5).
  runtime-guard-copies = import ./runtime-guard-copies.nix {
    inherit pkgs self;
    router = routerSrc;
  };
  # (AC5) The package next to pi-setup's patched actor: every extension loads, no warning.
  pi-install-actor = import ./pi-package/actor.nix {
    inherit (pkgPi) installed;
    actor = setupActor;
  };
  # (AC7) The package next to the Nix links: each duplicate says so once.
  pi-install-duplicate = import ./pi-package/duplicate.nix {
    inherit lib pkgs self;
    inherit (pkgPi) installed;
    inherit (render) own;
  };
  # (AC7, review M1) The package in two scopes of one project: exactly one copy of each component is bound.
  pi-install-scope-replaced = import ./pi-package/two-scopes.nix {
    inherit lib;
    inherit (pkgPi) installed;
    inherit (render) own;
    variant = "replaced";
  };
  pi-install-scope-both = import ./pi-package/two-scopes.nix {
    inherit lib;
    inherit (pkgPi) installed;
    inherit (render) own;
    variant = "both";
  };
  # (AC9) The two CLIs after `npm install -g <dir>`, run through an explicit node.
  bins-smoke = import ./pi-package/bins.nix {inherit pkgs self;};
  # (AC4) The README's filter loads only the listed extensions.
  pi-install-subset = import ./pi-package/subset.nix {inherit (pkgPi) installed;};
  # (AC15) The Nix route under real pi: the home-files fixture's agent directory with
  # pi-setup's actor and the pi-task-router input's router as registry entries, pi -p offline.
  nix-route-smoke = import ./pi-package/nix-route.nix {
    inherit lib pkgs hm actorEntry;
    router = {
      package = pi-task-router.packages.${pkgs.stdenv.hostPlatform.system}.task-router;
      src = pi-task-router;
    };
  };
  # redesign M10
  identity-shim-probe = import ./identity-shim-probe {inherit pkgs;};
  # redesign M6
  load-order = import ./load-order {inherit lib pkgs hm actorEntry;};
  # redesign M7c
  session-entry-contract = pkgs.callPackage ./session-entry-contract {};
  # redesign M5b.1: the analyser's copy of experiments' Objective literal set
  # (packages never import each other), compared both ways: equal sets.
  iface-objective-experiments-token-meter = iface.compare {
    name = "objective-experiments-token-meter";
    provider = {
      src = experimentsTs;
      file = "experiments/core/settings.ts";
      type = "Objective";
    };
    consumer = {
      src = ../packages/token-meter;
      file = "core/analyse/experiment.ts";
      type = "Objective";
    };
  };
  iface-objective-token-meter-experiments = iface.compare {
    name = "objective-token-meter-experiments";
    provider = {
      src = ../packages/token-meter;
      file = "core/analyse/experiment.ts";
      type = "Objective";
    };
    consumer = {
      src = experimentsTs;
      file = "experiments/core/settings.ts";
      type = "Objective";
    };
  };
}
