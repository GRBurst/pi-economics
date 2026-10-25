// Experiment flags (spec §5.6, R10). The settings the experiments factors can switch are read live through
// `flag(name, ownValue)`; everything else is the router's own setting. Booleans are "on" / "off".
import type { RouterSettings } from "./types.ts";

export type Flag = (name: string, own: string) => string;

export function withFlags(settings: RouterSettings, flag: Flag): RouterSettings {
  const on = (name: "routing" | "verifyGate" | "autoEscalate") => ({ enumerable: true, get: () => flag(name, settings[name] ? "on" : "off") !== "off" });
  return Object.defineProperties({ ...settings }, {
    routing: on("routing"),
    verifyGate: on("verifyGate"),
    autoEscalate: on("autoEscalate"),
    freshOnCold: { enumerable: true, get: () => ({ ...settings.freshOnCold, mode: flag("freshOnCold", settings.freshOnCold.mode) }) },
    delegation: { enumerable: true, get: () => ({ ...settings.delegation, rule: flag("delegationRule", settings.delegation.rule) }) },
  });
}
