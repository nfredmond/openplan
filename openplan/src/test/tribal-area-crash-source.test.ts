/**
 * A tribal area that lies in one state reads that state's crash file.
 *
 * The Census Bureau's record for a tribal area lists every state it lies in.
 * One listed state lets the crash source resolver use that state's file, the
 * way it does for a county there. Several listed states, none, or no answer
 * keep the national fatal-crash file, and the study-area sentence says why.
 * Where a state's file is read inside a tribal area, the same sentence says
 * crash reports on tribal land may be missing from it.
 *
 * The state list is never stored on the saved place and never typed by a
 * person: it is read from the Census Bureau by the saved or picked Census id.
 *
 * Blind category: the place resolver is replaced here, so these tests check
 * what OpenPlan does with a Census answer, not that the live Census service
 * gives one. `place-resolver-tribal-and-township.test.ts` holds the recorded
 * answer for the Navajo Nation. Each crash source's `fetch` is replaced too,
 * so no crash count here is a real one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolvePlaceBoundaryMock = vi.fn();
vi.mock("@/lib/geographies/place-resolver", () => ({
  resolvePlaceBoundary: (...args: unknown[]) => resolvePlaceBoundaryMock(...args),
}));

import {
  TRIBAL_AREA_STATE_FILE_SENTENCE,
  describeCrashStudyArea,
  describeCrashTribalArea,
  readCrashStudyAreaCoverage,
  withCrashStudyAreaCoverage,
  withCrashTribalArea,
  type CrashStudyAreaCoverage,
} from "@/lib/safety/crash-study-area";
import { fetchCrashesForStudyArea } from "@/lib/data-sources/crashes";
import { buildGrantApplicationHtml } from "@/lib/grants/application-html";
import { ATP_APPENDIX_FRAME, buildAtpEvidenceAppendices } from "@/lib/grants/atp-evidence-appendices";
import { ATP_APPENDIX_KEYS } from "@/lib/grants/evidence-appendix-keys";
import { htmlToPdfBlocks } from "@/lib/reports/pdf-text";
import { ingestCrashesForStudyArea } from "@/lib/safety/ingest";
import { ccrsAdapter } from "@/lib/safety/sources/ccrs";
import { farsAdapter } from "@/lib/safety/sources/fars";
import { odotOrAdapter } from "@/lib/safety/sources/odot-or";
import { crashSourcesForStudyArea, resolveCrashSource } from "@/lib/safety/sources/registry";
import type { CrashFetchResult, CrashRecord } from "@/lib/safety/sources/types";
import {
  confirmCrashStudyPlace,
  crashStatesFromPlaceOfRecord,
  crashStatesFromTribalAreaStates,
  crashStatesOfSavedTribalArea,
} from "@/lib/safety/study-area-states";
import { ATP_IDS, atpCrashEvidence, completeAtpRecords } from "./fixtures/grants/atp-evidence";

// A rectangle inside California's coarse rectangle that also overlaps Nevada's
// side of it, so a source picked by rectangle would be the wrong test.
const BBOX = { minLon: -123.8, minLat: 40.9, maxLon: -123.5, maxLat: 41.2 };
const SQUARE = {
  type: "Polygon",
  coordinates: [[[-123.8, 40.9], [-123.5, 40.9], [-123.5, 41.2], [-123.8, 41.2], [-123.8, 40.9]]],
};

/** What the resolver returns for a tribal area whose Census record lists these states. */
function tribalBoundary(geoid: string, states: string[] | undefined) {
  return {
    kind: "aiannh",
    geoid,
    label: "A tribal area",
    geojson: SQUARE,
    bbox: BBOX,
    ...(states === undefined ? {} : { tribalAreaStateFips: states }),
  };
}

const RECTANGLE: CrashStudyAreaCoverage = {
  basis: "bounding_rectangle",
  boundarySource: null,
  outsideBoundaryCount: null,
  boundaryUnreadable: false,
  rectangleReportedCount: null,
  rectangleMappableCount: null,
  countsAreLowerBound: false,
};
const RECTANGLE_SENTENCE =
  "Crashes are counted inside the study area's bounding rectangle, not the place boundary, so these counts can include crashes outside the place.";

