// token-meter: one JSONL line per provider request (tokens, cost, quota).
// Thin shell; all logic lives in ./core/shell.ts.
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadSettings } from "./core/settings.ts";
import { install, type PiLike } from "./core/shell.ts";

export default function tokenMeter(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  install(pi as unknown as PiLike, {
    agentDir,
    settings: loadSettings(join(agentDir, "token-meter", "settings.json")),
  });
}
