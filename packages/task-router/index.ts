// task-router: routes subagent spawns by task card (spec §5.2).
// Thin shell; all logic lives in ./core/shell.ts.
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadSettingsReport } from "./core/settings.ts";
import { install, type PiLike } from "./core/shell.ts";

export default function taskRouter(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  const { settings, problems } = loadSettingsReport(join(agentDir, "task-router", "settings.json"));
  install(pi as unknown as PiLike, { agentDir, settings, problems });
}