function sourceIds(states: string[] | null): string[] {
  return crashSourcesForStudyArea({ bbox: BBOX, stateFips: states }, "ingest").candidates.map((adapter) => adapter.id);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the states a tribal area's crashes are read for", () => {
  it("passes on one listed state", () => {
    expect(crashStatesFromTribalAreaStates(["06"])).toEqual(["06"]);
  });

  it("passes on every listed state, never the first alone", () => {
    expect(crashStatesFromTribalAreaStates(["06", "32"])).toEqual(["06", "32"]);
    expect(crashStatesFromTribalAreaStates(["04", "35", "49"])).toEqual(["04", "35", "49"]);
  });

  it("is unknown when the Census record names no state or was not read", () => {
    expect(crashStatesFromTribalAreaStates([])).toBeNull();
    expect(crashStatesFromTribalAreaStates(null)).toBeNull();
    expect(crashStatesFromTribalAreaStates(undefined)).toBeNull();
  });
});

describe("the crash source a tribal area gets", () => {
  it("is the state's file first when the Census record lists one state that has one", () => {
    expect(sourceIds(crashStatesFromTribalAreaStates(["06"]))).toEqual([ccrsAdapter.id, farsAdapter.id]);
  });

  it("differs between two one-state tribal areas in two states", () => {
    // Varies the state, so a constant source cannot pass.
    const california = resolveCrashSource({ bbox: BBOX, stateFips: crashStatesFromTribalAreaStates(["06"]) });
    const oregon = resolveCrashSource({ bbox: BBOX, stateFips: crashStatesFromTribalAreaStates(["41"]) });
    expect(california).toMatchObject({ kind: "resolved", adapter: { id: ccrsAdapter.id } });
    expect(oregon).toMatchObject({ kind: "resolved", adapter: { id: odotOrAdapter.id } });
  });

  it("is the national file alone for one state with no state crash file, as for a county there", () => {
    const tribalArea = sourceIds(crashStatesFromTribalAreaStates(["32"]));
    const county = sourceIds(crashStatesFromPlaceOfRecord({ countryCode: "US", subdivisionCode: "NV" }));
    expect(tribalArea).toEqual([farsAdapter.id]);
    expect(tribalArea).toEqual(county);
  });

  it("is the national file alone for several states, even when the first listed has a state file", () => {
    // California is listed first and has a state file. Taking the first
    // listed state would read CCRS for an area partly in Nevada.
    expect(sourceIds(crashStatesFromTribalAreaStates(["06", "32"]))).toEqual([farsAdapter.id]);
    expect(sourceIds(crashStatesFromTribalAreaStates(["04", "35", "49"]))).toEqual([farsAdapter.id]);
  });

  it("is the national file alone when no state is listed", () => {
    expect(sourceIds(crashStatesFromTribalAreaStates([]))).toEqual([farsAdapter.id]);
  });
});

