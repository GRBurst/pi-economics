# Interface comparisons (spec §5.3, §8.1): a consumer keeps its own copy of a
# provider's globalThis API type, and the provider's type must be assignable to
# that copy. Each pair becomes one generated compare.ts next to copies of both
# sources, type-checked by the type check's runner (same flags, same lock).
{
  lib,
  pkgs,
  typecheck,
}: let
  # provider, consumer: { src; file (relative to src); type (an exported type) }.
  # A src must not hold a tsconfig.json (tsc refuses named files next to one).
  source = {
    name,
    provider,
    consumer,
  }:
    pkgs.runCommand "iface-${name}-src" {} ''
      mkdir -p $out
      cp -r ${provider.src} $out/provider
      cp -r ${consumer.src} $out/consumer
      chmod -R u+w $out
      echo '{"type": "module"}' > $out/package.json
      cat > $out/compare.ts <<'TS'
      import type { ${provider.type} as Provider } from "./provider/${provider.file}";
      import type { ${consumer.type} as Consumer } from "./consumer/${consumer.file}";
      declare const provider: Provider;
      // The provider's type is assignable to the consumer's copy.
      export const consumer: Consumer = provider;
      TS
    '';
  fx = ./fixtures;
  fixture = consumer: {
    name = "selftest-${consumer}";
    provider = {
      src = fx + "/provider";
      file = "api.ts";
      type = "Api";
    };
    consumer = {
      src = fx + "/${consumer}";
      file = "index.ts";
      type = "Copy";
    };
  };
in {
  # One comparison: iface.compare { name; provider; consumer; }.
  compare = args:
    typecheck.typecheck {
      name = "iface-${args.name}";
      src = source args;
    };

  # The harness accepts a satisfied copy and rejects an unsatisfied one.
  selftest = pkgs.runCommand "iface-harness" {nativeBuildInputs = [pkgs.gnugrep];} ''
    set -euo pipefail
    tsc=${lib.getExe typecheck.runner}
    $tsc ${source (fixture "consumer-ok")} || { echo "FAIL consumer-ok: rejected" >&2; exit 1; }
    echo "ok consumer-ok accepted"
    st=0
    log=$($tsc ${source (fixture "consumer-bad")} 2>&1) || st=$?
    [ "$st" -ne 0 ] || { echo "FAIL consumer-bad: accepted" >&2; exit 1; }
    grep -qF "error TS2741: Property 'kill' is missing in type 'Api' but required in type 'Copy'" <<<"$log" || {
      echo "FAIL consumer-bad: rejected for another reason:" >&2
      echo "$log" >&2
      exit 1
    }
    echo "ok consumer-bad rejected with TS2741"
    touch $out
  '';
}
