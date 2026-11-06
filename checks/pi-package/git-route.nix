# The npm step of pi's git route (AC10): after cloning, pi runs
# `npm install --omit=dev --legacy-peer-deps` in the clone (pi 1.4,
# getGitDependencyInstallArgs). With no dependencies it installs nothing and
# needs no network: offline it exits 0 and leaves no node_modules. The
# arguments are pi's, not ours: the sentinel below reads them from the locked
# pi's dist, so a pi that changes them fails here instead of leaving the npm
# step below testing arguments pi no longer passes.
{
  pkgs,
  self,
}:
pkgs.runCommand "pi-git-route" {nativeBuildInputs = [pkgs.nodejs pkgs.coreutils pkgs.gnugrep pkgs.findutils];} ''
  args='return ["install", "--omit=dev", "--legacy-peer-deps"];'
  files=$(find ${pkgs.pi-coding-agent} -path '*/dist/core/package-manager.js')
  [ -n "$files" ] || {
    echo "pi-git-route: no dist/core/package-manager.js in ${pkgs.pi-coding-agent} (did pkgs.pi-coding-agent move?)" >&2
    exit 1
  }
  grep -qF "$args" $files || {
    echo "pi-git-route: pi's npm arguments are no longer '--omit=dev --legacy-peer-deps' (getGitDependencyInstallArgs in $files); update the npm step below to pi's" >&2
    exit 1
  }
  export HOME=$PWD/home npm_config_cache=$PWD/npmcache
  mkdir -p "$HOME"
  cp -r ${self} pkg
  chmod -R u+w pkg
  rc=0
  (cd pkg && npm install --omit=dev --legacy-peer-deps --offline) >npm.log 2>&1 || rc=$?
  cat npm.log
  [ "$rc" = 0 ] || {
    echo "pi-git-route: npm install exited $rc" >&2
    exit 1
  }
  if [ -e pkg/node_modules ]; then
    echo "pi-git-route: npm installed: $(ls pkg/node_modules)" >&2
    exit 1
  fi
  touch $out
''