describe("confirmCrashStudyPlace for a picked tribal area", () => {
  it("reads the Census state list from the resolved boundary", async () => {
    resolvePlaceBoundaryMock.mockResolvedValue(tribalBoundary("1490R", ["06"]));
    const confirmed = await confirmCrashStudyPlace({ kind: "aiannh", geoid: "1490R" }, BBOX);
    expect(resolvePlaceBoundaryMock).toHaveBeenCalledWith("aiannh", "1490R");
    expect(confirmed).toEqual({ stateFips: ["06"], geometry: SQUARE, tribalArea: { censusStateFips: ["06"] } });
  });

  it("gives two one-state tribal areas their two different states", async () => {
    resolvePlaceBoundaryMock.mockResolvedValueOnce(tribalBoundary("1490R", ["06"]));
    resolvePlaceBoundaryMock.mockResolvedValueOnce(tribalBoundary("4690R", ["41"]));
    const first = await confirmCrashStudyPlace({ kind: "aiannh", geoid: "1490R" }, BBOX);
    const second = await confirmCrashStudyPlace({ kind: "aiannh", geoid: "4690R" }, BBOX);
    expect(first.stateFips).toEqual(["06"]);
    expect(second.stateFips).toEqual(["41"]);
  });

  it("keeps every state of a several-state area", async () => {
    resolvePlaceBoundaryMock.mockResolvedValue(tribalBoundary("2430R", ["04", "35", "49"]));
    const confirmed = await confirmCrashStudyPlace({ kind: "aiannh", geoid: "2430R" }, BBOX);
    expect(confirmed.stateFips).toEqual(["04", "35", "49"]);
    expect(confirmed.tribalArea).toEqual({ censusStateFips: ["04", "35", "49"] });
  });

  it("has no state when the Census record lists none, and records that it listed none", async () => {
    resolvePlaceBoundaryMock.mockResolvedValue(tribalBoundary("9999R", []));
    const confirmed = await confirmCrashStudyPlace({ kind: "aiannh", geoid: "9999R" }, BBOX);
    expect(confirmed.stateFips).toBeNull();
    expect(confirmed.tribalArea).toEqual({ censusStateFips: [] });
  });

  it("has no state, and says the list was not read, when the Census Bureau does not answer", async () => {
    resolvePlaceBoundaryMock.mockResolvedValueOnce(null);
    expect(await confirmCrashStudyPlace({ kind: "aiannh", geoid: "1490R" }, BBOX)).toEqual({
      stateFips: null,
      geometry: null,
      tribalArea: { censusStateFips: null },
    });
    resolvePlaceBoundaryMock.mockRejectedValueOnce(new Error("tigerweb down"));
    expect((await confirmCrashStudyPlace({ kind: "aiannh", geoid: "1490R" }, BBOX)).tribalArea).toEqual({
      censusStateFips: null,
    });
  });

  it("says nothing about a tribal area when the study area is not that area", async () => {
    resolvePlaceBoundaryMock.mockResolvedValue({
      ...tribalBoundary("1490R", ["06"]),
      bbox: { minLon: -110, minLat: 35, maxLon: -109, maxLat: 36 },
    });
    expect(await confirmCrashStudyPlace({ kind: "aiannh", geoid: "1490R" }, BBOX)).toEqual({
      stateFips: null,
      geometry: null,
      tribalArea: null,
    });
  });

  it("leaves a county as it was: its own state, and no tribal-area entry", async () => {
    resolvePlaceBoundaryMock.mockResolvedValue({ kind: "county", geoid: "06023", label: "Humboldt", geojson: SQUARE, bbox: BBOX });
    expect(await confirmCrashStudyPlace({ kind: "county", geoid: "06023" }, BBOX)).toEqual({
      stateFips: ["06"],
      geometry: SQUARE,
      tribalArea: null,
    });
  });
});

describe("crashStatesOfSavedTribalArea", () => {
  // The columns a saved tribal area has always had: no state among them.
  const SAVED = { source: "tigerweb", kind: "aiannh", ref: "1490R" };

  it("asks the Census Bureau by the saved id, so a place saved earlier is read the same way", async () => {
    resolvePlaceBoundaryMock.mockResolvedValue(tribalBoundary("1490R", ["06"]));
    expect(await crashStatesOfSavedTribalArea(SAVED)).toEqual({ censusStateFips: ["06"] });
    expect(resolvePlaceBoundaryMock).toHaveBeenCalledWith("aiannh", "1490R");
  });

  it("keeps a saved tribal area working when the Census Bureau does not answer", async () => {
    resolvePlaceBoundaryMock.mockRejectedValueOnce(new Error("tigerweb down"));
    expect(await crashStatesOfSavedTribalArea(SAVED)).toEqual({ censusStateFips: null });
    resolvePlaceBoundaryMock.mockResolvedValueOnce(null);
    expect(await crashStatesOfSavedTribalArea(SAVED)).toEqual({ censusStateFips: null });
    // An older boundary answer without the list reads as not read, never as a state.
    resolvePlaceBoundaryMock.mockResolvedValueOnce(tribalBoundary("1490R", undefined));
    expect(await crashStatesOfSavedTribalArea(SAVED)).toEqual({ censusStateFips: null });
  });

  it("does not read a state for a saved id the resolver would refuse", async () => {
    expect(await crashStatesOfSavedTribalArea({ ...SAVED, ref: "06023" })).toEqual({ censusStateFips: null });
    expect(resolvePlaceBoundaryMock).not.toHaveBeenCalled();
  });

  it("is not a tribal area for any other saved place, and asks nothing", async () => {
    expect(await crashStatesOfSavedTribalArea({ source: "tigerweb", kind: "county", ref: "06023" })).toBeNull();
    expect(await crashStatesOfSavedTribalArea({ source: "drawn", kind: null, ref: null })).toBeNull();
    expect(await crashStatesOfSavedTribalArea({ source: "drawn", kind: "aiannh", ref: "1490R" })).toBeNull();
    expect(await crashStatesOfSavedTribalArea({ source: null, kind: null, ref: null })).toBeNull();
    expect(resolvePlaceBoundaryMock).not.toHaveBeenCalled();
  });
});

