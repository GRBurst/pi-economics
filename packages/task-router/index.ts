// task-router: routes subagent spawns by task card (spec §5.2).
// Thin shell; all logic lives in ./core/shell.ts.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { guardSingleCopy } from "./core/runtime-guard.ts";
import { loadSettingsReport } from "./core/settings.ts";
import { install, type PiLike } from "./core/shell.ts";

export default function taskRouter(pi: ExtensionAPI): void {
  guardSingleCopy(pi, "task-router", fileURLToPath(import.meta.url), (p) => {
    const agentDir = getAgentDir();
    const { settings, problems } = loadSettingsReport(join(agentDir, "task-router", "settings.json"));
    install(p as unknown as PiLike, { agentDir, settings, problems });
  });
}
