import { z } from "zod";
import { GTFS_SERVICE_DAY_NAMES, GTFS_DERIVATION_METHODS, GTFS_MEDIAN_HEADWAY_BASES,
  GTFS_PARSE_FAILURE_CODES, GTFS_PARSE_WARNING_CODES, type GtfsParseResult } from "./types";

const count = z.number().int().nonnegative().safe();
const identifier = z.string().min(1);
const text = z.string().nullable();
const integer = z.number().int().safe().nullable();
const date = z.iso.date().nullable();
const day = z.enum(GTFS_SERVICE_DAY_NAMES);
const method = z.enum(GTFS_DERIVATION_METHODS);
const duration = z.number().nonnegative().nullable();
const level = z.object({ serviceDay: day, representativeDate: date, tripsPerDay: count.positive(),
  firstDepartureSeconds: count.nullable(), lastDepartureSeconds: count.nullable(), spanSeconds: count.nullable(),
  peakHour: count.max(29).nullable(), peakHourDepartures: count, peakHeadwayMinutes: duration,
  peakHeadwayIsLowerBound: z.boolean(), medianHeadwayMinutes: duration, medianHeadwayBasis: z.enum(GTFS_MEDIAN_HEADWAY_BASES),
  servedHours: count.max(30), spanHours: count.max(30), frequentServiceTierMinutes: duration,
  derivationMethod: method, scheduledTripCount: count, frequencyTripCount: count, departuresBeyondBinRange: count,
});
const feed = z.object({
  filesPresent: z.array(identifier),
  agencies: z.array(z.object({ agencyId: text, name: z.string(), url: text, timezone: text, lang: text, phone: text }).strict()),
  feedInfo: z.object({ publisherName: text, publisherUrl: text, lang: text, startDate: text, endDate: text, version: text }).strict().nullable(),
  routes: z.array(z.object({ routeId: identifier, agencyId: text, shortName: text, longName: text, routeType: integer, color: text, textColor: text }).strict()),
  stops: z.array(z.object({ stopId: identifier, name: text, lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180),
    locationType: integer, parentStation: text, wheelchairBoarding: integer }).strict()),
  serviceWindow: z.object({ startDate: date, endDate: date, source: z.enum(["calendar", "calendar_dates", "both", "none"]) }).strict(),
  serviceDayBases: z.array(z.object({ serviceDay: day, representativeDate: date, serviceIds: z.array(identifier), tripCount: count, candidateDateCount: count }).strict()),
  stopServiceLevels: z.array(level.extend({ stopId: identifier, routeIds: z.array(identifier), routesServing: count }).strict()),
  routeServiceLevels: z.array(level.extend({ routeId: identifier, directionId: integer, stopsServed: count }).strict()),
  derivationMethod: method,
  warnings: z.array(z.object({ code: z.enum(GTFS_PARSE_WARNING_CODES), count, examples: z.array(z.string()) }).strict()),
  stats: z.object({ archiveBytes: count.positive(), bytesDecompressed: count, elapsedMs: z.number().nonnegative(),
    stopTimesRows: count, stopTimesWithoutTime: count, tripRows: count, stopServicePairs: count, routeServicePairs: count,
    scheduledTrips: count, frequencyTrips: count, exactTimesFrequencyTrips: count }).strict(),
}).strict();
const resultSchema: z.ZodType<GtfsParseResult> = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), feed }).strict(),
  z.object({ ok: z.literal(false), code: z.enum(GTFS_PARSE_FAILURE_CODES), detail: z.string().min(1) }).strict(),
]);

function requireMatch(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
function unique(values: string[]) { return new Set(values).size === values.length; }

/** Decode the complete parser protocol before any derived rows are prepared.
 * This verifies custody and internal consistency, not real-world service or
 * scientific accuracy. Feed-specific optional facts remain nullable.
 */
export function decodeGtfsParsedArtifact(raw: unknown, expected: { parsed: boolean; archiveBytes: number }): GtfsParseResult {
  const result = resultSchema.parse(raw);
  requireMatch(result.ok === expected.parsed, "GTFS parsed outcome differs from receipt");
  if (!result.ok) return result;
  const value = result.feed;
  requireMatch(value.stats.archiveBytes === expected.archiveBytes, "GTFS parsed archive size differs");
  requireMatch(unique(value.routes.map(row => row.routeId)) && unique(value.stops.map(row => row.stopId)),
    "GTFS parsed entity identities repeat");
  requireMatch(value.serviceDayBases.length === GTFS_SERVICE_DAY_NAMES.length
    && unique(value.serviceDayBases.map(row => row.serviceDay))
    && value.serviceDayBases.every(row => unique(row.serviceIds)), "GTFS parsed service basis repeats or is incomplete");
  requireMatch(unique(value.routeServiceLevels.map(row => JSON.stringify([row.routeId, row.directionId, row.serviceDay])))
    && unique(value.stopServiceLevels.map(row => JSON.stringify([row.stopId, row.serviceDay]))), "GTFS parsed service identities repeat");
  const dates = new Map(value.serviceDayBases.map(row => [row.serviceDay, row.representativeDate]));
  const routes = new Set(value.routes.map(row => row.routeId)), stops = new Set(value.stops.map(row => row.stopId));
  requireMatch(value.routeServiceLevels.every(row => routes.has(row.routeId))
    && value.stopServiceLevels.every(row => stops.has(row.stopId) && row.routeIds.every(route => routes.has(route))),
    "GTFS parsed service references a missing entity");
  requireMatch(value.stopServiceLevels.every(row => unique(row.routeIds) && row.routesServing === row.routeIds.length),
    "GTFS parsed stop route count differs");
  for (const row of [...value.routeServiceLevels, ...value.stopServiceLevels]) {
    requireMatch(row.representativeDate === dates.get(row.serviceDay), "GTFS parsed service date differs");
    requireMatch(row.scheduledTripCount + row.frequencyTripCount === row.tripsPerDay
      && row.departuresBeyondBinRange <= row.tripsPerDay && row.peakHourDepartures <= row.tripsPerDay,
      "GTFS parsed departure counts differ");
    requireMatch(row.spanSeconds === (row.firstDepartureSeconds === null || row.lastDepartureSeconds === null
      ? null : row.lastDepartureSeconds - row.firstDepartureSeconds) && row.servedHours <= row.spanHours,
      "GTFS parsed service span differs");
  }
  return result;
}
