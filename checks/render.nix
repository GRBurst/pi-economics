# The committed package.json against the render (spec D1, AC2): `diff -u`
# names a differing and a missing file alike. Also every packages/<c>/package.json
# carries the root version constant (render/default.nix): a release edits the
# constant and the component manifests follow, and the Nix derivation names
# (pi-<c>-<version>) follow the manifests.
{
  lib,
  pkgs,
  self,
  render,
}: let
  # The components with a package.json of their own (the patched upstreams
  # have none: their version is upstream's).
  components =
    lib.filter (n: builtins.pathExists (../packages + "/${n}/package.json"))
    (lib.attrNames (builtins.readDir ../packages));
  versions = pkgs.writeText "component-versions" (lib.concatMapStrings (n: "${n} ${(lib.importJSON (../packages + "/${n}/package.json")).version}\n") components);
in
  pkgs.runCommand "render-package" {nativeBuildInputs = [pkgs.diffutils];} ''
    diff -u ${render.tree}/package.json ${self}/package.json || {
      echo "render-package: package.json differs from the Nix output; run nix run .#render" >&2
      exit 1
    }
    status=0
    while read -r name version; do
      if [ "$version" != "${render.version}" ]; then
        echo "render-package: packages/$name/package.json has version $version; the root constant (render/default.nix) is ${render.version}" >&2
        status=1
      fi
    done <${versions}
    [ "$status" = 0 ] || exit 1
    touch $out
  ''
