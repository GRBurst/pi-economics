# (P.9) README's Home Manager example is the fixture, line by line, and the
# fixture evaluates without a failed assertion.
{
  lib,
  hm,
  expect,
}: let
  readme = lib.splitString "\n" (builtins.readFile ../../../README.md);
  fixture = lib.splitString "\n" (builtins.readFile ../fixtures/readme-example.nix);
  marker = "<!-- checked: checks/module-eval/fixtures/readme-example.nix -->";
  at = lib.lists.findFirstIndex (l: l == marker) null readme;
  rest = lib.drop (at + 2) readme; # the marker, then the "```nix" fence
  end = lib.lists.findFirstIndex (l: l == "```") (lib.length rest) rest;
  block = lib.take end rest;
in {
  readme-example =
    expect.holds "README has the marker" (at != null)
    ++ lib.optionals (at != null) (expect.eq "README's nix block = fixture" block (lib.init fixture)) # the fixture ends with a newline
    ++ expect.eq "no failed assertion" (expect.failed "pi-economics:" (hm.eval (import ../fixtures/readme-example.nix))) [];
}
