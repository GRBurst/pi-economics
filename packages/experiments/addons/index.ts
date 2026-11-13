// Every add-on the engine registers (redesign §7.4): the levers it knows by id and the data-only lever kinds that
// make a lever of an id by its syntax (`pi.activeTool(<name>)`, `session-entry(<customType>,<field>)`). One place to add an
// add-on; addons/catalogue.json lists the ids the Nix module accepts (the bench's process levers `pi.compaction.*` are
// registered here but are not online levers: they stay out of it), and test/catalogue.test.ts holds the two equal.
import { CACHE_LIFECYCLE } from "./cache-lifecycle.ts";
import { infiniteContext, type IcRules } from "./infinite-context.ts";
import { piAddons, type PiControl } from "./pi.ts";
import { piProcessLevers, type SettingsReader } from "./pi-process.ts";
import { sessionEntryKind, type Appender } from "./session-entry.ts";
import type { Kind, Lever } from "./types.ts";

/** What the shell hands the add-ons that read the host: infinite-context's rules and pi's settings files. */
export type AddonDeps = { icRules: () => IcRules; settings: SettingsReader };

export function allAddons(pi: PiControl & Appender, deps: AddonDeps): { levers: readonly Lever[]; kinds: readonly Kind[] } {
  const p = piAddons(pi);
  return {
    levers: [...CACHE_LIFECYCLE, ...p.levers, ...infiniteContext(deps.icRules), ...piProcessLevers(deps.settings)],
    kinds: [...p.kinds, sessionEntryKind(pi)],
  };
}
