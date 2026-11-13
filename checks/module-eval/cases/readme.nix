# (P.9) README's Home Manager example is the fixture, line by line, and the
# fixture evaluates without a failed assertion. (M6) README names where the
# components are linked, not pi's auto-discovered directory, and that they
# are listed first in settings.json's `extensions`; lines are searched with
# `replaceStrings` (no regex over the README).
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
  has = infix: line: builtins.replaceStrings [infix] [""] line != line;
  withText = infix: lib.filter (has infix) readme;
in {
  readme-example =
    expect.holds "README has the marker" (at != null)
    ++ lib.optionals (at != null) (expect.eq "README's nix block = fixture" block (lib.init fixture)) # the fixture ends with a newline
    ++ expect.eq "no failed assertion" (expect.failed "pi-economics:" (hm.eval (import ../fixtures/readme-example.nix))) []
    ++ expect.holds "README names the link directory <agentDir>/pi-economics/extensions" (withText "`<agentDir>/pi-economics/extensions`" != [])
    ++ expect.holds "README says the components come first in settings.json's extensions" (withText "at the front of" != [])
    ++ expect.eq "README no longer links into <agentDir>/extensions" (withText "into `<agentDir>/extensions`") [];
}