describe("what is said about the crash file read for a tribal area", () => {
  const tribal = (censusStateFips: string[] | null, stateFileUsed: boolean) =>
    withCrashTribalArea(RECTANGLE, { censusStateFips, stateFileUsed });

  it("says crash reports may be missing when a state's file is read inside a tribal area", () => {
    expect(describeCrashTribalArea(tribal(["06"], true))).toBe(TRIBAL_AREA_STATE_FILE_SENTENCE);
    expect(describeCrashStudyArea(tribal(["06"], true))).toBe(`${RECTANGLE_SENTENCE} ${TRIBAL_AREA_STATE_FILE_SENTENCE}`);
  });

  it("does not say it when the national file is read inside a tribal area", () => {
    for (const states of [["32"], ["04", "35", "49"], [], null]) {
      expect(describeCrashStudyArea(tribal(states, false))).not.toContain(TRIBAL_AREA_STATE_FILE_SENTENCE);
    }
  });

  it("does not say it when a state's file is read for a place that is not a tribal area", () => {
    expect(describeCrashTribalArea(RECTANGLE)).toBeNull();
    expect(describeCrashStudyArea(RECTANGLE)).toBe(RECTANGLE_SENTENCE);
  });

  it("says why only the national file was read for several states, naming them", () => {
    expect(describeCrashTribalArea(tribal(["04", "35", "49"], false))).toBe(
      "The Census Bureau lists this tribal area, with its trust land, in more than one state (AZ, NM and UT), so only the national fatal-crash file was read."
    );
    expect(describeCrashTribalArea(tribal(["06", "32"], false))).toContain("(CA and NV)");
  });

  it("says why only the national file was read when no state is listed or the list was not read", () => {
    expect(describeCrashTribalArea(tribal([], false))).toBe(
      "The Census Bureau's record for this tribal area names no state, so only the national fatal-crash file was read."
    );
    expect(describeCrashTribalArea(tribal(null, false))).toBe(
      "The Census Bureau's record of the states this tribal area lies in could not be read when the crashes were retrieved, so only the national fatal-crash file was read. Retrieving again may reach a state's crash file."
    );
  });

  it("adds nothing for one state with no state crash file, the same as a county there", () => {
    expect(describeCrashTribalArea(tribal(["32"], false))).toBeNull();
    expect(describeCrashStudyArea(tribal(["32"], false))).toBe(RECTANGLE_SENTENCE);
  });

  it("claims no authority, completeness or agreement", () => {
    expect(TRIBAL_AREA_STATE_FILE_SENTENCE).not.toMatch(/jurisdiction|authority|complete|reported to|agreed|consent/i);
  });

  it("survives being stored on an acquisition and read back", () => {
    const stored = JSON.parse(JSON.stringify(withCrashStudyAreaCoverage({}, tribal(["06"], true))));
    expect(readCrashStudyAreaCoverage(stored)).toEqual(tribal(["06"], true));
    expect(readCrashStudyAreaCoverage(stored).tribalArea).toEqual({ censusStateFips: ["06"], stateFileUsed: true });
  });

  it("reads an acquisition stored before tribal areas were recorded exactly as before", () => {
    const stored = JSON.parse(JSON.stringify(withCrashStudyAreaCoverage({}, RECTANGLE)));
    const read = readCrashStudyAreaCoverage(stored);
    expect(read).toEqual(RECTANGLE);
    expect("tribalArea" in read).toBe(false);
    expect(describeCrashStudyArea(read)).toBe(RECTANGLE_SENTENCE);
  });

  it("does not print the state-file sentence from a stored entry that does not plainly say so", () => {
    const stored = { study_area: { ...RECTANGLE, tribalArea: { censusStateFips: ["6", 32], stateFileUsed: "yes" } } };
    expect(readCrashStudyAreaCoverage(stored).tribalArea).toEqual({ censusStateFips: null, stateFileUsed: false });
    expect(readCrashStudyAreaCoverage({ study_area: { ...RECTANGLE, tribalArea: "CA" } }).tribalArea).toBeUndefined();
  });
});

