import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parseGtfsFeed } from "@/lib/gtfs/parse";
import { selectGtfsCaveats } from "@/lib/gtfs/caveats";
import { groupServiceDays } from "@/lib/gtfs/service-day-groups";

/**
 * A FEED IS NOT READY BECAUSE IT PARSED. It is ready because service came out
 * the other end.
 *
 * THE DEFECT CLASS THIS GUARDS. `gtfs_feeds.status` is unconstrained TEXT with
 * a default, and the honest-looking mistake is to set it to 'ready' as soon as
 * the archive opened and the required files were present. An archive whose
 * `stop_times.txt` is a header row and nothing else satisfies every one of
 * those checks: it is a valid zip, it has all six required files, its stops
 * have coordinates, its routes have ids, its calendar has services. It contains
 * no transit service whatsoever.
 *
 * A feed marked ready in that state is the shipped-invisible defect class in its
 * purest form — a planner opens the transit panel, sees a loaded feed with an
 * agency name and a stop count, and finds every frequency blank. Nothing tells
 * them the ingest was empty, because from the ingest's point of view it
 * succeeded.
 *
 * So this file drives the WHOLE library, on a REAL zip built in memory, and
 * asserts both halves: a feed with service produces derived counts a person can
 * check by hand, and a feed with no service is REFUSED under a named code
 * rather than returned as an empty success.
 */

const HOUR = 3600;

/**
 * A two-route, six-stop agency, written out in full so every asserted number
 * below can be counted off the fixture by eye.
 *
 * Route 1 (Red), direction 0, runs S1 -> S2 -> S3 four times on a weekday:
 * 07:00, 07:15, 07:30, 08:00 — three in the 07:00 hour, one in the 08:00 hour.
 * Route 2 (Blue), direction 0, runs S4 -> S5 -> S6 twice: 09:00 and 17:00.
 * Saturday has one Red trip, at 10:00. Sunday has none at all.
 */
function twoRouteFeed(): Record<string, string> {
  return {
    "agency.txt":
      "agency_id,agency_name,agency_url,agency_timezone\n" +
      "AG1,Example Regional Transit,https://example.org,America/Denver\n",

    "stops.txt":
      "stop_id,stop_name,stop_lat,stop_lon\n" +
      "S1,North Terminal,44.0,-104.0\n" +
      "S2,Main and First,44.01,-104.01\n" +
      "S3,South Terminal,44.02,-104.02\n" +
      "S4,West Gate,44.03,-104.03\n" +
      "S5,Civic Center,44.04,-104.04\n" +
      "S6,East Yard,44.05,-104.05\n",

    "routes.txt":
      "route_id,route_short_name,route_long_name,route_type\n" +
      "RED,1,Red Line,3\n" +
      "BLUE,2,Blue Line,3\n",

    "calendar.txt":
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
      "WEEKDAY,1,1,1,1,1,0,0,20260803,20260828\n" +
      "SATURDAY,0,0,0,0,0,1,0,20260803,20260828\n",

    "trips.txt":
      "trip_id,route_id,service_id,direction_id\n" +
      "R1,RED,WEEKDAY,0\n" +
      "R2,RED,WEEKDAY,0\n" +
      "R3,RED,WEEKDAY,0\n" +
      "R4,RED,WEEKDAY,0\n" +
      "B1,BLUE,WEEKDAY,0\n" +
      "B2,BLUE,WEEKDAY,0\n" +
      "RS1,RED,SATURDAY,0\n",

    "stop_times.txt":
      "trip_id,stop_id,arrival_time,departure_time,stop_sequence\n" +
      "R1,S1,07:00:00,07:00:00,1\nR1,S2,07:05:00,07:05:00,2\nR1,S3,07:12:00,07:12:00,3\n" +
      "R2,S1,07:15:00,07:15:00,1\nR2,S2,07:20:00,07:20:00,2\nR2,S3,07:27:00,07:27:00,3\n" +
      "R3,S1,07:30:00,07:30:00,1\nR3,S2,07:35:00,07:35:00,2\nR3,S3,07:42:00,07:42:00,3\n" +
      "R4,S1,08:00:00,08:00:00,1\nR4,S2,08:05:00,08:05:00,2\nR4,S3,08:12:00,08:12:00,3\n" +
      "B1,S4,09:00:00,09:00:00,1\nB1,S5,09:10:00,09:10:00,2\nB1,S6,09:20:00,09:20:00,3\n" +
      "B2,S4,17:00:00,17:00:00,1\nB2,S5,17:10:00,17:10:00,2\nB2,S6,17:20:00,17:20:00,3\n" +
      "RS1,S1,10:00:00,10:00:00,1\nRS1,S2,10:05:00,10:05:00,2\nRS1,S3,10:12:00,10:12:00,3\n",
  };
}

