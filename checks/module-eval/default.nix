# Module-evaluation cases (spec §8.1). A case file returns
# { <case> = [ failure strings ]; }, empty when the case holds. The check fails
# at build time and lists every failing case. A milestone adds its file to
# caseFiles.
{
  lib,
  pkgs,
  hm,
  self,
}: let
  expect = import ./expect.nix {inherit lib;};
  caseFiles = [
    ./cases/common.nix
    ./cases/bench.nix
    ./cases/actor-subagents.nix
    ./cases/token-meter.nix
    ./cases/analysis-skill.nix
    ./cases/together.nix
  ];
  cases =
    lib.foldl' (
      acc: file: let
        f = import file;
        # A case file takes the arguments it names.
        new = f (builtins.intersectAttrs (lib.functionArgs f) {inherit lib pkgs hm self expect;});
        dup = lib.intersectLists (lib.attrNames acc) (lib.attrNames new);
      in
        if dup != []
        then throw "module-eval: duplicate case names: ${toString dup}"
        else acc // new
    ) {}
    caseFiles;
  failures = lib.concatLists (lib.mapAttrsToList (name: errs: map (e: "FAIL ${name}: ${e}") errs) cases);
in
  assert lib.assertMsg (cases != {}) "module-eval: no cases";
    pkgs.runCommand "module-eval" {
      report = builtins.unsafeDiscardStringContext (lib.concatStringsSep "\n" failures);
      passAsFile = ["report"];
      count = toString (lib.length (lib.attrNames cases));
    } ''
      if [ -s "$reportPath" ]; then
        cat "$reportPath" >&2
        echo >&2
        echo "module-eval: $(grep -c '^FAIL ' "$reportPath") failure(s) in $count cases" >&2
        exit 1
      fi
      echo "module-eval: $count cases passed"
      touch $out
    ''
