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

    # The patched upstreams (spec §3), locked to the revisions the patches were
    # made against; a consumer makes them follow its own inputs.
    pi-actor-subagents = {
      url = "github:fdietze/pi-actor-subagents";
      flake = false;
    };
    pi-infinite-context = {
      url = "github:fdietze/pi-infinite-context";
      flake = false;
    };
    pi-retry = {
      url = "github:monotykamary/pi-retry";
      flake = false;
    };
  };

  outputs = {
    self,
    nixpkgs,
    home-manager,
    pi-actor-subagents,
    pi-infinite-context,
    pi-retry,
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
      # The upstream sources the patched components build from (spec §3).
      programs.piEconomics.actorSubagents.src = lib.mkDefault pi-actor-subagents;
      programs.piEconomics.infiniteContext.src = lib.mkDefault pi-infinite-context;
      programs.piEconomics.retry.src = lib.mkDefault pi-retry;
    };

    # One package per component (spec §3); the module's `package` default
    # builds the same derivation from the consumer's pkgs.
    packages.${system} = {
      bench = pkgs.callPackage ./packages/bench/package.nix {};
      actor-subagents = pkgs.callPackage ./packages/actor-subagents/package.nix {src = pi-actor-subagents;};
      token-meter = pkgs.callPackage ./packages/token-meter/package.nix {};
      cache-lifecycle = pkgs.callPackage ./packages/cache-lifecycle/package.nix {};
      experiments = pkgs.callPackage ./packages/experiments/package.nix {};
      task-router = pkgs.callPackage ./packages/task-router/package.nix {};
      infinite-context = pkgs.callPackage ./packages/infinite-context/package.nix {src = pi-infinite-context;};
      retry = pkgs.callPackage ./packages/retry/package.nix {src = pi-retry;};
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
      inherit self pkgs lib home-manager;
      render = renderOf pkgs;
    };
  };
}
