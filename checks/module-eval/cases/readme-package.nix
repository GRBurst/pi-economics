# (AC11) README's "Without Nix" section agrees with what the package ships:
# the install line carries the manifest's version as the tag, the subset block
# is the checked fixture line by line, every upstream has its prerequisites
# row with the pinned wording (the actor: patched build, upstream support
# pending; the other two: what the upstream does as it is, and what only the
# patched build adds), the experiments opt-in block, the skill collision note
# and the duplicate guard's version note are there. Lines are compared whole or searched with
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
  # review L1: the upstream already gives the fold reminders and the retry events the meter reads
  partial = {
    pi-infinite-context = "the upstream's fold reminders work as they are";
    pi-retry = "the meter's retry accounting works with the upstream";
  };
  onlyPatched = "only with the patched build via the pi-economics Nix modules (upstream support pending for that part)";
  claimsMissing = {
    pi-infinite-context = "no fold reminders";
    pi-retry = "no retry accounting";
  };
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
    ++ expect.holds "README does not hedge on the expansion of ~ (L: pi expands it)" (lib.length (withText "is not verified") == 0);
}
