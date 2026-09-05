import { describe, expect, it, vi } from "vitest";
import { ingestCrashesForStudyArea } from "@/lib/safety/ingest";
import { farsAdapter, FARS_SOURCE_ID } from "@/lib/safety/sources/fars";
import { CRASH_SOURCE_ADAPTERS } from "@/lib/safety/sources/registry";
import { globalProbeGrid } from "./helpers/crash-coverage-probe";

/** A registry-derived area where FARS, rather than a richer regional source, is primary. */
function farsPrimaryStudyArea() {
  const area = globalProbeGrid().find((bbox) =>
    farsAdapter.covers(bbox)
    && CRASH_SOURCE_ADAPTERS.filter((adapter) => adapter.id !== FARS_SOURCE_ID)
      .every((adapter) => !adapter.covers(bbox))
  );
  expect(area, "no study area resolves primarily to the national source").toBeDefined();
  return area!;
}

function recordingService() {
  const inserts: Record<string, unknown>[] = [];
  const upserts: Record<string, unknown>[][] = [];
  const updates: Record<string, unknown>[] = [];
  return {
    inserts,
    upserts,
    updates,
    from(table: string) {
      if (table === "safety_crash_ingests") {
        return {
          insert: (row: Record<string, unknown>) => {
            inserts.push(row);
            return {
              select: () => ({ single: async () => ({ data: { id: "ingest-fars-1" }, error: null }) }),
            };
          },
          update: (row: Record<string, unknown>) => {
            updates.push(row);
            return { eq: async () => ({ error: null }) };
          },
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

describe("national observed crashes use the existing persisted ingest", () => {
  it("retains update metadata on the existing ingest without writing a coverage date", async () => {
    const service = recordingService();
    const updates = {
      basis: "resource_updates" as const,
      sourceUrl: "https://example.org/crash-files",
      label: "Source file updates",
      retrievedAt: "2026-09-05T00:00:00Z",
      resources: [{ resourceId: "annual", year: 2024, lastModified: null }],
    };
    const spy = vi.spyOn(farsAdapter, "fetch").mockResolvedValue({
      records: [], matchedTotal: 0, geocodedTotal: 0, yearsCovered: [], truncated: false, resourceUpdates: updates,
    });
    try {
      const result = await ingestCrashesForStudyArea({ service: service as never, workspaceId: "workspace-1", bbox: farsPrimaryStudyArea(), years: [2024], includeParties: false });
      expect(result.publishedThrough).toBeUndefined();
      expect(result.publishedThroughProvenance).toEqual(updates);
      expect(service.updates).toContainEqual(expect.objectContaining({ published_through: null, published_through_provenance: updates }));
    } finally {
      spy.mockRestore();
    }
  });

  it("stores FARS crashes, exact source custody, and the requested project link", async () => {
    const service = recordingService();
    const bbox = farsPrimaryStudyArea();
    const fetchSpy = vi.spyOn(farsAdapter, "fetch").mockResolvedValue({
      records: [{
        externalId: "2024-1001",
        collisionDate: "2024-04-05",
        collisionYear: 2024,
        severity: "fatal",
        killedCount: 1,
        injuredCount: null,
        pedestrianInvolved: true,
        bicyclistInvolved: false,
        motorcyclistInvolved: false,
        collisionType: null,
        lighting: null,
        weather: null,
        sourceAttributes: { stateFips: "99" },
        latitude: bbox.minLat + 0.25,
        longitude: bbox.minLon + 0.25,
      }],
      matchedTotal: 1,
      geocodedTotal: 1,
      yearsCovered: [2024],
      truncated: false,
      publishedCutoff: {
        publishedThrough: "2024-12-31",
        provenance: {
          basis: "source_metadata",
          sourceUrl: "https://example.invalid/release",
          label: "Example final annual release",
          retrievedAt: "2026-09-04T00:00:00.000Z",
        },
      },
    });

    const result = await ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "workspace-1",
      projectId: "project-1",
      bbox,
      years: [2024],
      includeParties: false,
    });

    expect(result).toMatchObject({
      status: "ready",
      sourceId: FARS_SOURCE_ID,
      stored: true,
      ingestId: "ingest-fars-1",
      severityCompleteness: "fatal_only",
      crashCount: 1,
      geocodedCount: 1,
    });
    expect(service.inserts).toContainEqual(expect.objectContaining({
      project_id: "project-1",
      source_id: FARS_SOURCE_ID,
      coverage_state: "fars_fatal_only",
      min_lon: bbox.minLon,
      max_lon: bbox.maxLon,
    }));
    expect(service.upserts.flat()).toContainEqual(expect.objectContaining({
      ingest_id: "ingest-fars-1",
      source_id: FARS_SOURCE_ID,
      severity: "fatal",
      injured_count: null,
    }));
    expect(service.upserts).toHaveLength(1);
    expect(service.updates).toContainEqual(expect.objectContaining({
      status: "ready",
      published_through: "2024-12-31",
    }));

    fetchSpy.mockRestore();
  });
});
