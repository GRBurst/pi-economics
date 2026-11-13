# Part 3: spec §5.4's op table on the path ["a","b","c"] with value 1, and one
# skipped op against an aborted program. Sourced by ./default.nix with $set_,
# $ens, $rem, $pre (ensurePrefix [1,2]), $pre1 (ensurePrefix 1, a one-element
# prefix), $mix (removeWhere packages "s" at order 900, then set s1.x,
# ensureContains e1.x, removeWhere r1.x, each with value 1, and ensurePrefix
# p1.x [1]) and $none (no ops).
t() { # label, script, input, expected JSON or UNTOUCHED
  printf '%s' "$3" >t.json
  cp t.json t0.json
  "$2" t.json 2>/dev/null
  if [ "$4" = UNTOUCHED ]; then
    cmp -s t.json t0.json || { echo "FAIL $1: expected the file untouched, got $(cat t.json)" >&2; exit 1; }
  else
    jq -e --argjson want "$4" '. == $want' t.json >/dev/null || { echo "FAIL $1: expected $4, got $(cat t.json)" >&2; exit 1; }
  fi
  echo "ok $1"
}
C='{"a":{"b":{"c":1}}}'
L='{"a":{"b":{"c":[1]}}}'
t "set missing parents" "$set_" '{}' "$C"
t "set null on the way" "$set_" '{"a":null}' "$C"
t "set null deeper" "$set_" '{"a":{"b":null}}' "$C"
t "set null leaf" "$set_" '{"a":{"b":{"c":null}}}' "$C"
t "set false leaf" "$set_" '{"a":{"b":{"c":false}}}' "$C"
t "set other leaf" "$set_" '{"a":{"b":{"c":"s"}}}' "$C"
t "set equal leaf keeps bytes" "$set_" '{ "a" : { "b" : { "c" : 1 } } }' UNTOUCHED
t "set string on the way" "$set_" '{"a":"s"}' UNTOUCHED
t "set number on the way" "$set_" '{"a":0}' UNTOUCHED
t "set list on the way" "$set_" '{"a":[]}' UNTOUCHED
t "set true on the way" "$set_" '{"a":true}' UNTOUCHED
t "set false on the way" "$set_" '{"a":false}' UNTOUCHED
t "set false deeper" "$set_" '{"a":{"b":false}}' UNTOUCHED
t "ensure missing parents" "$ens" '{}' "$L"
t "ensure null on the way" "$ens" '{"a":null}' "$L"
t "ensure null leaf" "$ens" '{"a":{"b":{"c":null}}}' "$L"
t "ensure false leaf" "$ens" '{"a":{"b":{"c":false}}}' "$L"
t "ensure appends" "$ens" '{"a":{"b":{"c":[2]}}}' '{"a":{"b":{"c":[2,1]}}}'
t "ensure present keeps bytes" "$ens" '{ "a" : { "b" : { "c" : [ 2, 1 ] } } }' UNTOUCHED
t "ensure string leaf" "$ens" '{"a":{"b":{"c":"s"}}}' UNTOUCHED
t "ensure number leaf" "$ens" '{"a":{"b":{"c":1}}}' UNTOUCHED
t "ensure string on the way" "$ens" '{"a":"s"}' UNTOUCHED
t "ensure false on the way" "$ens" '{"a":false}' UNTOUCHED
t "remove all equal, order kept" "$rem" '{"a":{"b":{"c":[2,1,{"k":1},1]}}}' '{"a":{"b":{"c":[2,{"k":1}]}}}'
t "remove absent keeps bytes" "$rem" '{ "a" : { "b" : { "c" : [ 2 ] } } }' UNTOUCHED
t "remove missing parents" "$rem" '{}' UNTOUCHED
t "remove null on the way" "$rem" '{"a":null}' UNTOUCHED
t "remove null leaf" "$rem" '{"a":{"b":{"c":null}}}' UNTOUCHED
t "remove false leaf" "$rem" '{"a":{"b":{"c":false}}}' UNTOUCHED
t "remove string leaf" "$rem" '{"a":{"b":{"c":"s"}}}' UNTOUCHED
t "remove string on the way" "$rem" '{"a":"s"}' UNTOUCHED
t "remove false on the way" "$rem" '{"a":false}' UNTOUCHED
P='{"a":{"b":{"c":[1,2]}}}'
t "prefix missing parents" "$pre" '{}' "$P"
t "prefix null on the way" "$pre" '{"a":null}' "$P"
t "prefix null leaf" "$pre" '{"a":{"b":{"c":null}}}' "$P"
t "prefix false leaf" "$pre" '{"a":{"b":{"c":false}}}' "$P"
t "prefix moves values to the front, others keep order" "$pre" '{"a":{"b":{"c":[3,2,"-builtin:mcp",{"k":1},1]}}}' '{"a":{"b":{"c":[1,2,3,"-builtin:mcp",{"k":1}]}}}'
t "prefix drops values elsewhere" "$pre" '{"a":{"b":{"c":[2,3,2,1,3,1]}}}' '{"a":{"b":{"c":[1,2,3,3]}}}'
t "prefix present keeps bytes" "$pre" '{ "a" : { "b" : { "c" : [ 1, 2, 3 ] } } }' UNTOUCHED
t "prefix one value" "$pre1" '{"a":{"b":{"c":[2,1]}}}' '{"a":{"b":{"c":[1,2]}}}'
t "prefix string leaf" "$pre" '{"a":{"b":{"c":"s"}}}' UNTOUCHED
t "prefix number leaf" "$pre" '{"a":{"b":{"c":1}}}' UNTOUCHED
t "prefix string on the way" "$pre" '{"a":"s"}' UNTOUCHED
t "prefix false on the way" "$pre" '{"a":false}' UNTOUCHED
t "mix applies all" "$mix" '{"packages":["s","k"],"p1":{"x":[2,1]}}' '{"packages":["k"],"s1":{"x":1},"e1":{"x":[1]},"p1":{"x":[1,2]}}'
t "mix wrong shapes skip only their op" "$mix" '{"packages":["s"],"s1":"x","e1":"x","r1":"x","p1":"x"}' '{"packages":[],"s1":"x","e1":"x","r1":"x","p1":"x"}'
t "mix set false aborts" "$mix" '{"packages":["s"],"s1":false}' UNTOUCHED
t "mix ensure false aborts" "$mix" '{"packages":["s"],"e1":false}' UNTOUCHED
t "mix remove false aborts" "$mix" '{"packages":["s"],"r1":false}' UNTOUCHED
t "mix prefix false aborts" "$mix" '{"packages":["s"],"p1":false}' UNTOUCHED

