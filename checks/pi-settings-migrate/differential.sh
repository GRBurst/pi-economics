# Part 2: today's ops give the legacy script's bytes (spec §1, §5.4 "Today's
# sequence"). Sourced by ./default.nix with $old, $m, $mi, $corpus, $corpusCount.
n=0
for f in "$corpus"/*.json; do
  name=$(basename "$f")
  for mode in plain idle; do
    cp "$f" old.json
    cp "$f" new.json
    chmod u+w old.json new.json
    if [ "$mode" = idle ]; then
      "$old" old.json idle 2>/dev/null
      "$mi" new.json 2>/dev/null
    else
      "$old" old.json 2>/dev/null
      "$m" new.json 2>/dev/null
    fi
    if ! cmp -s old.json new.json; then
      echo "FAIL corpus $name ($mode): bytes differ from the legacy script's" >&2
      diff old.json new.json >&2 || true
      exit 1
    fi
    n=$((n + 1))
  done
done
[ "$n" -eq $((2 * corpusCount)) ] || {
  echo "FAIL corpus: $n comparisons, expected $((2 * corpusCount))" >&2
  exit 1
}
"$old" none-old.json
"$mi" none-new.json
[ ! -e none-old.json ] && [ ! -e none-new.json ]
echo "part 2: $n comparisons, all equal"
