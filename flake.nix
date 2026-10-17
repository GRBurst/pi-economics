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

    # A patched upstream (spec §3), locked to the host's revision; the host
    # makes it follow its own input.
    pi-actor-subagents = {
      url = "github:fdietze/pi-actor-subagents";
      flake = false;
    };
  };

  outputs = {
    self,
    nixpkgs,
    home-manager,
    pi-actor-subagents,
  }: let
    system = "x86_64-linux";
    pkgs = nixpkgs.legacyPackages.${system};
    inherit (nixpkgs) lib;
  in {
    # The only module export (spec §3, "Exports"): every component and
    # common.nix, so every option a cross-component assertion reads exists.
    homeModules.default = {
      imports = [./modules];
      # The upstream source the patched component builds from (spec §3).
      programs.piEconomics.actorSubagents.src = lib.mkDefault pi-actor-subagents;
    };

    # One package per component (spec §3); the module's `package` default
    # builds the same derivation from the consumer's pkgs.
    packages.${system} = {
      bench = pkgs.callPackage ./packages/bench/package.nix {};
      actor-subagents = pkgs.callPackage ./packages/actor-subagents/package.nix {src = pi-actor-subagents;};
      token-meter = pkgs.callPackage ./packages/token-meter/package.nix {};
    };

    formatter.${system} = pkgs.alejandra;

    checks.${system} = import ./checks {inherit self pkgs lib home-manager;};
  };
}
