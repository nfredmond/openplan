import { describe, expect, it, vi } from "vitest";
import { dedupeRecords, ingestCrashesForStudyArea, toCrashRows } from "@/lib/safety/ingest";
import type { CrashRecord } from "@/lib/safety/sources/types";

const CA_BBOX = { minLon: -121.3, minLat: 39.1, maxLon: -120.0, maxLat: 39.6 };
const OUT_OF_STATE_BBOX = { minLon: -83.2, minLat: 42.2, maxLon: -83.0, maxLat: 42.4 };

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
    latitude: 39.2,
    longitude: -121.0,
    ...overrides,
  };
}

/** Minimal stand-in for the service-role client's chained query builders. */
function fakeService(options: { captureUpserts?: unknown[][]; updates?: Record<string, unknown>[] } = {}) {
  const upserts = options.captureUpserts ?? [];
  const updates = options.updates ?? [];
  return {
    upserts,
    updates,
    from(table: string) {
      if (table === "safety_crash_ingests") {
        return {
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => ({ data: { id: "ingest-1", ...row }, error: null }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              updates.push(patch);
              return { error: null };
            },
          }),
        };
      }
      return {
        upsert: async (rows: unknown[]) => {
          upserts.push(rows);
          return { error: null };
        },
      };
    },
  };
}

describe("dedupeRecords", () => {
  it("collapses repeated case ids within one fetch", () => {
    // Postgres rejects an ON CONFLICT batch containing the same key twice, and a
    // source paging across years can legitimately repeat a case id.
    const deduped = dedupeRecords([
      record({ externalId: "a" }),
      record({ externalId: "b" }),
      record({ externalId: "a" }),
    ]);
    expect(deduped.map((r) => r.externalId)).toEqual(["a", "b"]);
  });

  it("preserves order and returns an empty array unchanged", () => {
    expect(dedupeRecords([])).toEqual([]);
  });
});

describe("toCrashRows", () => {
  it("maps every record field onto its column", () => {
    const rows = toCrashRows([record({ severity: "fatal", killedCount: 2, pedestrianInvolved: true })], {
      workspaceId: "ws-1",
      ingestId: "ingest-1",
      sourceId: "ccrs-ca",
    });

    expect(rows[0]).toEqual({
      workspace_id: "ws-1",
      ingest_id: "ingest-1",
      source_id: "ccrs-ca",
      external_id: "case-1",
      collision_date: "2025-01-12",
      collision_year: 2025,
      severity: "fatal",
      killed_count: 2,
      injured_count: 1,
      pedestrian_involved: true,
      bicyclist_involved: false,
      latitude: 39.2,
      longitude: -121.0,
    });
  });
});

describe("ingestCrashesForStudyArea", () => {
  it("records no_coverage instead of returning an unexplained empty result", async () => {
    const service = fakeService();
    const result = await ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "ws-1",
      bbox: OUT_OF_STATE_BBOX,
      years: [2025],
    });

    expect(result.status).toBe("no_coverage");
    expect(result.coverageState).toBe("out_of_coverage");
    expect(result.sourceId).toBeNull();
    expect(result.crashCount).toBe(0);
    // Nothing was fabricated to fill the gap.
    expect(service.upserts).toHaveLength(0);
  });

  it("persists observed crashes and finalizes with reported-vs-mappable counts", async () => {
    const service = fakeService();
    const { ccrsAdapter } = await import("@/lib/safety/sources/ccrs");
    const fetchSpy = vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue({
      records: [record({ externalId: "a" }), record({ externalId: "b" })],
      matchedTotal: 1180,
      geocodedTotal: 1089,
      yearsCovered: [2025],
      truncated: false,
    });

    const result = await ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "ws-1",
      bbox: CA_BBOX,
      years: [2025],
      countyCode: 29,
    });

    expect(result.status).toBe("ready");
    expect(result.sourceId).toBe("ccrs-ca");
    expect(result.crashCount).toBe(1180);
    expect(result.geocodedCount).toBe(1089);
    expect(result.storedCount).toBe(2);
    expect(service.upserts.flat()).toHaveLength(2);

    const finalUpdate = service.updates.at(-1);
    expect(finalUpdate).toMatchObject({
      status: "ready",
      crash_count: 1180,
      geocoded_count: 1089,
    });

    fetchSpy.mockRestore();
  });

  it("records a source outage honestly rather than synthesizing numbers", async () => {
    const service = fakeService();
    const { ccrsAdapter } = await import("@/lib/safety/sources/ccrs");
    const fetchSpy = vi
      .spyOn(ccrsAdapter, "fetch")
      .mockRejectedValue(new Error("data.ca.gov unreachable"));

    const result = await ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "ws-1",
      bbox: CA_BBOX,
      years: [2025],
    });

    expect(result.status).toBe("failed");
    expect(result.coverageState).toBe("source_unavailable");
    expect(result.crashCount).toBe(0);
    expect(result.error).toContain("unreachable");
    expect(service.updates.at(-1)).toMatchObject({
      status: "failed",
      coverage_state: "source_unavailable",
    });
    expect(service.upserts).toHaveLength(0);

    fetchSpy.mockRestore();
  });

  it("upserts on the natural key so re-ingest cannot duplicate rows", async () => {
    const upsertArgs: unknown[][] = [];
    const service = {
      from(table: string) {
        if (table === "safety_crash_ingests") {
          return {
            insert: () => ({ select: () => ({ single: async () => ({ data: { id: "i" }, error: null }) }) }),
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        return {
          upsert: async (rows: unknown[], opts: unknown) => {
            upsertArgs.push([rows, opts]);
            return { error: null };
          },
        };
      },
    };

    const { ccrsAdapter } = await import("@/lib/safety/sources/ccrs");
    const fetchSpy = vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue({
      records: [record()],
      matchedTotal: 1,
      geocodedTotal: 1,
      yearsCovered: [2025],
      truncated: false,
    });

    await ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "ws-1",
      bbox: CA_BBOX,
      years: [2025],
    });

    expect(upsertArgs[0][1]).toMatchObject({ onConflict: "workspace_id,source_id,external_id" });
    fetchSpy.mockRestore();
  });
});
