# Part 1: the host's checks/pi-settings-migrate cases (f6a3c81, lines 19-122),
# sourced by ./default.nix with $m (today's ops without cacheLifecycle) and
# $mi (with it; the host's `idle` flag).
  E='git:github.com/fdietze/pi-claude-auth@main'
  # The child rule the migration ensures, and a settings fragment that has it:
  # the claude-auth cases below are about the package list only.
  RX='{"pattern":"^You were spawned by \"","flags":"m"}'
  HAS='"piRetry":{"subagents":{"match":{"systemPromptRegex":['"$RX"']}}}'

  echo "case stale: removed, others kept in order, other keys kept"
  printf '%s' '{"packages":["a","'"$E"'",{"source":"/x"},"b"],"theme":"t"}' >s.json
  chmod 0640 s.json
  $m s.json
  jq -e '.packages == ["a",{"source":"/x"},"b"] and .theme == "t"' s.json
  [ "$(stat -c %a s.json)" = 640 ]

  echo "case idempotent: a second run is byte-identical"
  cp s.json s1.json
  $m s.json
  cmp s.json s1.json

  echo "case order: never reorders"
  printf '%s' '{"packages":["z","'"$E"'","a"],'"$HAS"'}' >o.json
  $m o.json
  jq -e '.packages == ["z","a"]' o.json

  echo "case clean: untouched byte for byte (odd formatting survives)"
  printf '{ "packages" : ["a"], '"$HAS"' }\n' >c.json
  cp c.json c0.json
  $m c.json
  cmp c.json c0.json

  echo "case other-spellings: only the exact stale entry goes"
  printf '%s' '{"packages":["npm:pi-claude-auth","'"$E"'x"],'"$HAS"'}' >n.json
  cp n.json n0.json
  $m n.json
  cmp n.json n0.json

  echo "case retry-entry: both spellings go, order and lookalikes kept"
  printf '%s' '{"packages":["a","https://github.com/monotykamary/pi-retry",{"source":"/x"},"git:github.com/monotykamary/pi-retry","https://github.com/monotykamary/pi-retry-extra","b"],'"$HAS"'}' >r.json
  $m r.json
  jq -e '.packages == ["a",{"source":"/x"},"https://github.com/monotykamary/pi-retry-extra","b"]' r.json

  echo "case regex: appended once after existing rules, other piRetry keys kept"
  printf '%s' '{"packages":["a"],"piRetry":{"baseDelayMs":2000,"subagents":{"enabled":true,"match":{"systemPromptRegex":[{"pattern":"other"}]}}}}' >x.json
  $m x.json
  jq -e --argjson rx "$RX" '.piRetry.subagents.match.systemPromptRegex == [{"pattern":"other"},$rx]
    and .piRetry.baseDelayMs == 2000 and .piRetry.subagents.enabled == true and .packages == ["a"]' x.json

  echo "case regex-created: missing piRetry is created, no packages key invented"
  printf '%s' '{"theme":"t"}' >y.json
  $m y.json
  jq -e --argjson rx "$RX" '.piRetry.subagents.match.systemPromptRegex == [$rx] and .theme == "t" and (has("packages") | not)' y.json

  echo "case idempotent-regex: a second run after adding the rule is byte-identical"
  cp x.json x1.json
  $m x.json
  cmp x.json x1.json
  cp y.json y1.json
  $m y.json
  cmp y.json y1.json

  echo "case regex-present: a file that has the rule is untouched byte for byte"
  printf '{ "piRetry" : { "subagents": { "match": { "systemPromptRegex": [ {"pattern":"other"}, '"$RX"' ] } } } }\n' >p.json
  cp p.json p0.json
  $m p.json
  cmp p.json p0.json

  echo "case odd-shapes: a piRetry that is not an object, or invalid json, is left alone"
  printf '%s' '{"piRetry":"x","packages":["a"]}' >w.json
  cp w.json w0.json
  $m w.json
  cmp w.json w0.json
  printf '{' >u.json
  cp u.json u0.json
  $m u.json
  cmp u.json u0.json

  echo "case missing: no-op, still missing"
  $m none.json
  [ ! -e none.json ]

  # ops.cacheLifecycle (order 1500) sets cacheWarming = "idle": the warm
  # policy's cache_warming_decision never fires in pi's default "streaming" mode.
  echo "case warming: the idle flag sets cacheWarming"
  printf '%s' '{"theme":"t"}' >w.json
  $mi w.json
  jq -e '.cacheWarming == "idle" and .theme == "t"' w.json

  echo "case warming-overwrite: an explicit streaming becomes idle"
  printf '%s' '{"cacheWarming":"streaming","theme":"t"}' >v.json
  $mi v.json
  jq -e '.cacheWarming == "idle"' v.json

  echo "case warming-idempotent: already idle is untouched byte for byte"
  printf '{ %s, "cacheWarming" : "idle" }\n' "$HAS" >w0.json
  cp w0.json w00.json
  $mi w0.json
  cmp w0.json w00.json

  echo "case warming-off: without the flag, no cacheWarming key is invented"
  printf '%s' '{"theme":"t",%s}' "$HAS" >x2.json
  cp x2.json x20.json
  $m x2.json
  cmp x2.json x20.json
