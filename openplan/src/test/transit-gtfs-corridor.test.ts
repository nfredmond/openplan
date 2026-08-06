import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonWithRetryMock = vi.fn();

vi.mock("@/lib/data-sources/http", () => ({
  fetchJsonWithRetry: (...args: unknown[]) => fetchJsonWithRetryMock(...args),
}));

import { fetchTransitAccessForBbox } from "@/lib/data-sources/transit";
import {
  GROUPABLE_SERVICE_LEVEL_FIELDS,
  GTFS_CORRIDOR_STOP_COLUMNS,
  countFrequentStops,
  frequentServiceTierFor,
  representativeServiceGroup,
} from "@/lib/data-sources/transit/gtfs-feed";
import { GTFS_CURRENT_VERSION_FILTER } from "@/lib/gtfs/persist";
import { GTFS_NOT_A_TIMETABLE_CAVEAT } from "@/lib/gtfs/caveats";
import {
  FREQUENT_SERVICE_HEADWAY_MINUTES,
  BASIC_SERVICE_HEADWAY_MINUTES,
} from "@/lib/gtfs/service-levels";
import {
  DEFAULT_SERVICE_DAY_GROUPING_PROFILE,
  SUNDAY_TO_THURSDAY_WORKWEEK,
  EVERY_DAY_SEPARATELY,
  groupServiceDays,
} from "@/lib/gtfs/service-day-groups";
import type { GtfsServiceLevel } from "@/lib/gtfs/types";
import {
  createRecordingSupabase,
  equalityFilters,
  type RecordedQuery,
} from "./helpers/fake-supabase-query-recorder";
import { answerFromTables, type Row } from "./helpers/fake-gtfs-tables";

/**
 * THE ADAPTER THAT MAKES A CORRIDOR SCREEN READ AN AGENCY'S OWN SCHEDULE.
 *
 * Every assertion here is about one of four things that have each shipped as a
 * defect somewhere in this repository: a service-role read without its tenant
 * filter, a version read that saw a promoted-then-failed ingest, a projection
 * missing a column nothing type-checks, and a source whose silence was scored as
 * a finding.
 */

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

/** A corridor roughly 5.4 miles across and 6.9 miles tall. */
const BBOX = { minLon: -121.8, minLat: 38.5, maxLon: -121.7, maxLat: 38.6 };

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;

function stopRows(options: {
  workspaceId?: string;
  versionId: string;
  stopId: string;
  lat: number;
  lon: number;
  peakHeadwaySeconds: number | null;
  days?: readonly string[];
}): Row[] {
  const days = options.days ?? WEEKDAYS;
  return days.map((day) => ({
    workspace_id: options.workspaceId ?? WORKSPACE_ID,
    feed_version_id: options.versionId,
    stop_id: options.stopId,
    service_day: day,
    latitude: options.lat,
    longitude: options.lon,
    trips_per_day: 40,
    first_departure_seconds: 21_600,
    last_departure_seconds: 79_200,
    peak_headway_seconds: options.peakHeadwaySeconds,
    peak_window_start_seconds: 28_800,
  }));
}

