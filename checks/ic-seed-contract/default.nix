# The seed contract of infinite-context's fold-reminder limit (redesign §7.4, M7a), on the real code of its three
# sides: the patched extension (`ic`, the package output the module links), the experiments engine with its
# infinite-context add-on and token-meter's shell, all from this repository's sources. Only pi's own packages are
# stand-ins (../infinite-context/stubs). A new upstream or a patch that changes the record's shape, the keep rule or the
# rule resolution fails here, and so does an add-on that seeds a record the extension would not adopt.
{
  pkgs,
  ic,
  experiments,
  tokenMeter,
}:
pkgs.runCommand "ic-seed-contract" {nativeBuildInputs = [pkgs.nodejs];} ''
  export HOME=$TMPDIR/home
  mkdir -p "$HOME"

  mkdir -p work/node_modules/@earendil-works
  cp -r ${ic} work/ic
  cp -r ${experiments} work/experiments
  cp -r ${tokenMeter} work/token-meter
  cp -r ${../infinite-context/stubs/pi-coding-agent} work/node_modules/@earendil-works/pi-coding-agent
  cp -r ${../infinite-context/stubs/typebox} work/node_modules/typebox
  cp ${./contract.test.ts} work/contract.test.ts
  echo '{"type": "module"}' > work/package.json
  chmod -R u+w work

  cd work
  node --test --experimental-strip-types contract.test.ts
  touch $out
''
