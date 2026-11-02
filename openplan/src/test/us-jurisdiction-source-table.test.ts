/**
 * ONE ROW PER STATE: does each place get its own state's sources?
 *
 * The fixture lists one county per state, DC and territory, with a bbox taken
 * from the Census 2024 cartographic boundary file, and the answer each registry
 * DECLARES for that state: the crash source an acquisition and a live read
 * should use, whether the CEQA §15064.3 screen may render, and which state
 * grant bundle covers it. The expected values were written from those
 * declarations (see the fixture's `expectationBasis`), not by running this code.
 *
 * Before 2026-11-02 every county in Nevada and the border counties of Arizona,
 * Idaho, Oregon and Utah resolved to California's CCRS, because the resolver
 * picked the first adapter whose rectangle overlapped the bbox. CCRS then
 * answered with no crashes and the acquisition stored nothing.
 *
 * The Explore corridor scorecard made the same mistake by another road until
 * 2026-11-02: it merged every adapter whose rectangle overlapped the bbox and
 * labeled the summary with the first, so a Nevada corridor with no FARS fatal
 * crash read as CCRS. Each row now also runs the corridor path: the picked
 * county is re-resolved to confirm its state, exactly as the analysis route
 * does, and the scorecard summary must name the same source.
 *
 * Since 2026-11-02 Oregon's live read and corridor rows expect ODOT's crash
 * layer, which carries injury severity; its acquisition row still expects
 * FARS, because `safety_crashes` does not yet admit the ODOT source id.
 *
 * Blind category: the place-to-state step is exercised for county GEOIDs only.
 * Cities, CDPs, metro areas and drawn areas are covered by the route tests in
 * safety-crashes-route.test.ts and analysis-route-grounding.test.ts. Network
 * adapters and the boundary resolver are stubbed, so this checks which source
 * is ASKED, not what the source returns.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import table from "./fixtures/us-jurisdiction-source-table.json";
import { ingestCrashesForStudyArea } from "@/lib/safety/ingest";
import { readCrashesForStudyArea } from "@/lib/safety/read-only-lane";
import { resolveCrashSource } from "@/lib/safety/sources/registry";
import { ccrsAdapter, CCRS_SOURCE_ID } from "@/lib/safety/sources/ccrs";
import { farsAdapter } from "@/lib/safety/sources/fars";
import { odotOrAdapter } from "@/lib/safety/sources/odot-or";
import type { CrashFetchResult } from "@/lib/safety/sources/types";
import { crashStatesFromTigerwebPlace } from "@/lib/safety/study-area-states";
import { countyRunShowsCeqaScreen } from "@/lib/models/county-run-vmt-framework";
import { describeGrantProgramCoverage } from "@/lib/grants/programs/coverage";
import { STATE_FIPS_TO_USPS } from "@/lib/geographies/state-fips";
import { fetchCrashesForStudyArea } from "@/lib/data-sources/crashes";
import { crashStatesOfConfirmedPlace } from "@/lib/safety/study-area-states";

const resolvePlaceBoundaryMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/geographies/place-resolver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/geographies/place-resolver")>()),
  resolvePlaceBoundary: (...args: unknown[]) => resolvePlaceBoundaryMock(...args),
}));

type Row = (typeof table.rows)[number];

const EMPTY_FETCH: CrashFetchResult = {
  records: [],
  matchedTotal: 0,
  geocodedTotal: 0,
  yearsCovered: [],
  yearsQueried: [2024],
  truncated: false,
};

/** Stand-in for the service-role client. Records which ingest rows were written. */
function fakeService() {
  const ingestRows: Record<string, unknown>[] = [];
  return {
    ingestRows,
    from(table: string) {
      if (table === "safety_crash_ingests") {
        return {
          insert: (row: Record<string, unknown>) => {
            ingestRows.push(row);
            return { select: () => ({ single: async () => ({ data: { id: "ingest-1" }, error: null }) }) };
          },
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      return {
        upsert: () => ({
          select: async () => ({ data: [], error: null }),
          then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
        }),
      };
    },
  };
}

let ccrsFetch: ReturnType<typeof vi.spyOn>;
let odotFetch: ReturnType<typeof vi.spyOn>;
let farsFetch: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  ccrsFetch = vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue(EMPTY_FETCH);
  odotFetch = vi.spyOn(odotOrAdapter, "fetch").mockResolvedValue(EMPTY_FETCH);
  farsFetch = vi.spyOn(farsAdapter, "fetch").mockResolvedValue(EMPTY_FETCH);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Every source asked, in registry order. */
function askedSources(): string[] {
  return [
    ...(ccrsFetch.mock.calls.length > 0 ? [ccrsAdapter.id] : []),
    ...(odotFetch.mock.calls.length > 0 ? [odotOrAdapter.id] : []),
    ...(farsFetch.mock.calls.length > 0 ? [farsAdapter.id] : []),
  ];
}

function askedSource(): string | null {
  if (ccrsFetch.mock.calls.length > 0) return ccrsAdapter.id;
  if (odotFetch.mock.calls.length > 0) return odotOrAdapter.id;
  if (farsFetch.mock.calls.length > 0) return farsAdapter.id;
  return null;
}

const label = (row: Row) => `${row.usps} ${row.countyName} (${row.countyGeoid})`;

describe("the jurisdiction fixture", () => {
  it("has exactly one row for every state, DC and territory code OpenPlan knows", () => {
    const codes = table.rows.map((row) => row.stateFips).sort();
    expect(codes).toEqual(Object.keys(STATE_FIPS_TO_USPS).sort());
    for (const row of table.rows) {
      expect(row.countyGeoid.slice(0, 2), label(row)).toBe(row.stateFips);
      expect(STATE_FIPS_TO_USPS[row.stateFips], label(row)).toBe(row.usps);
      expect(row.bbox.minLon, label(row)).toBeLessThan(row.bbox.maxLon);
      expect(row.bbox.minLat, label(row)).toBeLessThan(row.bbox.maxLat);
    }
  });

  it("puts a county inside the CCRS rectangle in every state that has one", () => {
    const inside = table.rows.filter((row) => row.bboxOverlapsCcrsEnvelope).map((row) => row.usps).sort();
    expect(inside).toEqual(["AZ", "CA", "ID", "NV", "OR", "UT"]);
    for (const row of table.rows) {
      expect(ccrsAdapter.covers(row.bbox), label(row)).toBe(row.bboxOverlapsCcrsEnvelope);
    }
  });
});

describe.each(table.rows)("$usps $countyName ($countyGeoid)", (row) => {
  const stateFips = () => crashStatesFromTigerwebPlace("county", row.countyGeoid);

  it("an acquisition asks the state's declared crash source, or records a gap", async () => {
    const service = fakeService();
    const result = await ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "ws-1",
      bbox: row.bbox,
      stateFips: stateFips(),
      years: [2024],
      enrichSeriousInjury: false,
      includeParties: false,
    });

    expect(askedSource(), label(row)).toBe(row.expected.ingestCrashSource);
    expect(result.sourceId, label(row)).toBe(row.expected.ingestCrashSource);
    if (row.expected.ingestCrashSource === null) {
      expect(result.status, label(row)).toBe("no_coverage");
      expect(result.coverageState, label(row)).toBe("out_of_coverage");
    } else {
      expect(service.ingestRows[0]?.source_id, label(row)).toBe(row.expected.ingestCrashSource);
      // A fatality census must say so wherever it is the source.
      const expectedCompleteness =
        row.expected.ingestCrashSource === farsAdapter.id ? "fatal_only" : ccrsAdapter.severityCompleteness;
      expect(result.severityCompleteness, label(row)).toBe(expectedCompleteness);
    }
  });

  it("a live read asks the same source", async () => {
    const result = await readCrashesForStudyArea({ bbox: row.bbox, stateFips: stateFips(), years: [2024] });

    expect(askedSource(), label(row)).toBe(row.expected.readCrashSource);
    if (row.expected.readCrashSource === null) {
      expect(result.kind, label(row)).toBe("out_of_coverage");
    } else {
      expect(result.kind, label(row)).toBe("read_only");
      if (result.kind === "read_only") expect(result.adapter.id, label(row)).toBe(row.expected.readCrashSource);
    }
  });

  it("a corridor run on the picked county asks the same source and is labeled with it", async () => {
    // The boundary the resolver would return for this county: same kind, GEOID
    // and bbox, which is what lets the route trust the county's state.
    resolvePlaceBoundaryMock.mockResolvedValue({
      kind: "county",
      geoid: row.countyGeoid,
      label: row.countyName,
      geojson: { type: "Polygon", coordinates: [] },
      bbox: row.bbox,
    });
    const states = await crashStatesOfConfirmedPlace({ kind: "county", geoid: row.countyGeoid }, row.bbox);
    expect(states, label(row)).toEqual([row.stateFips]);

    const summary = await fetchCrashesForStudyArea({ bbox: row.bbox, stateFips: states });

    const expected = row.expected.readCrashSource;
    expect(summary.source, label(row)).toBe(expected ?? "out-of-coverage");
    expect(askedSources(), label(row)).toEqual(expected === null ? [] : [expected]);
    if (expected === farsAdapter.id) {
      expect(summary.severityCompleteness, label(row)).toBe("fatal_only");
      expect(summary.crashDensityBasis, label(row)).toBe("fatal_only");
    }
  });

  it("a corridor run with no confirmed state is never labeled California's source", async () => {
    const summary = await fetchCrashesForStudyArea({ bbox: row.bbox, stateFips: null });

    expect(summary.source, label(row)).not.toBe(CCRS_SOURCE_ID);
    expect(askedSources(), label(row)).not.toContain(CCRS_SOURCE_ID);
    if (summary.observed) expect(summary.narrativeLine, label(row)).toMatch(/state was not confirmed/);
  });

  it("an unknown state never becomes California", () => {
    const resolution = resolveCrashSource({ bbox: row.bbox, stateFips: null });
    const resolved = resolution.kind === "resolved" ? resolution.adapter.id : null;
    expect(resolved, label(row)).not.toBe(CCRS_SOURCE_ID);
  });

  it("renders the CEQA screen only where the framework registry declares CEQA", () => {
    expect(
      countyRunShowsCeqaScreen({ geography_type: "county_fips", geography_id: row.countyGeoid }),
      label(row)
    ).toBe(row.expected.ceqaScreen);
  });

  it("matches the state grant bundle registered for the state, or none", () => {
    const coverage = describeGrantProgramCoverage({ country: "US", subdivision: row.usps });
    const stateBundles = coverage.bundles
      .filter((bundle) => bundle.scope === "jurisdiction_match")
      .map((bundle) => bundle.key);
    expect(stateBundles, label(row)).toEqual(
      row.expected.stateGrantBundle === null ? [] : [row.expected.stateGrantBundle]
    );
  });
});
