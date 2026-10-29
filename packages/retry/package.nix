# pi-retry with one local patch (spec §2):
#
# - free-cap: a 429 for OpenRouter's daily free-tier cap is not retried; it
#   lasts until 00:00 UTC, so retrying only burns the retry budget. Offer it
#   upstream.
#
# Print and json sessions need no patch: upstream 0.11.0 retries them inline
# (prompt-scoped sessions); checks/retry pins that route.
#
# The whole repository, not a subdirectory: pi finds the entry point
# (retry.ts) through package.json `pi.extensions`. The patch file keeps the
# host's name, so the store path, and with the same nixpkgs the derivation,
# are the host's. A patch that no longer applies fails this build;
# checks/retry runs the upstream vitest suite on it.
{
  applyPatches,
  src,
}:
applyPatches {
  name = "pi-retry-patched";
  inherit src;
  patches = [
    ../../patches/pi-retry/pi-retry-free-cap.patch
  ];
}
