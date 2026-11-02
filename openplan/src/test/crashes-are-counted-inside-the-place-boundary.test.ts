/**
 * KI-2026-11-02-021: crashes are counted inside the place, not inside the
 * rectangle around it.
 *
 * The fixtures are recorded, not invented. Alturas is TIGERweb's incorporated
 * place 0601444 with the 11 CCRS crashes (2022 to 2025) its rectangle returned
 * on November 1, 2026, each classified by TIGERweb's own point identify. The
 * Navajo Nation boundary is TIGERweb's 2430R, simplified by TIGERweb, with the
 * Hopi Reservation as a hole. The expected answers come from TIGERweb, not from
 * the code under test.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/safety/crash-study-area-boundaries.json";
import {
  boundaryAreaSquareMiles,
  clipCrashRecordsToBoundary,
  crashAreaBasisLabel,
  crashCountsForStudyArea,
  describeCrashStudyArea,
  readCrashStudyAreaCoverage,
} from "@/lib/safety/crash-study-area";
import { ingestCrashesForStudyArea } from "@/lib/safety/ingest";
import { buildSafetyCrashEvidence, type SafetyCrashEvidenceIngest } from "@/lib/safety/crash-evidence";
import { summarizeCrashFetch } from "@/lib/data-sources/crashes";
import type { CrashRecord } from "@/lib/safety/sources/types";

const ALTURAS_BBOX = fixture.alturas.bbox;
const NAVAJO_BBOX = fixture.navajo.bbox;

function record(overrides: Partial<CrashRecord> = {}): CrashRecord {
  return {
    externalId: "case-1",
    collisionDate: "2025-01-12",
    collisionYear: 2025,
    severity: "pdo",
    killedCount: 0,
    injuredCount: 0,
    pedestrianInvolved: false,
    bicyclistInvolved: false,
    motorcyclistInvolved: false,
    collisionType: null,
    lighting: null,
    weather: null,
    sourceAttributes: {},
    latitude: 0,
    longitude: 0,
    ...overrides,
  };
}

const ALTURAS_RECORDS: CrashRecord[] = fixture.alturas.crashes.map((crash) =>
  record({
    externalId: crash.collisionId,
    collisionDate: crash.collisionDate,
    collisionYear: Number(crash.collisionDate.slice(0, 4)),
    severity: crash.killed > 0 ? "fatal" : crash.injured > 0 ? "injury" : "pdo",
    killedCount: crash.killed,
    injuredCount: crash.injured,
    latitude: crash.latitude,
    longitude: crash.longitude,
  })
);

describe("clipCrashRecordsToBoundary", () => {
  it("keeps the Alturas crashes TIGERweb places inside the city and leaves the other 9 out", () => {
    const result = clipCrashRecordsToBoundary(ALTURAS_RECORDS, ALTURAS_BBOX, {
      geometry: fixture.alturas.geometry,
      source: "project_place",
    });

    const expectedInside = fixture.alturas.crashes.filter((crash) => crash.insideCityPerTigerweb).map((crash) => crash.collisionId);
    expect(expectedInside).toHaveLength(2);
    expect(result.records.map((kept) => kept.externalId).sort()).toEqual([...expectedInside].sort());
    expect(result.studyArea).toEqual({
      basis: "place_boundary",
      boundarySource: "project_place",
      outsideBoundaryCount: 9,
      boundaryUnreadable: false,
      rectangleReportedCount: null,
      rectangleMappableCount: null,
      countsAreLowerBound: false,
    });
    // The only injury crash in the rectangle is outside the city limits.
    expect(result.records.some((kept) => kept.severity === "injury")).toBe(false);
  });

  it("keeps Navajo Nation towns, leaves out Flagstaff, Gallup, Farmington and the Hopi hole", () => {
    const records = fixture.navajo.points.map((point, index) =>
      record({ externalId: `n-${index}`, latitude: point.latitude, longitude: point.longitude })
    );
    const result = clipCrashRecordsToBoundary(records, NAVAJO_BBOX, {
      geometry: fixture.navajo.geometry,
      source: "picked_place",
    });

    const kept = new Set(result.records.map((entry) => entry.externalId));
    for (const [index, point] of fixture.navajo.points.entries()) {
      expect({ name: point.name, inside: kept.has(`n-${index}`) }).toEqual({ name: point.name, inside: point.insideReservation });
    }
    expect(result.studyArea.outsideBoundaryCount).toBe(4);
    expect(fixture.navajo.geometry.type).toBe("MultiPolygon");
  });

  it("counts a crash on the boundary line, a vertex, or a hole's edge as inside; a concave notch and a hole as outside", () => {
    // A U shape around a notch, with a square hole in its west arm.
    const shape = {
      type: "Polygon",
      coordinates: [
        [[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3], [0, 0]],
        [[0.2, 1.5], [0.6, 1.5], [0.6, 2.5], [0.2, 2.5], [0.2, 1.5]],
      ],
    };
    const bbox = { minLon: 0, minLat: 0, maxLon: 3, maxLat: 3 };
    const points: Array<[string, number, number, boolean]> = [
      ["edge", 1.5, 0, true],
      ["vertex", 2, 1, true],
      ["hole edge", 0.4, 1.5, true],
      ["arm", 2.5, 2, true],
      ["notch", 1.5, 2, false],
      ["hole", 0.4, 2, false],
    ];
    const result = clipCrashRecordsToBoundary(
      points.map(([id, lon, lat]) => record({ externalId: id, longitude: lon, latitude: lat })),
      bbox,
      { geometry: shape, source: "drawn_area" }
    );
    expect(result.records.map((kept) => kept.externalId)).toEqual(points.filter((point) => point[3]).map((point) => point[0]));
    expect(result.studyArea.outsideBoundaryCount).toBe(2);
  });

  it("keeps every crash on the rectangle when no polygon is known, and says so", () => {
    const result = clipCrashRecordsToBoundary(ALTURAS_RECORDS, ALTURAS_BBOX, null);
    expect(result.records).toHaveLength(11);
    expect(result.studyArea).toEqual({
      basis: "bounding_rectangle",
      boundarySource: null,
      outsideBoundaryCount: null,
      boundaryUnreadable: false,
      rectangleReportedCount: null,
      rectangleMappableCount: null,
      countsAreLowerBound: false,
    });
  });

  it("falls back to the rectangle, flagged, when the boundary cannot be read", () => {
    const result = clipCrashRecordsToBoundary(ALTURAS_RECORDS, ALTURAS_BBOX, {
      geometry: { type: "LineString", coordinates: [[-120.57, 41.47], [-120.53, 41.5]] },
      source: "drawn_area",
    });
    expect(result.records).toHaveLength(11);
    expect(result.studyArea.basis).toBe("bounding_rectangle");
    expect(result.studyArea.boundaryUnreadable).toBe(true);
  });
});

/**
 * Codex P2 on PR #416: with retrieval cut short, the crashes found outside cover
 * only retrieved records, so subtracting them from the rectangle total counts
 * every unretrieved crash as inside. Rectangle 100, cap 1, the one retrieved
 * crash outside: the boundary count is 0 and marked a lower bound, never 99.
 */
