// The internal channel (redesign §7.7, M5b.2): the engine's side (experiments) against its readers' copies. A line
// fails to type-check when a copy no longer matches what the engine sends or names.
import { LEVERS as ENGINE_LEVERS, LEVERS_QUERY as ENGINE_QUERY, type Levers as Engine, type LeversQuery as EngineQuery } from "./experiments/core/channel.ts";
import type { LeverState as EngineState } from "./experiments/addons/types.ts";
import { LEVERS as METER_LEVERS, LEVERS_QUERY as METER_QUERY, type Levers as Meter, type LeversQuery as MeterQuery } from "./token-meter/core/channel.ts";
import type { LeverState as MeterState } from "./token-meter/core/levers.ts";
import { LEVERS as CACHE_LEVERS, LEVERS_QUERY as CACHE_QUERY, type Levers as Cache, type LeversQuery as CacheQuery } from "./cache-lifecycle/core/api.ts";

declare const engine: Engine;
// What the engine publishes and answers is what each reader reads.
export const meter: Meter = engine;
export const cache: Cache = engine;
// Every key a reader reads is one the engine sends (a dropped optional key would still assign above).
type Unsent<View> = Exclude<keyof View, keyof Engine>;
export const meterKeysSent: [Unsent<Meter>] extends [never] ? true : false = true;
export const cacheKeysSent: [Unsent<Cache>] extends [never] ? true : false = true;
// A lever state has one shape on both sides (design §5.3): the engine's read-back and the meter's writer.
declare const engineState: EngineState;
declare const meterState: MeterState;
export const stateToMeter: MeterState = engineState;
export const stateToEngine: EngineState = meterState;
// A reader's query is one the engine serves.
declare const meterQuery: MeterQuery;
declare const cacheQuery: CacheQuery;
export const meterAsks: EngineQuery = meterQuery;
export const cacheAsks: EngineQuery = cacheQuery;
// The channel names are the engine's.
export const meterNames: [typeof ENGINE_LEVERS, typeof ENGINE_QUERY] = [METER_LEVERS, METER_QUERY];
export const cacheNames: [typeof ENGINE_LEVERS, typeof ENGINE_QUERY] = [CACHE_LEVERS, CACHE_QUERY];
export const engineNames: [typeof METER_LEVERS, typeof METER_QUERY, typeof CACHE_LEVERS, typeof CACHE_QUERY] = [ENGINE_LEVERS, ENGINE_QUERY, ENGINE_LEVERS, ENGINE_QUERY];
