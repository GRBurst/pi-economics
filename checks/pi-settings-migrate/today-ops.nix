# Today's piSettings edits as ops per contributor (spec §5.4): what the host's
# pi-settings-migrate.nix does at f6a3c81. withWarming is with cacheLifecycle
# enabled (the host's `idle` flag). M4 compares ops.cacheLifecycle and M6
# ops.retry with these.
let
  removePackage = value: {
    op = "removeWhere";
    path = ["packages"];
    inherit value;
  };
in rec {
  withoutWarming = {
    # The host's own op: the former seed entry (spec §5.4).
    host = [(removePackage "git:github.com/fdietze/pi-claude-auth@main")];
    retry = [
      (removePackage "https://github.com/monotykamary/pi-retry")
      (removePackage "git:github.com/monotykamary/pi-retry")
      {
        op = "ensureContains";
        path = ["piRetry" "subagents" "match" "systemPromptRegex"];
        value = {
          pattern = ''^You were spawned by "'';
          flags = "m";
        };
      }
    ];
  };
  withWarming =
    withoutWarming
    // {
      cacheLifecycle = [
        {
          op = "set";
          path = ["cacheWarming"];
          value = "idle";
          order = 1500;
        }
      ];
    };
}
