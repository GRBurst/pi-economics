# The cases' vocabulary: each returns a list of failure strings, empty when
# the expectation holds.
{lib}: let
  show = lib.generators.toPretty {multiline = false;};
in {
  eq = what: got: want:
    lib.optional (got != want) "${what}: expected ${show want}, got ${show got}";
  holds = what: cond: lib.optional (!cond) "${what}: does not hold";
  # A throws case carries an `evaluates` control: the same value without the
  # defect, so the case cannot pass on an unrelated evaluation error.
  throws = what: value:
    lib.optional (builtins.tryEval (builtins.deepSeq value true)).success
    "${what}: expected evaluation to fail, it succeeded";
  evaluates = what: value:
    lib.optional (!(builtins.tryEval (builtins.deepSeq value true)).success)
    "${what}: expected evaluation to succeed, it failed";
  # The messages of the failed assertions that start with prefix, sorted.
  failed = prefix: cfg:
    lib.sort lib.lessThan (map (a: a.message)
      (lib.filter (a: !a.assertion && lib.hasPrefix prefix a.message) cfg.assertions));
}
