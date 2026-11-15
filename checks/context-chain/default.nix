# (0.3.3) The `context` handlers of cache-lifecycle (maskOnCold) and
# infinite-context (its fold overlay) chained as pi 1.4 chains them, in
# extension load order, on the real code of both: upstream's extension (`ic`,
# the package output the module links, unpatched) and cache-lifecycle's shell
# from this repository's sources. The order is the module's (`loadOrder` with
# every component on), not a literal: the overlay refuses a request whose
# projected messages another handler changed (ProjectionMismatchError), so the
# masks must apply to the folded request, after the overlay. Only pi's own
# packages are stand-ins (../infinite-context/stubs).
{
  pkgs,
  hm,
  ic,
  cacheLifecycle,
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
in
  pkgs.runCommand "context-chain" {
    nativeBuildInputs = [pkgs.nodejs];
    LOAD_ORDER = builtins.toJSON order;
  } ''
    export HOME=$TMPDIR/home
    mkdir -p "$HOME"

    mkdir -p work/node_modules/@earendil-works
    cp -r ${ic} work/ic
    cp -r ${cacheLifecycle} work/cache-lifecycle
    cp -r ${../infinite-context/stubs/pi-coding-agent} work/node_modules/@earendil-works/pi-coding-agent
    cp -r ${../infinite-context/stubs/typebox} work/node_modules/typebox
    cp ${./contract.test.ts} work/contract.test.ts
    echo '{"type": "module"}' > work/package.json
    chmod -R u+w work

    cd work
    echo "load order: $LOAD_ORDER"
    node --test --experimental-strip-types contract.test.ts
    touch $out
  ''