function record(overrides: Partial<CrashRecord> = {}): CrashRecord {
  return {
    externalId: "case-1",
    collisionDate: "2025-01-12",
    collisionYear: 2025,
    severity: "injury",
    killedCount: 0,
    injuredCount: 1,
    pedestrianInvolved: false,
    bicyclistInvolved: false,
    motorcyclistInvolved: false,
    collisionType: null,
    lighting: null,
    weather: null,
    sourceAttributes: {},
    latitude: 41.05,
    longitude: -123.65,
    ...overrides,
  };
}

function fetched(records: CrashRecord[]): CrashFetchResult {
  return { records, matchedTotal: records.length, geocodedTotal: records.length, yearsCovered: [2025], truncated: false };
}

/** A service-role stand-in that records the acquisition insert and finalize. */
function fakeService() {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  return {
    inserts,
    updates,
    from(table: string) {
      if (table === "safety_crash_ingests") {
        return {
          insert: (row: Record<string, unknown>) => {
            inserts.push(row);
            return { select: () => ({ single: async () => ({ data: { id: "ingest-1" }, error: null }) }) };
          },
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              updates.push(patch);
              return { error: null };
            },
          }),
        };
      }
      return {
        upsert: (rows: Record<string, unknown>[]) => ({
          select: async () => ({
            data: rows.map((row, index) => ({ id: `crash-${index}`, external_id: row.external_id })),
            error: null,
          }),
        }),
      };
    },
  };
}