const ONE_OUTSIDE = record({ externalId: "outside-1", latitude: fixture.alturas.crashes[1].latitude, longitude: fixture.alturas.crashes[1].longitude });
const ALTURAS_BOUNDARY = { geometry: fixture.alturas.geometry, source: "project_place" as const };

describe("a truncated retrieval with a boundary (rectangle 100, cap 1, the one retrieved crash outside)", () => {
  it("counts the retrieved crashes inside, marks a lower bound and keeps the rectangle totals apart", () => {
    const clipped = clipCrashRecordsToBoundary([ONE_OUTSIDE], ALTURAS_BBOX, ALTURAS_BOUNDARY);
    const counts = crashCountsForStudyArea(clipped, { matchedTotal: 100, geocodedTotal: 100, truncated: true, retrievedCount: 1 });
    expect(counts.reported).toBe(0);
    expect(counts.mappable).toBe(0);
    expect(counts.studyArea).toMatchObject({
      outsideBoundaryCount: 1,
      rectangleReportedCount: 100,
      rectangleMappableCount: 100,
      countsAreLowerBound: true,
    });
  });

  it("treats fewer retrieved records than the source counts as cut short, even without the flag", () => {
    const clipped = clipCrashRecordsToBoundary([ONE_OUTSIDE], ALTURAS_BBOX, ALTURAS_BOUNDARY);
    const counts = crashCountsForStudyArea(clipped, { matchedTotal: 100, geocodedTotal: 100, truncated: false, retrievedCount: 1 });
    expect(counts.reported).toBe(0);
    expect(counts.studyArea.countsAreLowerBound).toBe(true);
  });

  it("says the counts are a lower bound and names the rectangle total", () => {
    const clipped = clipCrashRecordsToBoundary([ONE_OUTSIDE], ALTURAS_BBOX, ALTURAS_BOUNDARY);
    const { studyArea } = crashCountsForStudyArea(clipped, { matchedTotal: 100, geocodedTotal: 100, truncated: true, retrievedCount: 1 });
    expect(describeCrashStudyArea(studyArea)).toBe(
      "Crashes are counted inside the place boundary. Retrieval stopped before every crash in its bounding rectangle came back, so these counts are a lower bound made only of retrieved crashes inside the boundary. 1 crash retrieved outside the boundary is left out. Crashes not retrieved were not checked against the boundary. The source reports 100 crashes in the bounding rectangle."
    );
  });

  it("stores 0, not 99, on the acquisition", async () => {
    const { ccrsAdapter } = await import("@/lib/safety/sources/ccrs");
    const spy = vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue({
      records: [ONE_OUTSIDE], matchedTotal: 100, geocodedTotal: 100, yearsCovered: [2025], truncated: true,
    });
    const service = fakeService();
    try {
      const result = await ingestCrashesForStudyArea({
        service: service as never, workspaceId: "ws-1", bbox: ALTURAS_BBOX, stateFips: ["06"], years: [2025],
        boundary: ALTURAS_BOUNDARY, maxRecords: 1, enrichSeriousInjury: false, includeParties: false,
      });
      expect(result.crashCount).toBe(0);
      expect(result.geocodedCount).toBe(0);
      expect(service.updates.at(-1)).toMatchObject({
        crash_count: 0,
        geocoded_count: 0,
        stored_count: 0,
        truncated: true,
        dimension_coverage: expect.objectContaining({
          study_area: expect.objectContaining({ rectangleReportedCount: 100, countsAreLowerBound: true }),
        }),
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("returns 0, not 99, from a live read", async () => {
    const { farsAdapter } = await import("@/lib/safety/sources/fars");
    const persistable = farsAdapter.persistable;
    farsAdapter.persistable = false;
    const spy = vi.spyOn(farsAdapter, "fetch").mockResolvedValue({
      records: [{ ...ONE_OUTSIDE, severity: "fatal", killedCount: 1 }], matchedTotal: 100, geocodedTotal: 100, yearsCovered: [2023], truncated: true,
    });
    try {
      const result = await ingestCrashesForStudyArea({
        service: fakeService() as never, workspaceId: "ws-1", bbox: ALTURAS_BBOX, stateFips: null, years: [2023],
        boundary: ALTURAS_BOUNDARY, maxRecords: 1,
      });
      expect(result.status).toBe("read_only");
      expect(result.crashCount).toBe(0);
      expect(result.geocodedCount).toBe(0);
      expect(result.studyArea?.countsAreLowerBound).toBe(true);
    } finally {
      spy.mockRestore();
      farsAdapter.persistable = persistable;
    }
  });

  it("gives the corridor scorecard 0, not 99", async () => {
    const { ccrsAdapter } = await import("@/lib/safety/sources/ccrs");
    const summary = summarizeCrashFetch(
      ccrsAdapter,
      { records: [ONE_OUTSIDE], matchedTotal: 100, geocodedTotal: 100, yearsCovered: [2025], truncated: true },
      ALTURAS_BBOX,
      [2025],
      ALTURAS_BOUNDARY
    );
    expect(summary.reportedTotal).toBe(0);
    expect(summary.mappedTotal).toBe(0);
    expect(summary.studyArea?.countsAreLowerBound).toBe(true);
  });
});

describe("the study-area entry and its sentences", () => {
  it("reads an acquisition with no entry as counted by rectangle, never as the boundary", () => {
    expect(readCrashStudyAreaCoverage(null).basis).toBe("bounding_rectangle");
    expect(readCrashStudyAreaCoverage({ severity: { support: "supplied" } }).basis).toBe("bounding_rectangle");
    expect(readCrashStudyAreaCoverage({ study_area: { basis: "place_boundary" } }).basis).toBe("bounding_rectangle");
    expect(
      readCrashStudyAreaCoverage({
        study_area: { basis: "place_boundary", boundarySource: "picked_place", outsideBoundaryCount: 3, boundaryUnreadable: false, rectangleReportedCount: 11, rectangleMappableCount: 11, countsAreLowerBound: false },
      })
    ).toEqual({ basis: "place_boundary", boundarySource: "picked_place", outsideBoundaryCount: 3, boundaryUnreadable: false, rectangleReportedCount: 11, rectangleMappableCount: 11, countsAreLowerBound: false });
  });

  it("reads a boundary entry with no completeness flag as a lower bound, never as complete", () => {
    const entry = readCrashStudyAreaCoverage({
      study_area: { basis: "place_boundary", boundarySource: "picked_place", outsideBoundaryCount: 3, boundaryUnreadable: false },
    });
    expect(entry.countsAreLowerBound).toBe(true);
  });

  it("names the rectangle as not the place boundary", () => {
    const rectangle = readCrashStudyAreaCoverage(null);
    expect(crashAreaBasisLabel(rectangle)).toBe("Bounding rectangle, not the place boundary");
    expect(describeCrashStudyArea(rectangle)).toBe(
      "Crashes are counted inside the study area's bounding rectangle, not the place boundary, so these counts can include crashes outside the place."
    );
  });

  it("says how many crashes the boundary left out", () => {
    const boundary = { basis: "place_boundary" as const, boundarySource: "project_place" as const, outsideBoundaryCount: 9, boundaryUnreadable: false, rectangleReportedCount: 11, rectangleMappableCount: 11, countsAreLowerBound: false };
    expect(describeCrashStudyArea(boundary)).toBe(
      "Crashes are counted inside the place boundary. 9 crashes inside its bounding rectangle but outside the boundary are left out."
    );
  });

  it("measures the boundary's own area, smaller than its rectangle", () => {
    const area = boundaryAreaSquareMiles(fixture.alturas.geometry) ?? 0;
    // TIGERweb's own land plus water area for the place, in square miles.
    const recorded = (fixture.alturas.areaSquareMetres.land + fixture.alturas.areaSquareMetres.water) / 2_589_988.11;
    expect(Math.abs(area - recorded) / recorded).toBeLessThan(0.03);
    const box = ALTURAS_BBOX;
    const rectangle = (box.maxLat - box.minLat) * 69 * (box.maxLon - box.minLon) * 69 * Math.cos((((box.minLat + box.maxLat) / 2) * Math.PI) / 180);
    expect(area).toBeLessThan(rectangle);
  });
});

/** A service-role stand-in that records the acquisition insert and finalize. */
function fakeService() {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const upserts: Array<Record<string, unknown>[]> = [];
  return {
    inserts,
    updates,
    upserts,
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
        upsert: (rows: Record<string, unknown>[]) => {
          upserts.push(rows);
          return {
            select: async () => ({
              data: rows.map((row, index) => ({ id: `crash-${index}`, external_id: row.external_id })),
              error: null,
            }),
          };
        },
      };
    },
  };
}

describe("ingestCrashesForStudyArea with a boundary", () => {
  it("stores only the crashes inside the boundary and records what was left out", async () => {
    const { ccrsAdapter } = await import("@/lib/safety/sources/ccrs");
    const spy = vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue({
      records: ALTURAS_RECORDS,
      matchedTotal: 11,
      geocodedTotal: 11,
      yearsCovered: [2022, 2023, 2024, 2025],
      truncated: false,
    });
    const service = fakeService();
    try {
      const result = await ingestCrashesForStudyArea({
        service: service as never,
        workspaceId: "ws-1",
        bbox: ALTURAS_BBOX,
        stateFips: ["06"],
        years: [2025, 2024, 2023, 2022],
        boundary: { geometry: fixture.alturas.geometry, source: "project_place" },
        enrichSeriousInjury: false,
        includeParties: false,
      });

      expect(result.status).toBe("ready");
      expect(result.crashCount).toBe(2);
      expect(result.geocodedCount).toBe(2);
      expect(result.storedCount).toBe(2);
      expect(service.upserts.flat().map((row) => row.external_id).sort()).toEqual(["1941222", "4631291"]);
      expect(service.inserts[0].geometry_geojson).toEqual(fixture.alturas.geometry);
      expect(service.updates.at(-1)).toMatchObject({
        status: "ready",
        crash_count: 2,
        geocoded_count: 2,
        stored_count: 2,
        dimension_coverage: expect.objectContaining({
          study_area: { basis: "place_boundary", boundarySource: "project_place", outsideBoundaryCount: 9, boundaryUnreadable: false, rectangleReportedCount: 11, rectangleMappableCount: 11, countsAreLowerBound: false },
        }),
      });
      expect(result.studyArea?.countsAreLowerBound).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("stores every crash and records the rectangle when no polygon is known", async () => {
    const { ccrsAdapter } = await import("@/lib/safety/sources/ccrs");
    const spy = vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue({
      records: ALTURAS_RECORDS,
      matchedTotal: 11,
      geocodedTotal: 11,
      yearsCovered: [2022, 2023, 2024, 2025],
      truncated: false,
    });
    const service = fakeService();
    try {
      const result = await ingestCrashesForStudyArea({
        service: service as never,
        workspaceId: "ws-1",
        bbox: ALTURAS_BBOX,
        stateFips: ["06"],
        years: [2025],
        enrichSeriousInjury: false,
        includeParties: false,
      });
      expect(result.storedCount).toBe(11);
      expect(result.crashCount).toBe(11);
      expect(service.inserts[0]).not.toHaveProperty("geometry_geojson");
      expect(service.updates.at(-1)?.dimension_coverage).toMatchObject({
        study_area: { basis: "bounding_rectangle", boundarySource: null, outsideBoundaryCount: null },
      });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("a live read with a boundary", () => {
  let farsPersistable = true;
  beforeAll(async () => {
    const { farsAdapter } = await import("@/lib/safety/sources/fars");
    farsPersistable = farsAdapter.persistable;
    // Exercise the read-only lane, as `safety-read-only-lane.test.ts` does.
    farsAdapter.persistable = false;
  });
  afterAll(async () => {
    const { farsAdapter } = await import("@/lib/safety/sources/fars");
    farsAdapter.persistable = farsPersistable;
  });

  it("returns only the points inside a tribal boundary and counts the rest as left out", async () => {
    const { farsAdapter } = await import("@/lib/safety/sources/fars");
    const records = fixture.navajo.points.map((point, index) =>
      record({ externalId: `n-${index}`, severity: "fatal", killedCount: 1, latitude: point.latitude, longitude: point.longitude })
    );
    const spy = vi.spyOn(farsAdapter, "fetch").mockResolvedValue({
      records,
      matchedTotal: records.length,
      geocodedTotal: records.length,
      yearsCovered: [2023],
      truncated: false,
    });
    const service = fakeService();
    try {
      const result = await ingestCrashesForStudyArea({
        service: service as never,
        workspaceId: "ws-1",
        bbox: NAVAJO_BBOX,
        stateFips: null,
        years: [2023],
        boundary: { geometry: fixture.navajo.geometry, source: "picked_place" },
      });
      expect(result.status).toBe("read_only");
      expect(result.crashCount).toBe(4);
      expect(result.crashes?.features).toHaveLength(4);
      expect(result.studyArea?.outsideBoundaryCount).toBe(4);
      expect(service.inserts).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});

function evidenceIngest(dimensionCoverage: unknown): SafetyCrashEvidenceIngest {
  return {
    id: "ingest-1",
    projectId: "project-1",
    status: "ready",
    sourceLabel: "CCRS",
    attribution: null,
    severityCompleteness: "kabco_full",
    crashCount: 2,
    geocodedCount: 2,
    storedCount: 2,
    truncated: false,
    yearsRequested: [2022, 2023, 2024, 2025],
    createdAt: "2026-11-01T00:00:00Z",
    dimensionCoverage,
    partyCompleteness: "not_retrieved",
    partyCount: null,
    involvementBasis: null,
  };
}

describe("the crash evidence every report and packet prints", () => {
  const severity = { fatal: 0, severe_injury: 0, injury: 0, pdo: 2, unknown: 0 };

  it("discloses a rectangle-counted acquisition, including every acquisition stored before the check", () => {
    const evidence = buildSafetyCrashEvidence(evidenceIngest({}), { severity, role: null });
    expect(evidence.caveats).toContain(
      "Crashes are counted inside the study area's bounding rectangle, not the place boundary, so these counts can include crashes outside the place."
    );
    expect(evidence.studyArea.basis).toBe("bounding_rectangle");
  });

  it("names the boundary and the crashes it left out", () => {
    const evidence = buildSafetyCrashEvidence(
      evidenceIngest({ study_area: { basis: "place_boundary", boundarySource: "project_place", outsideBoundaryCount: 9, boundaryUnreadable: false, rectangleReportedCount: 11, rectangleMappableCount: 11, countsAreLowerBound: false } }),
      { severity, role: null }
    );
    expect(evidence.caveats).toContain(
      "Crashes are counted inside the place boundary. 9 crashes inside its bounding rectangle but outside the boundary are left out."
    );
    expect(evidence.caveats.join(" ")).not.toContain("not the place boundary");
  });
});

describe("the corridor scorecard", () => {
  it("tallies only crashes inside the corridor polygon and divides by the polygon's area", async () => {
    const { ccrsAdapter } = await import("@/lib/safety/sources/ccrs");
    const fetched = { records: ALTURAS_RECORDS, matchedTotal: 11, geocodedTotal: 11, yearsCovered: [2022, 2023, 2024, 2025], yearsQueried: [2022, 2023, 2024, 2025], truncated: false };
    const clipped = summarizeCrashFetch(ccrsAdapter, fetched, ALTURAS_BBOX, [2022, 2023, 2024, 2025], {
      geometry: fixture.alturas.geometry,
      source: "picked_place",
    });
    const rectangle = summarizeCrashFetch(ccrsAdapter, fetched, ALTURAS_BBOX, [2022, 2023, 2024, 2025]);

    expect(clipped.reportedTotal).toBe(2);
    expect(clipped.totalInjuryCrashes).toBe(0);
    expect(rectangle.totalInjuryCrashes).toBe(1);
    expect(clipped.studyArea?.outsideBoundaryCount).toBe(9);
    expect(rectangle.studyArea).toBeUndefined();

    // Density divides by the polygon's area, not the rectangle's.
    const injured = { ...fetched, records: ALTURAS_RECORDS.map((entry) => ({ ...entry, severity: "injury" as const, injuredCount: 1 })) };
    const dense = summarizeCrashFetch(ccrsAdapter, injured, ALTURAS_BBOX, [2022, 2023, 2024, 2025], {
      geometry: fixture.alturas.geometry,
      source: "picked_place",
    });
    const polygonArea = boundaryAreaSquareMiles(fixture.alturas.geometry) ?? 0;
    expect(dense.crashesPerSquareMile).toBe(Math.round((2 / 4 / polygonArea) * 10) / 10);
  });
});
