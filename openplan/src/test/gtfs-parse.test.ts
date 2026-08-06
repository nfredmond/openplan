import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { GTFS_REQUIRED_FILES, parseGtfsFeed } from "@/lib/gtfs/parse";
import { resolveGtfsLimits } from "@/lib/gtfs/limits";
import { GTFS_PARSE_FAILURE_CODES, type GtfsParseWarningCode } from "@/lib/gtfs/types";

/**
 * The orchestrator, driven with real zips built in memory.
 *
 * TWO RULES EVERY CASE HERE EXISTS TO HOLD:
 *   - A feed problem is a RESULT, never an exception. A planner gets a sentence
 *     they can act on, not a 500.
 *   - A bad ROW never kills a FEED. Published feeds carry dangling references,
 *     blank times and duplicate ids; they are counted and the feed still parses.
 */

const HOUR = 3600;

/** A feed that parses, which each test then breaks in exactly one way. */
function baseFeed(): Record<string, string> {
  return {
    "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\nAG,Test Transit,https://example.org,America/Los_Angeles\n",
    "stops.txt":
      "stop_id,stop_name,stop_lat,stop_lon\n" +
      "S1,First,40.0,-100.0\n" +
      "S2,Second,40.1,-100.1\n",
    "routes.txt": "route_id,route_short_name,route_type\nR1,1,3\n",
    "trips.txt": "trip_id,route_id,service_id,direction_id\nT1,R1,WK,0\nT2,R1,WK,0\n",
    "calendar.txt":
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
      "WK,1,1,1,1,1,0,0,20260803,20260828\n",
    "stop_times.txt":
      "trip_id,stop_id,arrival_time,departure_time,stop_sequence\n" +
      "T1,S1,08:00:00,08:00:00,1\n" +
      "T1,S2,08:10:00,08:10:00,2\n" +
      "T2,S1,08:30:00,08:30:00,1\n" +
      "T2,S2,08:40:00,08:40:00,2\n",
  };
}

async function zipOf(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: "uint8array" });
}

function warningCount(
  warnings: { code: GtfsParseWarningCode; count: number }[],
  code: GtfsParseWarningCode,
): number {
  return warnings.find((warning) => warning.code === code)?.count ?? 0;
}

