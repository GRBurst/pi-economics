{
  programs.piEconomics = {
    # The patched subagent runner; the router and the meter hook into it.
    actorSubagents.enable = true;
    tokenMeter.enable = true;
    taskRouter = {
      enable = true;
      # Optional: a local model server, with a pi provider named `llama` in
      # your models.json. Without one answering on `health`, the router
      # routes on to the next member.
      settings.models."qwen-local" = {
        model = "llama/qwen3.8";
        health = "http://localhost:11545";
      };
    };
  };
}
