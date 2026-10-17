{
  description = "pi-economics: the pi coding agent's token-economics extensions as Home Manager components";

  inputs = {
    # Locked to the host's revisions (docs/plans/2026-10-17-m0-skeleton-plan.md,
    # M0.1); the host makes both follow its own inputs (spec §3).
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

    # Checks only: the module-evaluation cases evaluate Home Manager.
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = {
    self,
    nixpkgs,
    home-manager,
  }: let
    system = "x86_64-linux";
    pkgs = nixpkgs.legacyPackages.${system};
    inherit (nixpkgs) lib;
  in {
    # The only module export (spec §3, "Exports"): every component and
    # common.nix, so every option a cross-component assertion reads exists.
    homeModules.default = ./modules;

    # One package per component (spec §3); the module's `package` default
    # builds the same derivation from the consumer's pkgs.
    packages.${system}.bench = pkgs.callPackage ./packages/bench/package.nix {};

    formatter.${system} = pkgs.alejandra;

    checks.${system} = import ./checks {inherit self pkgs lib home-manager;};
  };
}
