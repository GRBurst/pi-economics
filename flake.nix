{
  description = "pi-economics: the pi coding agent's token-economics extensions as Home Manager components";

  inputs = {
    # Locked to the revisions the components were developed against; a
    # consumer makes both follow its own inputs (spec §3).
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

    # Checks only: the module-evaluation cases evaluate Home Manager.
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # The patched upstream (spec §3), locked to the revision the patch was
    # made against; a consumer makes it follow its own input.
    pi-infinite-context = {
      url = "github:fdietze/pi-infinite-context";
      flake = false;
    };

    # Checks only (router-extraction design §7.3, §8.3): the provider of
    # __subagentsApi_v1, pi-setup's patched actor-subagents
    # (`packages.<system>.actor-subagents`), for the interface comparisons and
    # the package checks that load it beside the components (its input
    # `pi-actor-subagents` is the source the registry's existence probe reads).
    pi-setup = {
      url = "github:GRBurst/pi-setup";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.home-manager.follows = "home-manager";
    };
    # Checks only (router-extraction design §7.3, §8.4, §8.5): the task router
    # whose outcome log token-meter reads (`log-contract`), whose copy of
    # __piExperimentsApi_v1 experiments provides and whose claim channel the
    # runtime guards share (`runtime-guard-copies`). Not locked until it is
    # published: evaluate with `--override-input pi-task-router <checkout>`.
    pi-task-router = {
      url = "github:GRBurst/pi-task-router";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.home-manager.follows = "home-manager";
      inputs.pi-setup.follows = "pi-setup";
    };
  };

  outputs = {
    self,
    nixpkgs,
    home-manager,
    pi-infinite-context,
    pi-setup,
    pi-task-router,
  }: let
    system = "x86_64-linux";
    pkgs = nixpkgs.legacyPackages.${system};
    inherit (nixpkgs) lib;
    # The pi package manifest, rendered from the module (render/default.nix).
    renderOf = pkgs:
      import ./render {
        inherit pkgs lib home-manager;
        homeModule = self.homeModules.default;
      };
  in {
    # The only module export (spec §3, "Exports"): every component and
    # common.nix, so every option a cross-component assertion reads exists.
    homeModules.default = {
      imports = [./modules];
      # The upstream source the patched component builds from (spec §3).
      programs.piEconomics.infiniteContext.src = lib.mkDefault pi-infinite-context;
    };

    # One package per component (spec §3); the module's `package` default
    # builds the same derivation from the consumer's pkgs.
    packages.${system} = {
      bench = pkgs.callPackage ./packages/bench/package.nix {};
      token-meter = pkgs.callPackage ./packages/token-meter/package.nix {};
      cache-lifecycle = pkgs.callPackage ./packages/cache-lifecycle/package.nix {};
      experiments = pkgs.callPackage ./packages/experiments/package.nix {};
      infinite-context = pkgs.callPackage ./packages/infinite-context/package.nix {src = pi-infinite-context;};
    };

    formatter.${system} = pkgs.alejandra;

    # The render tree, to build and inspect on its own.
    legacyPackages.${system}.render-tree = (renderOf pkgs).tree;

    # `nix run .#render` writes package.json into the checkout.
    apps.${system}.render = {
      type = "app";
      program = lib.getExe (renderOf pkgs).app;
      meta.description = "Write the rendered pi package manifest (package.json) into the checkout";
    };

    checks.${system} = import ./checks {
      inherit self pkgs lib home-manager pi-setup pi-task-router;
      render = renderOf pkgs;
    };
  };
}