describe("a crash acquisition for a tribal area", () => {
  afterEach(() => vi.restoreAllMocks());

  const acquire = (states: string[] | null, tribalStates: string[] | null | undefined) => {
    const service = fakeService();
    return ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "ws-1",
      bbox: BBOX,
      stateFips: states,
      ...(tribalStates === undefined ? {} : { tribalArea: { censusStateFips: tribalStates } }),
      years: [2025],
      enrichSeriousInjury: false,
      includeParties: false,
    }).then((result) => ({ result, service }));
  };

  it("reads the state's file for one state and stores the missing-reports sentence's facts", async () => {
    const ccrs = vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue(fetched([record()]));
    const fars = vi.spyOn(farsAdapter, "fetch").mockResolvedValue(fetched([]));
    const { result, service } = await acquire(["06"], ["06"]);

    expect(result.sourceId).toBe(ccrsAdapter.id);
    expect(ccrs).toHaveBeenCalledTimes(1);
    expect(fars).not.toHaveBeenCalled();
    expect(result.studyArea?.tribalArea).toEqual({ censusStateFips: ["06"], stateFileUsed: true });
    const stored = readCrashStudyAreaCoverage(service.updates.at(-1)?.dimension_coverage);
    expect(stored.tribalArea).toEqual({ censusStateFips: ["06"], stateFileUsed: true });
    expect(describeCrashStudyArea(stored)).toContain(TRIBAL_AREA_STATE_FILE_SENTENCE);
  });

  it("reads a different state's file for a tribal area in a different state", async () => {
    const ccrs = vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue(fetched([]));
    const oregon = vi.spyOn(odotOrAdapter, "fetch").mockResolvedValue(fetched([record()]));
    const { result } = await acquire(["41"], ["41"]);
    expect(result.sourceId).toBe(odotOrAdapter.id);
    expect(oregon).toHaveBeenCalledTimes(1);
    expect(ccrs).not.toHaveBeenCalled();
    expect(result.studyArea?.tribalArea).toEqual({ censusStateFips: ["41"], stateFileUsed: true });
  });

  it("reads only the national file for several states and stores why", async () => {
    const ccrs = vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue(fetched([record()]));
    const fars = vi.spyOn(farsAdapter, "fetch").mockResolvedValue(fetched([record({ severity: "fatal", killedCount: 1 })]));
    const states = crashStatesFromTribalAreaStates(["06", "32"]);
    const { result, service } = await acquire(states, ["06", "32"]);

    expect(result.sourceId).toBe(farsAdapter.id);
    expect(ccrs).not.toHaveBeenCalled();
    expect(fars).toHaveBeenCalledTimes(1);
    const stored = readCrashStudyAreaCoverage(service.updates.at(-1)?.dimension_coverage);
    expect(stored.tribalArea).toEqual({ censusStateFips: ["06", "32"], stateFileUsed: false });
    expect(describeCrashStudyArea(stored)).toContain("more than one state (CA and NV)");
    expect(describeCrashStudyArea(stored)).not.toContain(TRIBAL_AREA_STATE_FILE_SENTENCE);
  });

  it("does not store the state-file fact when the state has no state crash file", async () => {
    vi.spyOn(farsAdapter, "fetch").mockResolvedValue(fetched([]));
    const { result } = await acquire(["32"], ["32"]);
    expect(result.sourceId).toBe(farsAdapter.id);
    expect(result.studyArea?.tribalArea).toEqual({ censusStateFips: ["32"], stateFileUsed: false });
    expect(describeCrashTribalArea(result.studyArea as CrashStudyAreaCoverage)).toBeNull();
  });

  it("stores no tribal-area entry for a county read from the same state's file", async () => {
    vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue(fetched([record()]));
    const { result, service } = await acquire(["06"], undefined);
    expect(result.sourceId).toBe(ccrsAdapter.id);
    expect(result.studyArea && "tribalArea" in result.studyArea).toBe(false);
    const stored = readCrashStudyAreaCoverage(service.updates.at(-1)?.dimension_coverage);
    expect(describeCrashStudyArea(stored)).not.toContain(TRIBAL_AREA_STATE_FILE_SENTENCE);
  });

  it("reports a state file that fails as failed, never as zero crashes", async () => {
    vi.spyOn(ccrsAdapter, "fetch").mockRejectedValue(new Error("CCRS did not answer"));
    const { result } = await acquire(["06"], ["06"]);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("CCRS did not answer");
    expect(result.studyArea).toBeNull();
  });
});

describe("a corridor analysis whose corridor is a tribal area", () => {
  // A corridor analysis runs CCRS's serious-injury join after the fetch. Left
  // unstubbed it called the live CCRS service from a unit test, which hung
  // past the 20-second limit on CI once (main 532ea062d, November 16, 2026).
  // Any network call from here now fails the test instead of waiting on it.
  beforeEach(() => {
    vi.spyOn(ccrsAdapter, "enrichSeriousInjury" as never).mockImplementation((async ({
      records,
    }: {
      records: CrashRecord[];
    }) => ({ records, upgraded: 0 })) as never);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("a unit test reached the network");
      })
    );
  });
  afterEach(() => {
    // The join swallows a failed call, so a thrown fetch alone would not show.
    const reached = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    expect(reached).toBe(0);
  });
  const boundary = { geometry: SQUARE, source: "picked_place" as const };
  const NOW = new Date("2026-07-23T00:00:00Z");

  it("reads the state's file for one state and carries the missing-reports sentence", async () => {
    vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue(fetched([record()]));
    const summary = await fetchCrashesForStudyArea(
      { bbox: BBOX, stateFips: ["06"], boundary, tribalArea: { censusStateFips: ["06"] } },
      { now: NOW }
    );
    expect(summary.source).toBe(ccrsAdapter.id);
    expect(summary.studyArea?.tribalArea).toEqual({ censusStateFips: ["06"], stateFileUsed: true });
    expect(summary.narrativeLine).toContain(TRIBAL_AREA_STATE_FILE_SENTENCE);
  });

  it("reads only the national file for several states and says why", async () => {
    const ccrs = vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue(fetched([record()]));
    vi.spyOn(farsAdapter, "fetch").mockResolvedValue(fetched([]));
    const summary = await fetchCrashesForStudyArea(
      { bbox: BBOX, stateFips: ["06", "32"], boundary, tribalArea: { censusStateFips: ["06", "32"] } },
      { now: NOW }
    );
    expect(summary.source).toBe(farsAdapter.id);
    expect(ccrs).not.toHaveBeenCalled();
    expect(summary.narrativeLine).toContain("more than one state (CA and NV)");
    expect(summary.narrativeLine).not.toContain(TRIBAL_AREA_STATE_FILE_SENTENCE);
  });

  it("says nothing about tribal land for a county corridor read from the same file", async () => {
    vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue(fetched([record()]));
    const summary = await fetchCrashesForStudyArea({ bbox: BBOX, stateFips: ["06"], boundary }, { now: NOW });
    expect(summary.source).toBe(ccrsAdapter.id);
    expect(summary.narrativeLine).not.toContain("tribal");
  });
});