# A missing file (M6: pi does not discover the registry's links, settings.json
# lists them): with ops, created as {} with its directory, mode 644 (as pi
# writes it), then the ops run; a dangling link stays as it is, with a notice;
# without ops ($none), nothing is created.
"$pre" new/dir/s.json 2>/dev/null
jq -e '. == {"a":{"b":{"c":[1,2]}}}' new/dir/s.json >/dev/null || { echo "FAIL missing file: expected it created with the ops, got $(cat new/dir/s.json 2>&1)" >&2; exit 1; }
[ "$(stat -c %a new/dir/s.json)" = 644 ] || { echo "FAIL missing file: mode $(stat -c %a new/dir/s.json), expected 644" >&2; exit 1; }
[ "$(ls -A new/dir)" = s.json ] || { echo "FAIL missing file: left $(ls -A new/dir)" >&2; exit 1; }
echo "ok missing file created, then the ops"
ln -s nowhere/s.json dangling.json
"$pre" dangling.json 2>notice.txt
[ -L dangling.json ] && [ "$(readlink dangling.json)" = nowhere/s.json ] && [ ! -e nowhere ] ||
  { echo "FAIL dangling link: expected it left as it is" >&2; exit 1; }
[ "$(cat notice.txt)" = "pi-settings-migrate: dangling.json is a link to a missing file, left as it is" ] ||
  { echo "FAIL dangling link: notice $(cat notice.txt)" >&2; exit 1; }
echo "ok dangling link left, with a notice"
"$none" absent.json
[ ! -e absent.json ] && [ ! -L absent.json ] || { echo "FAIL no ops: created absent.json" >&2; exit 1; }
echo "ok no ops, no file"

# ensurePrefix's properties, for every list of length 0 to 4 over
# [1, 2, 3, "-builtin:mcp"] with $pre's values [1,2]: the values come first in
# their order; the rest is the input's other elements in their order (so the
# result is a permutation of input and values, values once); a second run
# leaves the file's bytes untouched (idempotent).
jq -nc '[1, 2, 3, "-builtin:mcp"] as $al
  | def seqs($n): if $n == 0 then [] else seqs($n - 1) as $s | $al[] as $x | $s + [$x] end;
  range(0; 5) as $n | seqs($n)' >lists
n=0
while IFS= read -r l; do
  printf '{"a":{"b":{"c":%s}}}' "$l" >p.json
  "$pre" p.json 2>/dev/null
  jq -e --argjson in "$l" --argjson vs '[1,2]' '.a.b.c as $r
    | def other: map(select(. as $x | $vs | any(.[]; . == $x) | not));
    $r[:($vs | length)] == $vs and ($r[($vs | length):] == ($in | other))' p.json >/dev/null ||
    { echo "FAIL prefix property: $l gave $(cat p.json)" >&2; exit 1; }
  cp p.json p0.json
  "$pre" p.json 2>/dev/null
  cmp -s p.json p0.json || { echo "FAIL prefix idempotent: $l gave $(cat p0.json), then $(cat p.json)" >&2; exit 1; }
  n=$((n + 1))
done <lists
[ "$n" = 341 ] || { echo "FAIL prefix property: $n lists, expected 341" >&2; exit 1; }
echo "ok prefix properties over $n lists"
echo "part 3: op table passed"
