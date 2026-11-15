# (0.3.3) cache-lifecycle's masking (maskOnCold) and infinite-context's fold
# overlay in one request, on the real code of both: upstream's extension
# (`ic`, the package output the module links, unpatched) and cache-lifecycle's
# shell from this repository's sources, with token-meter's systemHash in its
# slot. The fake pi runs pi 1.4's emitContext (`context` handlers, then
# `context_with_system` ones, each in load order) in two orders, neither a
# literal: the module's `loadOrder` with every component on (the Nix route),
# and the root package.json's extensions followed by the pi-infinite-context
# package (the package route, README's "Load order"). The overlay refuses a
# request whose projected messages an earlier `context` handler changed
# (ProjectionMismatchError), so cache-lifecycle masks in
# `context_with_system`, after it. Only pi's own packages are stand-ins
# (../infinite-context/stubs).
{
  lib,
  pkgs,
  hm,
  ic,
  cacheLifecycle,
  tokenMeter,
}: let
  c = hm.eval {
    programs.piEconomics = {
      tokenMeter.enable = true;
      cacheLifecycle.enable = true;
      experiments.enable = true;
      infiniteContext.enable = true;
    };
  };
  order = map baseNameOf c.programs.piEconomics.loadOrder;
  manifest = lib.importJSON ../../package.json;
  packageOrder = map (p: baseNameOf (dirOf p)) manifest.pi.extensions ++ ["infinite-context"];
  # pi-ai's getCurrentSystemMessage (and the text helpers it imports), of the
  # pinned pi: the fake emitContext restores system messages with it.
  piAi = "${pkgs.pi-coding-agent}/lib/node_modules/pi-monorepo/node_modules/@earendil-works/pi-ai";
in
  pkgs.runCommand "context-chain" {
    nativeBuildInputs = [pkgs.nodejs];
    LOAD_ORDER = builtins.toJSON order;
    PACKAGE_ORDER = builtins.toJSON packageOrder;
  } ''
    export HOME=$TMPDIR/home
    mkdir -p "$HOME"

    mkdir -p work/node_modules/@earendil-works work/token-meter
    cp -r ${ic} work/ic
    cp -r ${cacheLifecycle} work/cache-lifecycle
    cp -r ${tokenMeter}/core work/token-meter/core
    mkdir work/pi-ai
    cp ${piAi}/dist/utils/transcript.js ${piAi}/dist/utils/text.js work/pi-ai/
    cp -r ${../infinite-context/stubs/pi-coding-agent} work/node_modules/@earendil-works/pi-coding-agent
    cp -r ${../infinite-context/stubs/typebox} work/node_modules/typebox
    cp ${./contract.test.ts} work/contract.test.ts
    echo '{"type": "module"}' > work/package.json
    chmod -R u+w work

    cd work
    echo "load order: $LOAD_ORDER; package route: $PACKAGE_ORDER"
    node --test --experimental-strip-types contract.test.ts
    touch $out
  ''
