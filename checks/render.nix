# The committed package.json against the render (spec D1, AC2): `diff -u`
# names a differing and a missing file alike.
{
  pkgs,
  self,
  render,
}:
pkgs.runCommand "render-package" {nativeBuildInputs = [pkgs.diffutils];} ''
  diff -u ${render.tree}/package.json ${self}/package.json || {
    echo "render-package: package.json differs from the Nix output; run nix run .#render" >&2
    exit 1
  }
  touch $out
''
