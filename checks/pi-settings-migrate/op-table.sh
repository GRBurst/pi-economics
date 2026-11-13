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
# lists them): with ops, created as {} with its directory, its mode from the
# umask (as pi writes it), then the ops run; a dangling link stays as it is,
# with a notice; without ops ($none), nothing is created. A link to a file:
# the target is edited in its own directory, the link stays. Whatever cannot
# be created or written: a notice, the file as it was, exit 0 (the activation
# never fails). An op skipped for a wrong shape: a notice.
fail() {
  echo "FAIL $*" >&2
  exit 1
}
run() { # script, file: exit 0, stderr in n.txt
  "$1" "$2" 2>n.txt || fail "$2: exit $?, $(cat n.txt)"
}
notice() { # label, expected stderr
  [ "$(cat n.txt)" = "$2" ] || fail "$1: notice \"$(cat n.txt)\", expected \"$2\""
}
P12='{"a":{"b":{"c":[1,2]}}}'
run "$pre" new/dir/s.json
jq -e --argjson want "$P12" '. == $want' new/dir/s.json >/dev/null || fail "missing file: expected it created with the ops, got $(cat new/dir/s.json 2>&1)"
[ "$(stat -c %a new/dir/s.json)" = 644 ] || fail "missing file: mode $(stat -c %a new/dir/s.json) under umask $(umask), expected 644"
[ "$(ls -A new/dir)" = s.json ] || fail "missing file: left $(ls -A new/dir)"
notice "missing file" "pi-settings-migrate: created new/dir/s.json
pi-settings-migrate: migrated new/dir/s.json"
(umask 077 && run "$pre" new077/s.json)
[ "$(stat -c %a new077/s.json)" = 600 ] || fail "missing file: mode $(stat -c %a new077/s.json) under umask 077, expected 600"
echo "ok missing file created, then the ops"
ln -s nowhere/s.json dangling.json
run "$pre" dangling.json
[ -L dangling.json ] && [ "$(readlink dangling.json)" = nowhere/s.json ] && [ ! -e nowhere ] ||
  fail "dangling link: expected it left as it is"
notice "dangling link" "pi-settings-migrate: dangling.json is a link to a missing file, left as it is"
echo "ok dangling link left, with a notice"
run "$none" absent.json
[ ! -e absent.json ] && [ ! -L absent.json ] || fail "no ops: created absent.json"
echo "ok no ops, no file"

mkdir dots
printf '{"t":1}' >dots/s.json
chmod 640 dots/s.json
ln -s dots/s.json linked.json
run "$pre" linked.json
[ -L linked.json ] && [ "$(readlink linked.json)" = dots/s.json ] || fail "link: replaced by $(ls -l linked.json)"
jq -e --argjson want '{"t":1,"a":{"b":{"c":[1,2]}}}' '. == $want' dots/s.json >/dev/null || fail "link: target $(cat dots/s.json)"
[ "$(stat -c %a dots/s.json)" = 640 ] || fail "link: target mode $(stat -c %a dots/s.json), expected 640"
[ "$(ls -A dots)" = s.json ] || fail "link: left $(ls -A dots)"
echo "ok link to a file: the target edited, the link kept"

mkdir ro rod
printf '{}' >ro/s.json
ln -s ro/s.json rolink.json
chmod 555 ro rod
run "$pre" rolink.json
[ -L rolink.json ] && [ "$(cat ro/s.json)" = '{}' ] || fail "unwritable target directory: changed"
notice "unwritable target directory" "pi-settings-migrate: cannot write in $PWD/ro, $PWD/ro/s.json left as it is"
run "$pre" ro/s.json
[ "$(cat ro/s.json)" = '{}' ] || fail "unwritable directory: changed"
notice "unwritable directory" "pi-settings-migrate: cannot write in ro, ro/s.json left as it is"
run "$pre" rod/s.json
[ ! -e rod/s.json ] || fail "unwritable directory: created rod/s.json"
notice "missing file, unwritable directory" "pi-settings-migrate: cannot write in rod, rod/s.json left missing"
printf x >afile
run "$pre" afile/sub/s.json
notice "missing file under a file" "pi-settings-migrate: cannot create afile/sub, afile/sub/s.json left missing"
ln -s nowhere dpar
run "$pre" dpar/s.json
[ -L dpar ] && [ ! -e nowhere ] || fail "missing file under a dangling link: changed"
notice "missing file under a dangling link" "pi-settings-migrate: cannot create dpar, dpar/s.json left missing"
chmod 755 ro rod
echo "ok what cannot be written: a notice, exit 0"

printf '{"a":{"b":{"c":"s"}}}' >sk.json
run "$pre" sk.json
notice "skipped op" 'pi-settings-migrate: sk.json: skipped ensurePrefix at ["a","b","c"]: a value there or on the way has another type'
printf '{}' >rm.json
run "$rem" rm.json
notice "nothing to remove" ""
echo "ok a skipped op says so, nothing to remove says nothing"

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
