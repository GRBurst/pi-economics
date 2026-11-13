# (AC11) README's "Without Nix" section agrees with what the package ships:
# the install line carries the manifest's version as the tag, the subset block
# is the checked fixture line by line, the prerequisites table has one row per
# upstream and no other, each with the pinned wording (the actor: patched
# build, upstream support pending; infinite-context: what the upstream does as
# it is, and what only the patched build adds), the experiments opt-in block, the skill collision note
# and the duplicate guard's version note are there, and (M6) the load order note: list the package first
# in `packages`. Lines are compared whole or searched with
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
  # The patched actor is pi-setup's (router-extraction design §7.3), as the runtime warning says.
  pinned = "Patched build via pi-setup's Nix module (programs.pi.actorSubagents); upstream support pending.";
  # review L1: the upstream already gives the fold reminders
  partial = {
    pi-infinite-context = "the upstream's fold reminders work as they are";
  };
  onlyPatched = "only with the patched build via the pi-economics Nix modules (upstream support pending for that part)";
  claimsMissing = {
    pi-infinite-context = "no fold reminders";
  };
  upstreams = ["pi-actor-subagents" "pi-infinite-context"];
  row = u: lib.filter (l: lib.hasPrefix "| ${u} |" l) readme;
  # The prerequisites table: the first table after its heading, without the
  # header and separator rows; a row's package is its first cell.
  prereqAt = lib.lists.findFirstIndex (l: l == "### Prerequisites") null readme;
  afterPrereq = lib.drop (prereqAt + 1) readme;
  fromTable = lib.drop (lib.lists.findFirstIndex (lib.hasPrefix "|") (lib.length afterPrereq) afterPrereq) afterPrereq;
  prereqRows = lib.drop 2 (lib.take (lib.lists.findFirstIndex (l: !lib.hasPrefix "|" l) (lib.length fromTable) fromTable) fromTable);
  packageOf = l: lib.head (lib.splitString " |" (lib.removePrefix "| " l));
in {
  readme-package =
    expect.eq "the install line, once" (lib.filter (l: l == install) readme) [install]
    ++ expect.eq "the fixture's source is the install line's ref" fixtureJson.source "git:github.com/GRBurst/pi-economics@v${version}"
    ++ expect.holds "README has the subset marker" (at != null)
    ++ lib.optionals (at != null) (expect.eq "README's subset block = the fixture" block fixture)
    ++ expect.holds "README has the prerequisites heading" (prereqAt != null)
    ++ lib.optionals (prereqAt != null) (expect.eq "the prerequisites rows are the upstreams, in order" (map packageOf prereqRows) upstreams)
    ++ lib.concatMap (
      u:
        expect.holds "one prerequisites row for ${u}" (lib.length (row u) == 1)
        ++ lib.concatMap (
          r:
            if u == "pi-actor-subagents"
            then expect.holds "the ${u} row says: ${pinned}" (has pinned r)
            else
              expect.holds "the ${u} row says: ${partial.${u}}" (has partial.${u} r)
              ++ expect.holds "the ${u} row says: ${onlyPatched}" (has onlyPatched r)
              ++ expect.holds "the ${u} row does not say \"${claimsMissing.${u}}\"" (!(has claimsMissing.${u} r))
        ) (row u)
    )
    upstreams
    ++ expect.holds "the experiments opt-in names its file" (lib.length (withText "<agentDir>/experiments/settings.json") >= 1)
    ++ expect.holds "the experiments opt-in block is there" (lib.elem ''{ "mode": "explore" }'' readme)
    ++ expect.holds "the skill collision note names the skill" (lib.length (lib.filter (has "name collision") (withText "pi-token-economics-analysis")) >= 1)
    ++ expect.holds "the duplicate warning is described" (lib.length (withText "is loaded") >= 1)
    ++ expect.holds "the duplicate guard's version note is there (L2)" (lib.length (withText "needs both copies at this version or later") == 1)
    ++ expect.holds "README does not hedge on the expansion of ~ (L: pi expands it)" (lib.length (withText "is not verified") == 0)
    ++ expect.holds "the load order heading is there (M6)" (lib.elem "### Load order" readme)
    ++ expect.holds "the package route lists pi-economics first in packages (M6)" (withText "first in `packages`" != []);
}