describe("a feed that is fine parses", () => {
  it("derives service levels for the days its calendar covers", async () => {
    const result = await parseGtfsFeed(await zipOf(baseFeed()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.feed.agencies).toEqual([
      {
        agencyId: "AG",
        name: "Test Transit",
        url: "https://example.org",
        timezone: "America/Los_Angeles",
        lang: null,
        phone: null,
      },
    ]);
    expect(result.feed.stops).toHaveLength(2);
    expect(result.feed.serviceWindow).toEqual({
      startDate: "2026-08-03",
      endDate: "2026-08-28",
      source: "calendar",
    });

    const mondayAtFirst = result.feed.stopServiceLevels.find(
      (row) => row.stopId === "S1" && row.serviceDay === "monday",
    );
    expect(mondayAtFirst).toBeDefined();
    expect(mondayAtFirst!.tripsPerDay).toBe(2);
    expect(mondayAtFirst!.firstDepartureSeconds).toBe(8 * HOUR);
    expect(mondayAtFirst!.lastDepartureSeconds).toBe(8 * HOUR + 1800);
    expect(mondayAtFirst!.derivationMethod).toBe("scheduled");

    // Saturday and Sunday are not in the calendar, so there is no row at all —
    // not a row of zeroes claiming the stop sits unserved.
    expect(result.feed.stopServiceLevels.some((row) => row.serviceDay === "saturday")).toBe(false);
    expect(result.feed.warnings).toEqual([]);
  });

  it("counts a route ONCE PER TRIP, not once per stop_times row", async () => {
    // Two trips over two stops = four stop_times rows. A route counted per row
    // would report four departures and halve every headway on the route.
    const result = await parseGtfsFeed(await zipOf(baseFeed()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const monday = result.feed.routeServiceLevels.find(
      (row) => row.routeId === "R1" && row.serviceDay === "monday",
    );
    expect(monday).toBeDefined();
    expect(monday!.tripsPerDay).toBe(2);
    expect(monday!.directionId).toBe(0);
    // Counted at the trip's FIRST stop, so 08:00 and 08:30, not 08:10/08:40.
    expect(monday!.firstDepartureSeconds).toBe(8 * HOUR);
    expect(monday!.lastDepartureSeconds).toBe(8 * HOUR + 1800);
  });

  it("keeps the two directions of a route apart, so a headway is not halved", async () => {
    const files = baseFeed();
    files["trips.txt"] =
      "trip_id,route_id,service_id,direction_id\n" +
      "T1,R1,WK,0\nT2,R1,WK,0\nT3,R1,WK,1\nT4,R1,WK,1\n";
    files["stop_times.txt"] =
      "trip_id,stop_id,arrival_time,departure_time,stop_sequence\n" +
      "T1,S1,08:00:00,08:00:00,1\nT1,S2,08:10:00,08:10:00,2\n" +
      "T2,S1,08:30:00,08:30:00,1\nT2,S2,08:40:00,08:40:00,2\n" +
      "T3,S2,08:15:00,08:15:00,1\nT3,S1,08:25:00,08:25:00,2\n" +
      "T4,S2,08:45:00,08:45:00,1\nT4,S1,08:55:00,08:55:00,2\n";
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const monday = result.feed.routeServiceLevels.filter(
      (row) => row.routeId === "R1" && row.serviceDay === "monday",
    );
    expect(monday.map((row) => row.directionId).sort()).toEqual([0, 1]);
    // Each direction has two trips in the 08:00 hour -> 30-minute headway.
    // Combined they would be four -> a fictitious 15.
    for (const row of monday) {
      expect(row.tripsPerDay).toBe(2);
      expect(row.peakHeadwayMinutes).toBe(30);
    }
  });

  it("names the date each day's counts describe, and picks the busiest one", async () => {
    // Two services: one runs the whole window, a second is added on ONE Tuesday.
    // That Tuesday is busier and must be the one reported.
    const files = baseFeed();
    files["calendar.txt"] =
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
      "WK,1,1,1,1,1,0,0,20260803,20260828\n" +
      "EX,0,0,0,0,0,0,0,20260803,20260828\n";
    files["calendar_dates.txt"] = "service_id,date,exception_type\nEX,20260811,1\n";
    files["trips.txt"] =
      "trip_id,route_id,service_id,direction_id\nT1,R1,WK,0\nT2,R1,WK,0\nT3,R1,EX,0\n";
    files["stop_times.txt"] =
      "trip_id,stop_id,arrival_time,departure_time,stop_sequence\n" +
      "T1,S1,08:00:00,08:00:00,1\nT1,S2,08:10:00,08:10:00,2\n" +
      "T2,S1,08:30:00,08:30:00,1\nT2,S2,08:40:00,08:40:00,2\n" +
      "T3,S1,09:00:00,09:00:00,1\nT3,S2,09:10:00,09:10:00,2\n";

    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tuesday = result.feed.serviceDayBases.find((basis) => basis.serviceDay === "tuesday");
    expect(tuesday!.representativeDate).toBe("2026-08-11");
    expect(tuesday!.serviceIds).toEqual(["EX", "WK"]);

    // Monday is an ordinary Monday and reports the base service only.
    const monday = result.feed.serviceDayBases.find((basis) => basis.serviceDay === "monday");
    expect(monday!.serviceIds).toEqual(["WK"]);

    const tuesdayAtFirst = result.feed.stopServiceLevels.find(
      (row) => row.stopId === "S1" && row.serviceDay === "tuesday",
    );
    expect(tuesdayAtFirst!.tripsPerDay).toBe(3);
    expect(tuesdayAtFirst!.representativeDate).toBe("2026-08-11");
    const mondayAtFirst = result.feed.stopServiceLevels.find(
      (row) => row.stopId === "S1" && row.serviceDay === "monday",
    );
    expect(mondayAtFirst!.tripsPerDay).toBe(2);
  });

  it("honours a service REMOVED on a date rather than counting it anyway", async () => {
    const files = baseFeed();
    // Remove Monday service on every Monday in the window except the last.
    files["calendar_dates.txt"] =
      "service_id,date,exception_type\nWK,20260803,2\nWK,20260810,2\nWK,20260817,2\n";
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const monday = result.feed.serviceDayBases.find((basis) => basis.serviceDay === "monday");
    expect(monday!.representativeDate).toBe("2026-08-24");
    expect(result.feed.serviceWindow.source).toBe("both");
  });

  it("reads a feed that publishes ONLY calendar_dates.txt", async () => {
    // 2 of 16 sampled live US feeds do exactly this. calendar_dates is a
    // first-class source, never a fallback.
    const files = baseFeed();
    delete files["calendar.txt"];
    files["calendar_dates.txt"] = "service_id,date,exception_type\nWK,20260805,1\nWK,20260812,1\n";

    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.feed.serviceWindow).toEqual({
      startDate: "2026-08-05",
      endDate: "2026-08-12",
      source: "calendar_dates",
    });
    const wednesday = result.feed.stopServiceLevels.find(
      (row) => row.stopId === "S1" && row.serviceDay === "wednesday",
    );
    expect(wednesday).toBeDefined();
    expect(wednesday!.tripsPerDay).toBe(2);
    expect(wednesday!.representativeDate).toBe("2026-08-05");
  });

  it("preserves a departure past midnight all the way to the derived row", async () => {
    const files = baseFeed();
    files["stop_times.txt"] =
      "trip_id,stop_id,arrival_time,departure_time,stop_sequence\n" +
      "T1,S1,05:05:00,05:05:00,1\nT1,S2,05:15:00,05:15:00,2\n" +
      "T2,S1,25:10:00,25:10:00,1\nT2,S2,25:20:00,25:20:00,2\n";
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = result.feed.stopServiceLevels.find(
      (item) => item.stopId === "S1" && item.serviceDay === "monday",
    );
    expect(row!.lastDepartureSeconds).toBe(25 * HOUR + 600);
    expect(row!.spanSeconds).toBe(20 * HOUR + 300);
    expect(row!.departuresBeyondBinRange).toBe(0);
  });
});

describe("a bad row is counted; it never kills the feed", () => {
  it("counts a dangling stop reference and still credits the ROUTE", async () => {
    // gtfs_skim.py calls this "the ordinary case, not a pathological one".
    const files = baseFeed();
    files["stop_times.txt"] =
      "trip_id,stop_id,arrival_time,departure_time,stop_sequence\n" +
      "T1,S1,08:00:00,08:00:00,1\nT1,GHOST,08:05:00,08:05:00,2\nT1,S2,08:10:00,08:10:00,3\n" +
      "T2,GHOST,08:30:00,08:30:00,1\nT2,S2,08:40:00,08:40:00,2\n";

    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(warningCount(result.feed.warnings, "dangling_stop_reference")).toBe(2);
    // No stop row exists for the stop nobody can locate.
    expect(result.feed.stopServiceLevels.some((row) => row.stopId === "GHOST")).toBe(false);
    // But T2's 08:30 departure — which happens to start at the ghost stop — is
    // still real service on route R1, and is counted there.
    const route = result.feed.routeServiceLevels.find(
      (row) => row.routeId === "R1" && row.serviceDay === "monday",
    );
    expect(route!.tripsPerDay).toBe(2);
    expect(route!.lastDepartureSeconds).toBe(8 * HOUR + 1800);
  });

  it("counts a stop_times row naming a trip that does not exist", async () => {
    const files = baseFeed();
    files["stop_times.txt"] += "T99,S1,09:00:00,09:00:00,1\n";
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(warningCount(result.feed.warnings, "dangling_trip_reference")).toBe(1);
  });

  it("counts a trip whose service_id neither calendar file defines", async () => {
    const files = baseFeed();
    files["trips.txt"] += "T3,R1,PHANTOM,0\n";
    files["stop_times.txt"] += "T3,S1,10:00:00,10:00:00,1\n";
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(warningCount(result.feed.warnings, "dangling_service_reference")).toBe(1);
    // The trip runs on no day anyone can name, so it appears in no day's counts.
    const monday = result.feed.stopServiceLevels.find(
      (row) => row.stopId === "S1" && row.serviceDay === "monday",
    );
    expect(monday!.tripsPerDay).toBe(2);
  });

  it("counts a malformed time but does not count a BLANK one as malformed", async () => {
    const files = baseFeed();
    files["stop_times.txt"] =
      "trip_id,stop_id,arrival_time,departure_time,stop_sequence\n" +
      "T1,S1,08:00:00,08:00:00,1\n" +
      "T1,S2,,,2\n" + // legal GTFS: a non-timepoint stop
      "T2,S1,08:30:00,08:30:00,1\n" +
      "T2,S2,99:99:99,99:99:99,2\n"; // genuinely unreadable

    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(warningCount(result.feed.warnings, "bad_time_value")).toBe(1);
    expect(result.feed.stats.stopTimesWithoutTime).toBe(1);
  });

  it("counts a duplicate key and lets the last row win", async () => {
    const files = baseFeed();
    files["stops.txt"] += "S1,First (renamed),41.0,-101.0\n";
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(warningCount(result.feed.warnings, "duplicate_key")).toBe(1);
    expect(result.feed.stops.find((stop) => stop.stopId === "S1")!.name).toBe("First (renamed)");
    expect(result.feed.stops).toHaveLength(2);
  });

  it("drops a stop with no usable coordinates and reports references to it as dangling", async () => {
    const files = baseFeed();
    files["stops.txt"] = "stop_id,stop_name,stop_lat,stop_lon\nS1,First,40.0,-100.0\nS2,Second,,\n";
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.feed.stops.map((stop) => stop.stopId)).toEqual(["S1"]);
    expect(warningCount(result.feed.warnings, "bad_csv_row")).toBe(1);
    expect(warningCount(result.feed.warnings, "dangling_stop_reference")).toBe(2);
  });

  it("bounds the examples it keeps while leaving the COUNT exact", async () => {
    const files = baseFeed();
    const rows = Array.from({ length: 200 }, (_, i) => `T1,GHOST${i},09:00:00,09:00:00,${i + 10}`);
    files["stop_times.txt"] += `${rows.join("\n")}\n`;
    const limits = { ...resolveGtfsLimits({}), maxWarningExamples: 20, maxWarningExampleChars: 40 };

    const result = await parseGtfsFeed(await zipOf(files), { limits });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warning = result.feed.warnings.find((item) => item.code === "dangling_stop_reference");
    expect(warning!.count).toBe(200);
    expect(warning!.examples).toHaveLength(20);
    for (const example of warning!.examples) expect(example.length).toBeLessThanOrEqual(41);
  });
});

describe("frequencies.txt is handled per TRIP, never per feed", () => {
  const frequencyFeed = () => {
    const files = baseFeed();
    files["trips.txt"] = "trip_id,route_id,service_id,direction_id\nT1,R1,WK,0\nT2,R1,WK,0\nT3,R1,WK,0\n";
    files["stop_times.txt"] =
      "trip_id,stop_id,arrival_time,departure_time,stop_sequence\n" +
      "T1,S1,08:00:00,08:00:00,1\nT1,S2,08:10:00,08:10:00,2\n" +
      "T2,S1,08:30:00,08:30:00,1\nT2,S2,08:40:00,08:40:00,2\n" +
      // T3 is the frequency-based trip. Its stop_times are a TEMPLATE: the
      // times are offsets, not departures.
      "T3,S1,12:00:00,12:00:00,1\nT3,S2,12:07:00,12:07:00,2\n";
    files["frequencies.txt"] = "trip_id,start_time,end_time,headway_secs\nT3,13:00:00,14:00:00,900\n";
    return files;
  };

  it("expands a frequency window into departures and leaves the other trips alone", async () => {
    const result = await parseGtfsFeed(await zipOf(frequencyFeed()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const first = result.feed.stopServiceLevels.find(
      (row) => row.stopId === "S1" && row.serviceDay === "monday",
    )!;
    // 13:00, 13:15, 13:30, 13:45 — four runs — plus the two scheduled trips.
    expect(first.tripsPerDay).toBe(6);
    expect(first.frequencyTripCount).toBe(4);
    expect(first.scheduledTripCount).toBe(2);
    expect(first.derivationMethod).toBe("mixed");
    expect(first.lastDepartureSeconds).toBe(13 * HOUR + 2700);
    expect(first.peakHour).toBe(13);
    expect(first.peakHeadwayMinutes).toBe(15);
  });

  it("offsets each stop by its position within the trip", async () => {
    const result = await parseGtfsFeed(await zipOf(frequencyFeed()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const second = result.feed.stopServiceLevels.find(
      (row) => row.stopId === "S2" && row.serviceDay === "monday",
    )!;
    // S2 is seven minutes down the line from S1, so the 13:00 run reaches it at
    // 13:07 and the last at 13:52 — never at 12:07, which is only the template.
    expect(second.lastDepartureSeconds).toBe(13 * HOUR + 52 * 60);
    expect(second.frequencyTripCount).toBe(4);
  });

  it("counts a frequency run once at ROUTE level, not once per stop", async () => {
    const result = await parseGtfsFeed(await zipOf(frequencyFeed()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const route = result.feed.routeServiceLevels.find(
      (row) => row.routeId === "R1" && row.serviceDay === "monday",
    )!;
    expect(route.tripsPerDay).toBe(6);
    expect(route.frequencyTripCount).toBe(4);
  });

  it("PARSES a feed whose frequencies.txt is header-only, which gtfs_skim.py refuses", async () => {
    // 6 of the 7 sampled feeds that ship the file ship it empty. Refusing them
    // would reject six real agencies over a header row.
    const files = baseFeed();
    files["frequencies.txt"] = "trip_id,start_time,end_time,headway_secs\n";
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.feed.derivationMethod).toBe("scheduled");
    expect(result.feed.stats.frequencyTrips).toBe(0);
  });

  it("PARSES a feed where frequencies covers a tiny minority of trips", async () => {
    // The measured shape of the real world: 4 rows covering 2 trips out of
    // 18,150. A per-feed refusal rejects the entire agency.
    const result = await parseGtfsFeed(await zipOf(frequencyFeed()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.feed.derivationMethod).toBe("mixed");
    expect(result.feed.stats.scheduledTrips).toBe(2);
    expect(result.feed.stats.frequencyTrips).toBe(1);
  });

  it("says 'frequencies' when every trip in the feed is frequency-based", async () => {
    const files = baseFeed();
    files["trips.txt"] = "trip_id,route_id,service_id,direction_id\nT1,R1,WK,0\n";
    files["stop_times.txt"] =
      "trip_id,stop_id,arrival_time,departure_time,stop_sequence\n" +
      "T1,S1,06:00:00,06:00:00,1\nT1,S2,06:05:00,06:05:00,2\n";
    files["frequencies.txt"] = "trip_id,start_time,end_time,headway_secs\nT1,06:00:00,07:00:00,600\n";
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.feed.derivationMethod).toBe("frequencies");
    const row = result.feed.stopServiceLevels.find(
      (item) => item.stopId === "S1" && item.serviceDay === "monday",
    )!;
    expect(row.tripsPerDay).toBe(6);
    expect(row.derivationMethod).toBe("frequencies");
  });

  it("records exact_times=1 rather than flattening the distinction away", async () => {
    const files = frequencyFeed();
    files["frequencies.txt"] =
      "trip_id,start_time,end_time,headway_secs,exact_times\nT3,13:00:00,14:00:00,900,1\n";
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(warningCount(result.feed.warnings, "frequency_exact_times")).toBe(1);
    expect(result.feed.stats.exactTimesFrequencyTrips).toBe(1);
    // It expands IDENTICALLY for counting — that is the whole claim.
    const row = result.feed.stopServiceLevels.find(
      (item) => item.stopId === "S1" && item.serviceDay === "monday",
    )!;
    expect(row.tripsPerDay).toBe(6);
  });

  it("counts an unreadable frequencies row without losing the trip's schedule", async () => {
    const files = baseFeed();
    files["frequencies.txt"] = "trip_id,start_time,end_time,headway_secs\nT1,13:00:00,12:00:00,900\nT1,,,\n";
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(warningCount(result.feed.warnings, "bad_frequency_row")).toBe(2);
    expect(result.feed.derivationMethod).toBe("scheduled");
  });

  it("counts a frequencies row naming a trip stop_times never mentions", async () => {
    const files = baseFeed();
    files["frequencies.txt"] = "trip_id,start_time,end_time,headway_secs\nT9,13:00:00,14:00:00,900\n";
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(warningCount(result.feed.warnings, "dangling_trip_reference")).toBe(1);
  });
});

describe("every refusal parse.ts can produce", () => {
  it("stays inside the closed vocabulary", async () => {
    const produced = new Set<string>();
    const cases: Uint8Array[] = [
      new TextEncoder().encode("not a zip"),
      await zipOf({ "stops.txt": "stop_id\nA\n" }),
      await zipOf({ ...baseFeed(), "sub/stops.txt": "stop_id,stop_name,stop_lat,stop_lon\nX,X,1,1\n" }),
    ];
    for (const bytes of cases) {
      const result = await parseGtfsFeed(bytes);
      if (!result.ok) produced.add(result.code);
    }
    for (const code of produced) {
      expect(GTFS_PARSE_FAILURE_CODES as readonly string[]).toContain(code);
    }
    expect(produced.size).toBeGreaterThan(0);
  });

  it("refuses not_a_zip", async () => {
    const result = await parseGtfsFeed(new TextEncoder().encode("stop_id,stop_name\nA,Alpha\n"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_a_zip");
  });

  it("refuses too_large", async () => {
    const result = await parseGtfsFeed(await zipOf(baseFeed()), {
      limits: { ...resolveGtfsLimits({}), maxArchiveBytes: 10 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("too_large");
  });

  it("refuses ambiguous_archive", async () => {
    const files = baseFeed();
    const result = await parseGtfsFeed(
      await zipOf({ ...files, "nested/stops.txt": "stop_id,stop_name,stop_lat,stop_lon\nX,X,1,1\n" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ambiguous_archive");
  });

  it("refuses missing_required_file and NAMES the file — for every required file", async () => {
    for (const required of GTFS_REQUIRED_FILES) {
      const files = baseFeed();
      delete files[required];
      const result = await parseGtfsFeed(await zipOf(files));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("missing_required_file");
      // "your feed is missing something" is not a message anybody can use.
      expect(result.detail).toContain(required);
    }
  });

  it("refuses missing_required_file when BOTH calendar files are absent", async () => {
    const files = baseFeed();
    delete files["calendar.txt"];
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("missing_required_file");
    expect(result.detail).toContain("calendar.txt");
    expect(result.detail).toContain("calendar_dates.txt");
  });

  it("refuses no_usable_stops when nothing in stops.txt has coordinates", async () => {
    const files = baseFeed();
    files["stops.txt"] = "stop_id,stop_name,stop_lat,stop_lon\nS1,First,,\nS2,Second,not,here\n";
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("no_usable_stops");
  });

  it("refuses no_usable_stops for coordinates outside the earth", async () => {
    const files = baseFeed();
    files["stops.txt"] = "stop_id,stop_name,stop_lat,stop_lon\nS1,First,900,-100\n";
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("no_usable_stops");
  });

  it("refuses no_usable_service when stop_times has nothing in it", async () => {
    const files = baseFeed();
    files["stop_times.txt"] = "trip_id,stop_id,arrival_time,departure_time,stop_sequence\n";
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("no_usable_service");
  });

  it("refuses no_usable_service when every departure time is blank", async () => {
    const files = baseFeed();
    files["stop_times.txt"] =
      "trip_id,stop_id,arrival_time,departure_time,stop_sequence\nT1,S1,,,1\nT1,S2,,,2\n";
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("no_usable_service");
  });

  it("refuses too_large when a table has more rows than allowed", async () => {
    const result = await parseGtfsFeed(await zipOf(baseFeed()), {
      limits: { ...resolveGtfsLimits({}), maxRowsPerTable: 1 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("too_large");
  });

  it("refuses too_large when the feed needs more histogram slots than allowed", async () => {
    const result = await parseGtfsFeed(await zipOf(baseFeed()), {
      limits: { ...resolveGtfsLimits({}), maxStopServicePairs: 1 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("too_large");
    expect(result.detail).toContain("stop/service");
  });

  it("refuses abandoned when the wall-clock budget runs out", async () => {
    // The clock is injected, so the budget is provable without waiting for it.
    let tick = 0;
    const result = await parseGtfsFeed(await zipOf(baseFeed()), {
      now: () => (tick += 100_000),
      limits: { ...resolveGtfsLimits({}), parseBudgetMs: 1_000 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("abandoned");
    expect(result.detail).toContain("budget");
  });

  it("never throws for anything a feed can contain", async () => {
    const nasty: Record<string, string>[] = [
      { ...baseFeed(), "stops.txt": "" },
      { ...baseFeed(), "trips.txt": "nothing,like,gtfs\n1,2,3\n" },
      { ...baseFeed(), "calendar.txt": "service_id\nWK\n" },
      { ...baseFeed(), "stop_times.txt": "trip_id,stop_id\nT1,S1\n" },
      { ...baseFeed(), "agency.txt": "\n\n\n" },
      { ...baseFeed(), "calendar_dates.txt": "service_id,date,exception_type\nWK,notadate,9\n" },
      { ...baseFeed(), "routes.txt": "route_id\n\n\n" },
    ];
    for (const files of nasty) {
      const result = await parseGtfsFeed(await zipOf(files));
      // Either outcome is fine; throwing is not.
      expect(typeof result.ok).toBe("boolean");
    }
  });
});

describe("what the parse reports about itself", () => {
  it("counts rows, bytes and histogram slots", async () => {
    const result = await parseGtfsFeed(await zipOf(baseFeed()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.feed.stats.stopTimesRows).toBe(4);
    expect(result.feed.stats.tripRows).toBe(2);
    expect(result.feed.stats.stopServicePairs).toBe(2);
    expect(result.feed.stats.routeServicePairs).toBe(1);
    expect(result.feed.stats.bytesDecompressed).toBeGreaterThan(0);
    expect(result.feed.stats.archiveBytes).toBeGreaterThan(0);
  });

  it("lists the archive members it found", async () => {
    const result = await parseGtfsFeed(await zipOf(baseFeed()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.feed.filesPresent).toEqual([
      "agency.txt",
      "calendar.txt",
      "routes.txt",
      "stop_times.txt",
      "stops.txt",
      "trips.txt",
    ]);
  });

  it("lists the routes serving a stop, and counts the stops on a route", async () => {
    // Two routes meeting at one stop — the transfer point a bare count cannot
    // distinguish from a corridor. The sibling schema declares route_ids,
    // routes_serving and stops_served NOT NULL DEFAULT 0, so a derivation that
    // did not produce them would persist silent zeroes on every row.
    const files = baseFeed();
    files["routes.txt"] = "route_id,route_short_name,route_type\nR1,1,3\nR2,2,3\n";
    files["trips.txt"] = "trip_id,route_id,service_id,direction_id\nT1,R1,WK,0\nT2,R2,WK,0\n";
    files["stop_times.txt"] =
      "trip_id,stop_id,arrival_time,departure_time,stop_sequence\n" +
      "T1,S1,08:00:00,08:00:00,1\nT1,S2,08:10:00,08:10:00,2\n" +
      "T2,S1,09:00:00,09:00:00,1\n";

    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const shared = result.feed.stopServiceLevels.find(
      (row) => row.stopId === "S1" && row.serviceDay === "monday",
    )!;
    expect(shared.routeIds).toEqual(["R1", "R2"]);
    expect(shared.routesServing).toBe(2);

    const only = result.feed.stopServiceLevels.find(
      (row) => row.stopId === "S2" && row.serviceDay === "monday",
    )!;
    expect(only.routeIds).toEqual(["R1"]);

    const first = result.feed.routeServiceLevels.find(
      (row) => row.routeId === "R1" && row.serviceDay === "monday",
    )!;
    expect(first.stopsServed).toBe(2);
    const second = result.feed.routeServiceLevels.find(
      (row) => row.routeId === "R2" && row.serviceDay === "monday",
    )!;
    expect(second.stopsServed).toBe(1);
  });

  it("counts a stop a route serves ONCE, however many trips visit it", async () => {
    const result = await parseGtfsFeed(await zipOf(baseFeed()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Two trips over the same two stops. Four stop_times rows, two stops.
    const route = result.feed.routeServiceLevels.find(
      (row) => row.routeId === "R1" && row.serviceDay === "monday",
    )!;
    expect(route.stopsServed).toBe(2);
  });

  it("credits a frequency-based trip's stops as served", async () => {
    // Membership does not depend on how departures are expressed.
    //
    // S3 IS SERVED ONLY BY THE FREQUENCY-BASED TRIP, and that is the whole
    // design of this fixture: an earlier version let the scheduled trip cover
    // the same two stops, so dropping membership for frequency trips entirely
    // changed nothing and the test passed against the mutation. A shared stop
    // proves nothing here — only an exclusively-frequency stop does.
    const files = baseFeed();
    files["stops.txt"] += "S3,Third,40.2,-100.2\n";
    files["stop_times.txt"] =
      "trip_id,stop_id,arrival_time,departure_time,stop_sequence\n" +
      "T1,S1,08:00:00,08:00:00,1\nT1,S2,08:10:00,08:10:00,2\nT1,S3,08:20:00,08:20:00,3\n" +
      "T2,S1,08:30:00,08:30:00,1\nT2,S2,08:40:00,08:40:00,2\n";
    files["frequencies.txt"] = "trip_id,start_time,end_time,headway_secs\nT1,13:00:00,14:00:00,1800\n";

    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const route = result.feed.routeServiceLevels.find(
      (row) => row.routeId === "R1" && row.serviceDay === "monday",
    )!;
    expect(route.stopsServed).toBe(3);

    const frequencyOnlyStop = result.feed.stopServiceLevels.find(
      (row) => row.stopId === "S3" && row.serviceDay === "monday",
    )!;
    expect(frequencyOnlyStop.routeIds).toEqual(["R1"]);
    expect(frequencyOnlyStop.routesServing).toBe(1);
    expect(frequencyOnlyStop.derivationMethod).toBe("frequencies");
  });

  it("keeps a timezone the feed did not state as null rather than inventing one", async () => {
    const files = baseFeed();
    files["agency.txt"] = "agency_id,agency_name,agency_url\nAG,Test Transit,https://example.org\n";
    const result = await parseGtfsFeed(await zipOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.feed.agencies[0].timezone).toBeNull();
  });
});