async function zipOf(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: "uint8array" });
}

describe("a real archive, driven end to end", () => {
  it("derives counts that can be checked against the fixture by hand", async () => {
    const result = await parseGtfsFeed(await zipOf(twoRouteFeed()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const feed = result.feed;

    expect(feed.agencies.map((agency) => agency.name)).toEqual(["Example Regional Transit"]);
    expect(feed.routes.map((route) => route.routeId).sort()).toEqual(["BLUE", "RED"]);
    expect(feed.stops).toHaveLength(6);
    expect(feed.warnings).toEqual([]);

    /* ---- the north terminal, weekday: four Red trips ---- */
    const northWeekday = feed.stopServiceLevels.find(
      (row) => row.stopId === "S1" && row.serviceDay === "wednesday",
    )!;
    expect(northWeekday.tripsPerDay).toBe(4);
    expect(northWeekday.firstDepartureSeconds).toBe(7 * HOUR);
    expect(northWeekday.lastDepartureSeconds).toBe(8 * HOUR);
    expect(northWeekday.spanSeconds).toBe(HOUR);
    // Three departures in the 07:00 hour, one in the 08:00 hour.
    expect(northWeekday.peakHour).toBe(7);
    expect(northWeekday.peakHourDepartures).toBe(3);
    expect(northWeekday.peakHeadwayMinutes).toBe(20);
    expect(northWeekday.peakHeadwayIsLowerBound).toBe(false);
    expect(northWeekday.frequentServiceTierMinutes).toBe(30);
    expect(northWeekday.derivationMethod).toBe("scheduled");
    expect(northWeekday.representativeDate).toBe("2026-08-05");

    /* ---- the middle stop is five minutes down the line ---- */
    const middleWeekday = feed.stopServiceLevels.find(
      (row) => row.stopId === "S2" && row.serviceDay === "wednesday",
    )!;
    expect(middleWeekday.tripsPerDay).toBe(4);
    expect(middleWeekday.firstDepartureSeconds).toBe(7 * HOUR + 300);
    expect(middleWeekday.lastDepartureSeconds).toBe(8 * HOUR + 300);

    /* ---- the Blue line: two trips twelve hours apart ---- */
    const westWeekday = feed.stopServiceLevels.find(
      (row) => row.stopId === "S4" && row.serviceDay === "wednesday",
    )!;
    expect(westWeekday.tripsPerDay).toBe(2);
    expect(westWeekday.firstDepartureSeconds).toBe(9 * HOUR);
    expect(westWeekday.lastDepartureSeconds).toBe(17 * HOUR);
    expect(westWeekday.peakHourDepartures).toBe(1);
    // 60 minutes is a LOWER BOUND here, not an estimate — one bus in the hour.
    expect(westWeekday.peakHeadwayIsLowerBound).toBe(true);
    expect(westWeekday.frequentServiceTierMinutes).toBeNull();
    // Two served hours out of a nine-hour span: no honest median exists.
    expect(westWeekday.medianHeadwayMinutes).toBeNull();
    expect(westWeekday.medianHeadwayBasis).toBe("not_determined_span_mostly_unserved");

    /* ---- routes, counted once per trip ---- */
    const redWeekday = feed.routeServiceLevels.find(
      (row) => row.routeId === "RED" && row.serviceDay === "wednesday",
    )!;
    expect(redWeekday.tripsPerDay).toBe(4);
    expect(redWeekday.directionId).toBe(0);
    const blueWeekday = feed.routeServiceLevels.find(
      (row) => row.routeId === "BLUE" && row.serviceDay === "wednesday",
    )!;
    expect(blueWeekday.tripsPerDay).toBe(2);

    /* ---- which routes serve which stops, and how many stops each route has ---- */
    // S1-S3 are Red only; S4-S6 are Blue only. A count alone could not tell a
    // transfer point from a corridor, so the route ids themselves are carried.
    expect(northWeekday.routeIds).toEqual(["RED"]);
    expect(northWeekday.routesServing).toBe(1);
    expect(westWeekday.routeIds).toEqual(["BLUE"]);
    expect(redWeekday.stopsServed).toBe(3);
    expect(blueWeekday.stopsServed).toBe(3);

    /* ---- Saturday has one Red trip; Sunday has no rows at all ---- */
    const northSaturday = feed.stopServiceLevels.find(
      (row) => row.stopId === "S1" && row.serviceDay === "saturday",
    )!;
    expect(northSaturday.tripsPerDay).toBe(1);
    expect(northSaturday.firstDepartureSeconds).toBe(10 * HOUR);
    expect(feed.stopServiceLevels.some((row) => row.stopId === "S4" && row.serviceDay === "saturday")).toBe(
      false,
    );
    expect(feed.stopServiceLevels.some((row) => row.serviceDay === "sunday")).toBe(false);
    expect(
      feed.serviceDayBases.find((basis) => basis.serviceDay === "sunday")!.representativeDate,
    ).toBeNull();

    /* ---- the rollup a planner actually reads ---- */
    const northRows = feed.stopServiceLevels.filter((row) => row.stopId === "S1");
    const [weekday, saturday, sunday] = groupServiceDays(northRows);
    expect(weekday.tripsPerDay).toBe(4);
    expect(weekday.daysPresent).toHaveLength(5);
    expect(weekday.varies).toBe(false);
    expect(saturday.tripsPerDay).toBe(1);
    expect(sunday.tripsPerDay).toBeNull();

    /* ---- and the caveats that must travel with all of it ---- */
    const caveats = selectGtfsCaveats({
      usesFrequencies: feed.stats.frequencyTrips > 0,
      stopTimesWithoutTime: feed.stats.stopTimesWithoutTime,
      departuresBeyondBinRange: 0,
      danglingReferences: 0,
      showsFrequentServiceTier: true,
    });
    expect(caveats.some((text) => text.includes("not a timetable"))).toBe(true);
    expect(caveats.some((text) => text.includes("hourly averages"))).toBe(true);
  });

  it("keeps memory proportional to stops and services, not to stop_times rows", async () => {
    const feedFiles = twoRouteFeed();
    const result = await parseGtfsFeed(await zipOf(feedFiles));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Six stops, two services, but only the combinations that saw a departure:
    // S1-S3 on both WEEKDAY and SATURDAY (6) plus S4-S6 on WEEKDAY (3).
    expect(result.feed.stats.stopServicePairs).toBe(9);
    expect(result.feed.stats.stopTimesRows).toBe(21);
  });
});

describe("a feed with nothing in it is refused, not marked ready", () => {
  it("REFUSES no_usable_service when stop_times.txt is a header row and nothing else", async () => {
    const files = twoRouteFeed();
    files["stop_times.txt"] = "trip_id,stop_id,arrival_time,departure_time,stop_sequence\n";

    const result = await parseGtfsFeed(await zipOf(files));

    // Everything a naive readiness check looks at is still true: a valid zip,
    // every required file present, stops with real coordinates, routes with
    // ids, a calendar with two services, seven trips. None of that is service.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("no_usable_service");
    expect(result.detail.length).toBeGreaterThan(0);
  });

  it("refuses rather than returning a feed with empty service arrays", async () => {
    const files = twoRouteFeed();
    files["stop_times.txt"] = "trip_id,stop_id,arrival_time,departure_time,stop_sequence\n";
    const result = await parseGtfsFeed(await zipOf(files));

    // The shape of the refusal matters as much as the code: there must be no
    // `feed` to read at all, so no caller can persist an empty one by accident.
    expect("feed" in result).toBe(false);
  });

  it("refuses when every trip runs on a service no calendar describes", async () => {
    const files = twoRouteFeed();
    files["calendar.txt"] =
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
      "SOMETHING_ELSE,1,1,1,1,1,0,0,20260803,20260828\n";
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("no_usable_service");
  });

  it("refuses when the calendar runs no service on any day", async () => {
    const files = twoRouteFeed();
    files["calendar.txt"] =
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
      "WEEKDAY,0,0,0,0,0,0,0,20260803,20260828\n" +
      "SATURDAY,0,0,0,0,0,0,0,20260803,20260828\n";
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("no_usable_service");
  });

  it("still succeeds when service exists on ONE day only", async () => {
    // The boundary: a Saturday-only shuttle is a real agency, not an empty feed.
    const files = twoRouteFeed();
    files["calendar.txt"] =
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
      "WEEKDAY,0,0,0,0,0,0,0,20260803,20260828\n" +
      "SATURDAY,0,0,0,0,0,1,0,20260803,20260828\n";
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.feed.stopServiceLevels).toHaveLength(3);
    expect(result.feed.stopServiceLevels.every((row) => row.serviceDay === "saturday")).toBe(true);
  });
});
