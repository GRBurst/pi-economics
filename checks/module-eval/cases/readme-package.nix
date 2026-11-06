# (AC11) README's "Without Nix" section agrees with what the package ships:
# the install line carries the manifest's version as the tag, the subset block
# is the checked fixture line by line, every upstream has its prerequisites
# row with the pinned wording, the experiments opt-in block and the skill
# collision note are there. Lines are compared whole or searched with
# `replaceStrings` (no regex over the README).
{
  lib,
  expect,
}: let
  readme = lib.splitString "\n" (builtins.readFile ../../../README.md);
  version = (builtins.fromJSON (builtins.readFile ../../../package.json)).version;
  has = infix: line: builtins.replaceStrings [infix] [""] line != line;
  withText = infix: lib.filter (has infix) readme;

  marker = "<!-- checked: checks/pi-package/subset.json -->";
  at = lib.lists.findFirstIndex (l: l == marker) null readme;
  rest = lib.drop (at + 2) readme; # the marker, then the "```json" fence
  end = lib.lists.findFirstIndex (l: l == "```") (lib.length rest) rest;
  block = lib.take end rest;
  fixtureText = builtins.readFile ../../pi-package/subset.json;
  fixture = lib.init (lib.splitString "\n" fixtureText); # ends with a newline
  fixtureJson = builtins.fromJSON fixtureText;

  install = "pi install git:github.com/GRBurst/pi-economics@v${version}";
  pinned = "Patched build via the pi-economics Nix modules; upstream support pending.";
  upstreams = ["pi-actor-subagents" "pi-infinite-context" "pi-retry"];
  row = u: lib.filter (l: lib.hasPrefix "| ${u} |" l) readme;
in {
  readme-package =
    expect.eq "the install line, once" (lib.filter (l: l == install) readme) [install]
    ++ expect.eq "the fixture's source is the install line's ref" fixtureJson.source "git:github.com/GRBurst/pi-economics@v${version}"
    ++ expect.holds "README has the subset marker" (at != null)
    ++ lib.optionals (at != null) (expect.eq "README's subset block = the fixture" block fixture)
    ++ lib.concatMap (
      u:
        expect.holds "one prerequisites row for ${u}" (lib.length (row u) == 1)
        ++ lib.concatMap (r: expect.holds "the ${u} row says: ${pinned}" (has pinned r)) (row u)
    )
    upstreams
    ++ expect.holds "the experiments opt-in names its file" (lib.length (withText "<agentDir>/experiments/settings.json") >= 1)
    ++ expect.holds "the experiments opt-in block is there" (lib.elem ''{ "mode": "explore" }'' readme)
    ++ expect.holds "the skill collision note names the skill" (lib.length (lib.filter (has "name collision") (withText "pi-token-economics-analysis")) >= 1)
    ++ expect.holds "the duplicate warning is described" (lib.length (withText "is loaded") >= 1);
}