/**
 * The export. The ATP application's crash appendix prints the acquisition's
 * caveats, and the text here is what the built-in PDF tier extracts.
 *
 * Blind category: this reads the appendix text, not a rendered PDF page, and
 * only the ATP application. The SS4A appendix prints the same study-area
 * sentence from the same function and is not rendered here.
 */
describe("the ATP application's crash appendix for a tribal area", () => {
  const ALL = new Set<string>(ATP_APPENDIX_KEYS);
  const BOUNDARY_ENTRY = {
    basis: "place_boundary",
    boundarySource: "project_place",
    outsideBoundaryCount: 40,
    boundaryUnreadable: false,
    rectangleReportedCount: 174,
    rectangleMappableCount: 174,
    countsAreLowerBound: false,
  };

  function appendixText(rowOverrides: Record<string, unknown>): string {
    const records = { ...completeAtpRecords(), crash: { status: "ready" as const, evidence: atpCrashEvidence(rowOverrides), retrievedAt: "2026-11-02T15:00:00+00:00" } };
    const appendices = buildAtpEvidenceAppendices(records, ALL);
    const html = buildGrantApplicationHtml({
      opportunity: { id: ATP_IDS.opportunity, title: "ATP application", agency_name: null, summary: null, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
      programTitle: null, sections: [], attachments: [], generatedAt: "2026-11-02T18:30:00.000Z",
      evidenceAppendices: appendices, evidenceAppendixFrame: ATP_APPENDIX_FRAME,
    });
    return htmlToPdfBlocks(html).map((block) => ("text" in block ? block.text : JSON.stringify(block))).join("\n");
  }

  it("prints the missing-reports sentence when the state's file was read inside a tribal area", () => {
    const text = appendixText({
      dimension_coverage: { study_area: { ...BOUNDARY_ENTRY, tribalArea: { censusStateFips: ["06"], stateFileUsed: true } } },
    });
    expect(text).toContain("Appendix B. Crash summary");
    expect(text).toContain(TRIBAL_AREA_STATE_FILE_SENTENCE);
  });

  it("prints why only the national file was read for a several-state tribal area, and not the missing-reports sentence", () => {
    const text = appendixText({
      source_id: "fars-national",
      source_label: "FARS (national)",
      severity_completeness: "fatal_only",
      dimension_coverage: { study_area: { ...BOUNDARY_ENTRY, tribalArea: { censusStateFips: ["06", "32"], stateFileUsed: false } } },
    });
    expect(text).toContain("The Census Bureau lists this tribal area, with its trust land, in more than one state (CA and NV), so only the national fatal-crash file was read.");
    expect(text).not.toContain(TRIBAL_AREA_STATE_FILE_SENTENCE);
  });

  it("prints neither for an acquisition with no tribal-area entry", () => {
    const text = appendixText({ dimension_coverage: { study_area: BOUNDARY_ENTRY } });
    expect(text).toContain("Crashes are counted inside the place boundary.");
    expect(text).not.toContain("tribal");
  });
});
