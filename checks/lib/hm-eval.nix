# Home Manager evaluated as its modules/default.nix does (`rawModule`), without
# `moduleChecks`: that wrapper throws on the first failed assertion, and the
# negative cases must read config.assertions and their messages (plan M0, D4).
# A Home Manager update that moves these two files fails here, at evaluation.
{
  lib,
  pkgs,
  home-manager,
  homeModule,
}: let
  hmLib = import "${home-manager}/modules/lib/stdlib-extended.nix" lib;
  hmModules = import "${home-manager}/modules/modules.nix" {
    inherit pkgs;
    lib = hmLib;
    check = true;
  };
  user = {
    home.username = "u";
    home.homeDirectory = "/home/u";
    home.stateVersion = "26.05";
  };
  evalWith = modules:
    hmLib.evalModules {
      modules = modules ++ [user] ++ hmModules;
      class = "homeManager";
      specialArgs.modulesPath = "${home-manager}/modules";
    };
in {
  # The config of a case module, with this flake's module imported.
  eval = module: (evalWith [homeModule module]).config;
  # The same without this flake's module: the baseline of `inert`.
  evalBare = module: (evalWith [module]).config;
  # The option declarations, for checks on an option's type.
  options = module: (evalWith [homeModule module]).options;
}
