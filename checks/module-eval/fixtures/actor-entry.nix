# The actor-subagents registry entry as a consumer's setup adds it: pi-setup's
# programs.pi.actorSubagents, forwarded by its economics bridge
# (router-extraction design §7.3, §8.2). The cases only evaluate, so a fixture
# directory stands in for the patched source.
{
  path = ./ext-a;
  input = "pi-actor-subagents";
  forChildren = false;
  description = "the patched actor-subagents (pi-setup)";
}
