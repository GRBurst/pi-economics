# Part 3: spec §5.4's op table on the path ["a","b","c"] with value 1, and one
# skipped op against an aborted program. Sourced by ./default.nix with $set_,
# $ens, $rem and $mix (removeWhere packages "s" at order 900, then set s1.x,
# ensureContains e1.x, removeWhere r1.x, each with value 1).
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
t "mix applies all" "$mix" '{"packages":["s","k"]}' '{"packages":["k"],"s1":{"x":1},"e1":{"x":[1]}}'
t "mix wrong shapes skip only their op" "$mix" '{"packages":["s"],"s1":"x","e1":"x","r1":"x"}' '{"packages":[],"s1":"x","e1":"x","r1":"x"}'
t "mix set false aborts" "$mix" '{"packages":["s"],"s1":false}' UNTOUCHED
t "mix ensure false aborts" "$mix" '{"packages":["s"],"e1":false}' UNTOUCHED
t "mix remove false aborts" "$mix" '{"packages":["s"],"r1":false}' UNTOUCHED
echo "part 3: op table passed"
