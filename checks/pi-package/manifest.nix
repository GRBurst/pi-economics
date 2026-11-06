# The pi package manifest's laws (spec §4.1, AC3). Each law reports on its
# own, named, so a planted violation names its law: private, the gallery
# keyword, a semver version, exactly pi's five host packages as `*` peers,
# every host package a shipped `.ts` imports a peer (imported-not-peer), no
# dependencies, every manifest path present, every bin with its pinned
# shebang and executable, every skills directory holding a skill. The extension set itself is render-package's (AC2). `jq` and
# fixed-string `grep` at build time.
{
  pkgs,
  lib,
  self,
  # The own components (render.own): their directories are the shipped code.
  own,
}: let
  # pi's packages documentation: provided by pi, so peers, never bundled.
  host = [
    "@earendil-works/pi-agent-core"
    "@earendil-works/pi-ai"
    "@earendil-works/pi-coding-agent"
    "@earendil-works/pi-tui"
    "typebox"
  ];
  shipped = map (c: "packages/${c}") own;
in
  pkgs.runCommand "pi-package-manifest" {nativeBuildInputs = [pkgs.jq pkgs.gnugrep pkgs.coreutils pkgs.findutils];} ''
    cp -r ${self} pkg
    chmod -R u+w pkg
    cd pkg
    fail=0
    bad() {
      echo "pi-package-manifest: $1: $2" >&2
      fail=1
    }
    m=package.json
    [ -f "$m" ] || {
      echo "pi-package-manifest: no package.json" >&2
      exit 1
    }
    jq -e '.private == true' "$m" >/dev/null || bad private "private is not true"
    jq -e '(.keywords // []) | index("pi-package") != null' "$m" >/dev/null || bad keyword "the keyword pi-package is missing"
    jq -e '(.version // "") | test("^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$")' "$m" >/dev/null || bad semver "version $(jq -c .version "$m") is not semver"
    jq -e --argjson h ${lib.escapeShellArg (builtins.toJSON host)} '(.peerDependencies // {}) == ($h | map({(.): "*"}) | add)' "$m" >/dev/null \
      || bad peers "peerDependencies $(jq -c '.peerDependencies // {}' "$m") are not exactly pi's host packages, each \"*\""
    for h in ${lib.escapeShellArgs host}; do
      if grep -rqF --include='*.ts' -e "\"$h\"" -e "'$h'" -e "\"$h/" -e "'$h/" ${lib.escapeShellArgs shipped}; then
        jq -e --arg h "$h" '(.peerDependencies // {}) | has($h)' "$m" >/dev/null || bad imported-not-peer "$h is imported by a shipped .ts but is not a peer dependency"
      fi
    done
    jq -e '(.dependencies // {}) == {}' "$m" >/dev/null || bad no-dependencies "dependencies $(jq -c .dependencies "$m")"
    jq -e '(.devDependencies // {}) == {}' "$m" >/dev/null || bad no-dependencies "devDependencies $(jq -c .devDependencies "$m")"
    # a pi key that is not an array fails the law (not a silent skip of the later keys)
    if paths=$(jq -r '.pi | to_entries[] | .value | if type == "array" then .[] else error("a pi manifest key is not an array") end' "$m"); then
      while IFS= read -r p; do
        [ -e "$p" ] || bad paths "the manifest path $p does not exist"
      done <<<"$paths"
    else
      bad paths "the pi manifest cannot be read as paths (a key is not an array)"
    fi
    while IFS= read -r s; do
      [ -n "$(find "$s" -name SKILL.md 2>/dev/null)" ] || bad skills "the skills path $s holds no SKILL.md"
    done < <(jq -r '(.pi.skills // [])[]' "$m")
    # every bin: the shipped first line (spec D8) and the executable bit (npm links the file as it is)
    while IFS= read -r b; do
      [ -f "$b" ] || {
        bad bin-shebang "the bin $b does not exist"
        continue
      }
      [ "$(head -n1 "$b")" = '#!/usr/bin/env -S node --experimental-strip-types --no-warnings' ] || bad bin-shebang "the first line of $b is not the pinned shebang"
      [ -x "$b" ] || bad bin-executable "the bin $b is not executable"
    done < <(jq -r '(.bin // {})[]' "$m")
    # the skill's fallback paths (spec D9, E21): relative to the skill's directory, so they must resolve there,
    # and the two the analysis needs must be named
    while IFS= read -r f; do
      s=$(dirname "$f")
      for want in ../../packages/token-meter/bin/pi-analyse.ts ../../packages/token-meter/LOGS.md; do
        grep -qF "$want" "$f" || bad skill-fallback "$f does not name $want"
      done
      while IFS= read -r r; do
        [ -e "$s/$r" ] || bad skill-fallback "$f names $r, which does not exist relative to $s"
      done < <(grep -o '\.\./\.\./[A-Za-z0-9_./-]*' "$f" | sort -u)
    done < <(find $(jq -r '(.pi.skills // [])[]' "$m") -name SKILL.md)
    [ "$fail" = 0 ] || exit 1
    touch $out
  ''