function feedRow(id: string, agency: string, over: Row = {}): Row {
  return {
    id,
    workspace_id: WORKSPACE_ID,
    agency_name: agency,
    city: "Somewhere",
    state: "XX",
    status: "loaded",
    source_kind: "url",
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function versionRow(id: string, feedId: string, over: Row = {}): Row {
  return {
    id,
    feed_id: feedId,
    workspace_id: WORKSPACE_ID,
    is_current: true,
    status: "ready",
    service_start_date: "2024-08-01",
    service_end_date: "2027-04-05",
    frequency_trip_count: 0,
    parse_warnings: [],
    route_service_level_rows: 120,
    stop_service_level_rows: 900,
    ...over,
  };
}

/**
 * One agency spanning the whole corridor and beyond, and a small operator whose
 * stops sit entirely inside it. Both serve the study area, so both contribute —
 * a rider does not care who runs the bus.
 */
function twoOperatorWorkspace() {
  const wide = [
    // Two anchor stops well outside the corridor: they are what make this feed's
    // EXTENT contain the study area, which is what full coverage means.
    ...stopRows({ versionId: "ver-wide", stopId: "outside-w", lat: 38.3, lon: -122.0, peakHeadwaySeconds: 3600 }),
    ...stopRows({ versionId: "ver-wide", stopId: "outside-e", lat: 38.8, lon: -121.5, peakHeadwaySeconds: 3600 }),
    // Three inside the corridor. One frequent, two not.
    ...stopRows({ versionId: "ver-wide", stopId: "A", lat: 38.55, lon: -121.75, peakHeadwaySeconds: 720 }),
    ...stopRows({ versionId: "ver-wide", stopId: "B", lat: 38.56, lon: -121.74, peakHeadwaySeconds: 1800 }),
    ...stopRows({ versionId: "ver-wide", stopId: "C", lat: 38.52, lon: -121.78, peakHeadwaySeconds: 3600 }),
  ];

  const small = [
    // The SAME stop_id as the wide feed's "A" — two agencies routinely publish
    // the same kerb under their own ids, and collapsing them by stop_id alone
    // would delete one operator's service from the count.
    ...stopRows({ versionId: "ver-small", stopId: "A", lat: 38.551, lon: -121.751, peakHeadwaySeconds: 900 }),
    ...stopRows({ versionId: "ver-small", stopId: "S1", lat: 38.57, lon: -121.72, peakHeadwaySeconds: 5400 }),
  ];

  return {
    gtfs_feeds: [feedRow("feed-wide", "Regional Transit"), feedRow("feed-small", "City Shuttle")],
    gtfs_feed_versions: [
      versionRow("ver-wide", "feed-wide"),
      versionRow("ver-small", "feed-small"),
    ],
    gtfs_stop_service_levels: [...wide, ...small],
  };
}

function fetchWith(tables: Record<string, Row[]>) {
  const recorder = createRecordingSupabase(answerFromTables(tables));
  return {
    recorder,
    run: () => fetchTransitAccessForBbox(BBOX, { workspaceId: WORKSPACE_ID, client: recorder.client }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Overpass is unreachable throughout, so anything that answers here answered
  // from the database. A test that could silently fall through to OSM and still
  // pass would be proving nothing about the GTFS adapter.
  fetchJsonWithRetryMock.mockResolvedValue(null);
});

describe("a corridor read over the workspace's ingested feeds", () => {
  it("aggregates every feed whose stops reach the study area", async () => {
    const { run } = fetchWith(twoOperatorWorkspace());
    const summary = await run();

    expect(summary.observed).toBe(true);
    expect(summary.source).toBe("gtfs-feed");
    // 3 from the wide feed + 2 from the small one. The shared "A" counts twice
    // because it is two operators' service at one kerb, not one stop counted
    // twice — see `summarizeContributions`.
    expect(summary.totalStops).toBe(5);
    expect(summary.contributingSources.map((source) => source.label).sort()).toEqual([
      "City Shuttle",
      "Regional Transit",
    ]);
  });

  it("reports a frequent-service share over a representative service day", async () => {
    const { run } = fetchWith(twoOperatorWorkspace());
    const summary = await run();

    // Of the five stops inside the corridor, two have a median weekday peak
    // headway at or under the frequent-service threshold (720s = 12 min, and
    // 900s = exactly 15 min, which the tier includes).
    expect(summary.frequentServiceStops).toBe(2);
    expect(summary.frequentServiceShare).toBeCloseTo(0.4, 6);
    expect(summary.frequentServiceHeadwayMinutes).toBe(FREQUENT_SERVICE_HEADWAY_MINUTES);
    expect(summary.method.frequencyTermApplied).toBe(true);
  });

  it("reports no mode split, because GTFS records a mode on the route", async () => {
    const { run } = fetchWith(twoOperatorWorkspace());
    const summary = await run();

    // Null, never zero. Splitting stops into bus/rail/ferry means double-counting
    // every interchange or inventing a primary mode the feed never states.
    expect(summary.busStops).toBeNull();
    expect(summary.railStations).toBeNull();
    expect(summary.ferryStops).toBeNull();
  });

  it("carries the GTFS caveats with the figures it derived", async () => {
    const { run } = fetchWith(twoOperatorWorkspace());
    const summary = await run();

    // Every number here is an hourly average taken off one representative date
    // from a schedule that may have stopped running. A figure that lands in a
    // regional transportation plan with none of that attached is the harm the
    // whole GTFS module is shaped to avoid.
    expect(summary.caveats).toContain(GTFS_NOT_A_TIMETABLE_CAVEAT);
    expect(summary.sourceSnapshot.caveats).toEqual(summary.caveats);
  });
});

describe("the tenant boundary on a service-role read", () => {
  it("filters every GTFS table on the workspace", async () => {
    const { recorder, run } = fetchWith(twoOperatorWorkspace());
    await run();

    // `gtfs_feeds.workspace_id IS NULL` is a PUBLIC PRELOADED feed shared by
    // every tenant on the deployment, and there is no RLS behind a service-role
    // client. Every one of these `.eq()` calls is the access control.
    for (const table of ["gtfs_feeds", "gtfs_feed_versions", "gtfs_stop_service_levels"]) {
      const reads = recorder.queriesFor(table);
      expect(reads.length, `${table} was never read`).toBeGreaterThan(0);
      for (const read of reads) {
        expect(equalityFilters(read).workspace_id, `${table} read without its workspace filter`).toBe(
          WORKSPACE_ID
        );
      }
    }
  });

  it("does not read another workspace's feeds, or the public preloaded ones", async () => {
    const tables = twoOperatorWorkspace();
    tables.gtfs_feeds.push(
      feedRow("feed-stranger", "Someone Else's Transit", { workspace_id: OTHER_WORKSPACE_ID }),
      // workspace_id NULL is the public preloaded feed. A workspace scores on the
      // feeds it chose to ingest, not on what an operator seeded the deployment
      // with — it could not inspect or undo the second.
      feedRow("feed-public", "Preloaded Agency", { workspace_id: null })
    );
    tables.gtfs_feed_versions.push(
      versionRow("ver-stranger", "feed-stranger", { workspace_id: OTHER_WORKSPACE_ID }),
      versionRow("ver-public", "feed-public", { workspace_id: null })
    );
    tables.gtfs_stop_service_levels.push(
      ...stopRows({
        workspaceId: OTHER_WORKSPACE_ID,
        versionId: "ver-stranger",
        stopId: "X1",
        lat: 38.54,
        lon: -121.76,
        peakHeadwaySeconds: 600,
      }),
      ...stopRows({
        workspaceId: null as unknown as string,
        versionId: "ver-public",
        stopId: "P1",
        lat: 38.545,
        lon: -121.765,
        peakHeadwaySeconds: 600,
      })
    );

    const summary = await fetchWith(tables).run();

    expect(summary.totalStops).toBe(5);
    expect(summary.contributingSources.map((source) => source.label)).not.toContain(
      "Someone Else's Transit"
    );
    expect(summary.contributingSources.map((source) => source.label)).not.toContain("Preloaded Agency");
  });

  it("ignores a feed the workspace deactivated", async () => {
    const tables = twoOperatorWorkspace();
    tables.gtfs_feeds = tables.gtfs_feeds.map((feed) =>
      feed.id === "feed-small" ? { ...feed, is_active: false } : feed
    );

    const summary = await fetchWith(tables).run();

    expect(summary.totalStops).toBe(3);
    expect(summary.contributingSources.map((source) => source.label)).toEqual(["Regional Transit"]);
  });
});

describe("the version predicate", () => {
  it("reads the feed a workspace actually analyses with, through the shared filter", async () => {
    const { recorder, run } = fetchWith(twoOperatorWorkspace());
    await run();

    const versionRead = recorder.queriesFor("gtfs_feed_versions")[0];
    const filters = equalityFilters(versionRead);
    // BOTH halves, and they come from `GTFS_CURRENT_VERSION_FILTER` rather than
    // being typed here: `is_current` alone reads a promoted-then-failed version
    // as service data, `status = 'ready'` alone gives a workspace with three
    // successful ingests three times its real stops.
    expect(filters.is_current).toBe(GTFS_CURRENT_VERSION_FILTER.is_current);
    expect(filters.status).toBe(GTFS_CURRENT_VERSION_FILTER.status);
  });

  it("skips a version that was promoted and then failed", async () => {
    const tables = twoOperatorWorkspace();
    tables.gtfs_feed_versions = tables.gtfs_feed_versions.map((version) =>
      version.id === "ver-small" ? { ...version, status: "failed" } : version
    );

    const summary = await fetchWith(tables).run();

    expect(summary.totalStops).toBe(3);
  });

  it("skips a ready version that is no longer the current one", async () => {
    const tables = twoOperatorWorkspace();
    tables.gtfs_feed_versions.push(
      versionRow("ver-wide-old", "feed-wide", { is_current: false })
    );
    tables.gtfs_stop_service_levels.push(
      ...stopRows({ versionId: "ver-wide-old", stopId: "OLD", lat: 38.53, lon: -121.77, peakHeadwaySeconds: 600 })
    );

    const summary = await fetchWith(tables).run();

    // Three successful ingests of one feed must not triple its stops.
    expect(summary.totalStops).toBe(5);
  });
});

describe("what a projection has to ask for", () => {
  it("asks the database for the columns the derivation reads", async () => {
    const { recorder, run } = fetchWith(twoOperatorWorkspace());
    await run();

    const pageRead = recorder
      .queriesFor("gtfs_stop_service_levels")
      .find((query) => query.ops.some((op) => op.verb === "range"));

    // The clients are deliberately untyped, so a column dropped from this string
    // renders `undefined` at runtime with the suite green. Asserting on the
    // string itself is the only thing that catches it.
    expect(pageRead?.projection).toBe(GTFS_CORRIDOR_STOP_COLUMNS);
    for (const column of ["stop_id", "service_day", "peak_headway_seconds"]) {
      expect(GTFS_CORRIDOR_STOP_COLUMNS).toContain(column);
    }
    // `geom` would be hex EWKB, which nothing in this repository parses.
    expect(GTFS_CORRIDOR_STOP_COLUMNS).not.toContain("geom");
  });

  it("pages a study area larger than one PostgREST response", async () => {
    const tables = twoOperatorWorkspace();
    // 260 stops × 5 weekdays = 1,300 rows: more than one page.
    for (let index = 0; index < 260; index += 1) {
      tables.gtfs_stop_service_levels.push(
        ...stopRows({
          versionId: "ver-wide",
          stopId: `bulk-${String(index).padStart(4, "0")}`,
          lat: 38.51 + index * 0.0001,
          lon: -121.79,
          peakHeadwaySeconds: 3600,
        })
      );
    }

    const summary = await fetchWith(tables).run();

    // A read that stopped at the first page would report 3 + 2 + ~200 instead of
    // all 260 — a stop count that silently stopped counting, divided into a
    // density that lands in a grant application.
    expect(summary.totalStops).toBe(265);
    expect(summary.truncated).toBe(false);
  });

  it("discloses a study area larger than one screening run reads, and withholds the share", async () => {
    const tables = twoOperatorWorkspace();
    // 6,200 stops × 5 weekdays = 31,000 rows, past the per-version cap.
    for (let index = 0; index < 6_200; index += 1) {
      tables.gtfs_stop_service_levels.push(
        ...stopRows({
          versionId: "ver-wide",
          stopId: `cap-${String(index).padStart(5, "0")}`,
          lat: 38.51,
          lon: -121.79,
          peakHeadwaySeconds: 600,
        })
      );
    }

    const summary = await fetchWith(tables).run();

    // A stop count that silently stopped counting is a WRONG number, not a
    // missing one — and it divides into a density that lands in a grant
    // application. So it says so.
    expect(summary.truncated).toBe(true);
    expect(summary.sourceSnapshot.truncated).toBe(true);
    expect(summary.narrativeLine).toMatch(/count above is a floor/i);
    // And the frequency share is withheld: a share taken over the stops that fit
    // inside the cap is a fact about that arbitrary subset.
    expect(summary.frequentServiceShare).toBeNull();
    expect(summary.method.frequencyTermApplied).toBe(false);
  });
});

describe("the three rules about silence", () => {
  it("declines entirely when no ingested feed reaches the study area", async () => {
    const tables = twoOperatorWorkspace();
    tables.gtfs_stop_service_levels = tables.gtfs_stop_service_levels.map((row) => ({
      ...row,
      // Move every stop four hundred miles away.
      latitude: (row.latitude as number) + 6,
    }));

    const summary = await fetchWith(tables).run();

    // NOT "0 stops in this corridor" — that is the "0 crashes, therefore safe"
    // failure wearing a transit jersey. The registry falls through, Overpass is
    // down in this suite, and the run is honestly unobserved.
    expect(summary.source).toBe("unavailable");
    expect(summary.observed).toBe(false);
    expect(summary.sourceSnapshot.skippedSources).toEqual([
      { id: "gtfs-feed", reason: expect.stringMatching(/anywhere near this study area/i) },
    ]);
  });

  it("suppresses the frequency term under partial coverage, and keeps the density one", async () => {
    const tables = twoOperatorWorkspace();
    // Drop the wide feed, leaving only the small operator whose stops sit inside
    // the corridor and cannot speak for the rest of it.
    tables.gtfs_feeds = tables.gtfs_feeds.filter((feed) => feed.id === "feed-small");
    tables.gtfs_feed_versions = tables.gtfs_feed_versions.filter((version) => version.id === "ver-small");
    tables.gtfs_stop_service_levels = tables.gtfs_stop_service_levels.filter(
      (row) => row.feed_version_id === "ver-small"
    );

    const summary = await fetchWith(tables).run();

    expect(summary.observed).toBe(true);
    expect(summary.totalStops).toBe(2);
    // The stops are still counted — a density over the study area is a fact.
    expect(summary.stopsPerSqMile).toBeGreaterThan(0);
    // The share is not, because it would describe the covered part rather than
    // the area, and the covered part is almost always the urban part.
    expect(summary.frequentServiceShare).toBeNull();
    expect(summary.frequentServiceStops).toBeNull();
    expect(summary.method.frequencyTermApplied).toBe(false);
    expect(summary.narrativeLine).toMatch(/frequent-service share is not reported/i);
  });

  it("still answers, and still scores, from a feed whose schedule has ended", async () => {
    const tables = twoOperatorWorkspace();
    tables.gtfs_feed_versions = tables.gtfs_feed_versions.map((version) => ({
      ...version,
      service_end_date: "2025-04-05",
    }));

    const summary = await fetchWith(tables).run();

    // Refusing an expired feed is not neutral: an unobserved transit summary
    // makes the accessibility score DROP the transit term and rescale the rest
    // upward, so an agency with a stale feed would score MORE accessible than
    // one whose feed is current. Three of four real Sacramento-area feeds
    // measured on 2026-08-05 had already expired.
    expect(summary.observed).toBe(true);
    expect(summary.totalStops).toBe(5);
    // The window travels with the figures instead.
    expect(summary.contributingSources.every((source) => source.serviceEndDate === "2025-04-05")).toBe(true);
    expect(summary.narrativeLine).toContain("2025-04-05");
  });
});

/* -------------------------------------------------------------------------- */
/* The pure derivation                                                          */
/* -------------------------------------------------------------------------- */

describe("the frequent-service threshold is the constant, not a literal", () => {
  it("includes a headway exactly at the threshold and excludes one past it", () => {
    // Bound to the imported constant rather than to 15, so a jurisdiction with a
    // different statutory test changes one constant and this still describes it.
    expect(frequentServiceTierFor(FREQUENT_SERVICE_HEADWAY_MINUTES)).toBe(FREQUENT_SERVICE_HEADWAY_MINUTES);
    expect(frequentServiceTierFor(FREQUENT_SERVICE_HEADWAY_MINUTES - 0.1)).toBe(
      FREQUENT_SERVICE_HEADWAY_MINUTES
    );
    expect(frequentServiceTierFor(FREQUENT_SERVICE_HEADWAY_MINUTES + 0.1)).toBeNull();
    // The corridor screen reports the TIGHT tier only. The rural-legible second
    // tier exists in the vocabulary and is deliberately not what half the
    // accessibility term is measured against.
    expect(frequentServiceTierFor(BASIC_SERVICE_HEADWAY_MINUTES)).toBeNull();
    expect(frequentServiceTierFor(null)).toBeNull();
  });
});

describe("the representative service group", () => {
  it("is the widest group in the profile, not one named 'weekday'", () => {
    // MONDAY-TO-FRIDAY IS A CONVENTION, NOT A FACT. A call site reaching for a
    // group named "weekday" would work for the US profile and silently pick a
    // leisure day for an agency on a Sunday-to-Thursday workweek.
    expect(representativeServiceGroup(DEFAULT_SERVICE_DAY_GROUPING_PROFILE).days).toEqual([
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
    ]);
    expect(representativeServiceGroup(SUNDAY_TO_THURSDAY_WORKWEEK).days).toEqual([
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
    ]);
    // Ties go to the first group, which is what makes this deterministic when no
    // group is wider than any other.
    expect(representativeServiceGroup(EVERY_DAY_SEPARATELY).days).toEqual(["monday"]);
  });

  it("picks the widest group even when it is not the first one", () => {
    /**
     * WHY A SYNTHETIC PROFILE. Mutation proved the assertion above vacuous:
     * every registered profile happens to list its widest group FIRST, so
     * `groups[0]` passed it unchanged. The test described the property and
     * proved only that today's registry is ordered a particular way — and the
     * first profile added with a leading single-day group would have silently
     * started measuring a corridor's frequency against one day of the week.
     *
     * A profile whose widest group is LAST is what separates the two, and it is
     * built here rather than added to the registry because it serves no agency;
     * it exists to make the reduce fail when it is replaced by an index.
     */
    const marketDayFirst = {
      key: "market_day_first",
      label: "Market day / workweek",
      appliesTo: "Nowhere — a fixture that separates 'widest' from 'first'.",
      groups: [
        { key: "market", label: "Market day", days: ["saturday"] as const },
        {
          key: "rest",
          label: "Rest of the week",
          days: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday"] as const,
        },
      ],
    };

    expect(representativeServiceGroup(marketDayFirst).key).toBe("rest");
  });

  it("takes the median across the workweek, not the best day", () => {
    // A stop that is 12-minute on Tuesday and hourly the rest of the week is not
    // a frequent-service stop, and the group's `bestFrequentServiceTierMinutes`
    // would call it one.
    const oneGoodDay = new Map([
      [
        "spiky",
        WEEKDAYS.map((day, index) => ({
          serviceDay: day,
          tripsPerDay: 10,
          firstDepartureSeconds: 21_600,
          lastDepartureSeconds: 79_200,
          peakHeadwayMinutes: index === 1 ? 12 : 60,
          frequentServiceTierMinutes: index === 1 ? FREQUENT_SERVICE_HEADWAY_MINUTES : null,
          peakHour: 8,
        })),
      ],
    ]);

    expect(countFrequentStops(oneGoodDay)).toEqual({ frequentStops: 0, stopsWithHeadway: 1 });
  });
});

describe("the widening onto GtfsServiceLevel", () => {
  it("supplies every field groupServiceDays actually reads", () => {
    // THE ONE CAST IN THIS ADAPTER, PROVEN RATHER THAN BELIEVED. A stored row
    // cannot build a full `GtfsServiceLevel` honestly — `peakHourDepartures` and
    // `frequentServiceTierMinutes` are derivations the ingest never persisted —
    // so the narrow type is widened at one site. If `groupServiceDays` ever
    // starts reading a field outside that set, this fails instead of the rows
    // silently carrying `undefined` into a headway.
    const accessed = new Set<string>();
    const row = new Proxy(
      {
        serviceDay: "monday",
        tripsPerDay: 10,
        firstDepartureSeconds: 21_600,
        lastDepartureSeconds: 79_200,
        peakHeadwayMinutes: 12,
        frequentServiceTierMinutes: FREQUENT_SERVICE_HEADWAY_MINUTES,
        peakHour: 8,
      },
      {
        get(target, property, receiver) {
          if (typeof property === "string") accessed.add(property);
          return Reflect.get(target, property, receiver);
        },
      }
    ) as unknown as GtfsServiceLevel;

    groupServiceDays([row], DEFAULT_SERVICE_DAY_GROUPING_PROFILE);

    const unexpected = [...accessed].filter(
      (field) => !(GROUPABLE_SERVICE_LEVEL_FIELDS as readonly string[]).includes(field)
    );
    expect(unexpected, "groupServiceDays reads a field the corridor projection does not supply").toEqual(
      []
    );
    // And the proxy really was exercised — an empty `accessed` set would make
    // the assertion above pass for the wrong reason.
    expect(accessed.size).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* The double itself                                                            */
/* -------------------------------------------------------------------------- */

describe("the query recorder this file's assertions rest on", () => {
  it("applies the filters, so a missing one really does change the answer", () => {
    const answer = answerFromTables({
      t: [
        { id: 1, workspace_id: "a" },
        { id: 2, workspace_id: "b" },
      ],
    });

    const filtered: RecordedQuery = {
      table: "t",
      projection: "id",
      ops: [{ verb: "eq", args: ["workspace_id", "a"] }],
    };
    const unfiltered: RecordedQuery = { table: "t", projection: "id", ops: [] };

    expect(answer(filtered).data).toEqual([{ id: 1 }]);
    // If these two were equal, every tenant-boundary assertion above would be
    // green whether or not the filter was applied.
    expect(answer(unfiltered).data).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("applies the projection, so a dropped column really does go missing", () => {
    const answer = answerFromTables({ t: [{ id: 1, latitude: 38.5, longitude: -121.7 }] });
    expect(answer({ table: "t", projection: "id, latitude", ops: [] }).data).toEqual([
      { id: 1, latitude: 38.5 },
    ]);
  });
});
