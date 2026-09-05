import { describe, expect, it, vi } from "vitest";
import { dedupeRecords, ingestCrashesForStudyArea, toCrashRows } from "@/lib/safety/ingest";
import type { CrashRecord } from "@/lib/safety/sources/types";
import { findUncoveredStudyArea } from "./helpers/crash-coverage-probe";

const CA_BBOX = { minLon: -121.3, minLat: 39.1, maxLon: -120.0, maxLat: 39.6 };

/**
 * A study area NO registered adapter covers, found from the registry itself.
 *
 * This used to be a hardcoded out-of-STATE rectangle, which stopped meaning
 * "no coverage" the moment the national read-only lane was wired: a registered
 * adapter covers it, so the ingest now serves crashes there instead of
 * reporting a gap. That behaviour is the point, and it is proved in
 * `safety-read-only-lane.test.ts`; this file keeps only the genuine-gap case.
 */
const UNCOVERED_BBOX = findUncoveredStudyArea()!;

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
    collisionType: "rear_end",
    lighting: "daylight",
    weather: "clear",
    sourceAttributes: {},
    latitude: 39.2,
    longitude: -121.0,
    ...overrides,
  };
}

/** Minimal stand-in for the service-role client's chained query builders. */
function fakeService(
  options: {
    captureUpserts?: unknown[][];
    updates?: Record<string, unknown>[];
    /** Make the person-row write fail, to prove the acquisition survives it. */
    partyError?: boolean;
    finalizeError?: boolean;
  } = {}
) {
  const upserts = options.captureUpserts ?? [];
  const updates = options.updates ?? [];
  const partyUpserts: unknown[][] = [];
  const upsertOptions: unknown[] = [];
  return {
    upserts,
    updates,
    partyUpserts,
    upsertOptions,
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
              return { error: options.finalizeError && patch.status === "ready" ? { message: "custody receipt write failed" } : null };
            },
          }),
        };
      }
      if (table === "safety_crash_parties") {
        return {
          upsert: async (rows: unknown[]) => {
            partyUpserts.push(rows);
            return { error: options.partyError ? { message: "party write failed" } : null };
          },
        };
      }
      return {
        // The crash upsert reads its ids back from the WRITE — batches are
        // bounded at 500 so they cannot hit PostgREST's response cap, and a
        // re-ingest gets the existing ids rather than appearing to write nothing.
        // The fake answers with one row per input, keyed on the same external id;
        // a fake returning nothing would make every person row unattachable and
        // the party assertions would pass while storing no people.
        upsert: (rows: unknown[], opts?: unknown) => {
          upserts.push(rows);
          upsertOptions.push(opts);
          const written = (rows as Array<Record<string, unknown>>).map((row, index) => ({
            id: `crash-${index}`,
            external_id: row.external_id,
          }));
          return {
            select: async () => ({ data: written, error: null }),
            then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
          };
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
      motorcyclist_involved: false,
      collision_type: "rear_end",
      lighting: "daylight",
      weather: "clear",
      source_attributes: {},
      latitude: 39.2,
      longitude: -121.0,
    });
  });
});

describe("ingestCrashesForStudyArea", () => {
  it("never reports ready when the acquisition receipt failed to persist", async () => {
    const service = fakeService({ finalizeError: true });
    const { ccrsAdapter } = await import("@/lib/safety/sources/ccrs");
    const spy = vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue({ records: [record()],
      matchedTotal: 1, geocodedTotal: 1, yearsCovered: [2025], truncated: false });
    try {
      const result = await ingestCrashesForStudyArea({ service: service as never, workspaceId: "ws-1",
        bbox: CA_BBOX, years: [2025], enrichSeriousInjury: false, includeParties: false });
      expect(result.status).toBe("failed");
      expect(result.error).toContain("custody receipt write failed");
    } finally { spy.mockRestore(); }
  });
  it("records no_coverage instead of returning an unexplained empty result", async () => {
    // A GENUINE gap — nothing registered covers it, storable or not.
    expect(UNCOVERED_BBOX).toBeDefined();
    const service = fakeService();
    const result = await ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "ws-1",
      bbox: UNCOVERED_BBOX,
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
      enrichSeriousInjury: false,
      includeParties: false,
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
      enrichSeriousInjury: false,
      includeParties: false,
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

  it("upgrades severity to KABCO A and records kabco_full completeness", async () => {
    const service = fakeService();
    const { ccrsAdapter } = await import("@/lib/safety/sources/ccrs");
    const fetchSpy = vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue({
      records: [record({ externalId: "a" }), record({ externalId: "b" })],
      matchedTotal: 2,
      geocodedTotal: 2,
      yearsCovered: [2025],
      truncated: false,
    });

    const injury = await import("@/lib/safety/sources/ccrs-injury");
    const injurySpy = vi
      .spyOn(injury, "fetchSeriousInjuryCollisionIds")
      .mockResolvedValue(new Set(["b"]));

    const result = await ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "ws-1",
      bbox: CA_BBOX,
      years: [2025],
      // The person-row pull is a separate lane with its own tests below; keeping
      // it out of this one leaves the KSI assertion about the KSI join alone.
      includeParties: false,
    });

    expect(result.seriousInjuryUpgrades).toBe(1);
    expect(result.severityCompleteness).toBe("kabco_full");
    const rows = service.upserts.flat() as Array<Record<string, unknown>>;
    expect(rows.find((r) => r.external_id === "b")?.severity).toBe("severe_injury");
    expect(rows.find((r) => r.external_id === "a")?.severity).toBe("injury");
    expect(service.updates.at(-1)).toMatchObject({ severity_completeness: "kabco_full" });

    fetchSpy.mockRestore();
    injurySpy.mockRestore();
  });

  it("keeps the crashes and the honest completeness when the KSI join fails", async () => {
    // Losing the enrichment must not lose the run — and must not let a missing
    // serious-injury count read as "there were none".
    const service = fakeService();
    const { ccrsAdapter } = await import("@/lib/safety/sources/ccrs");
    const fetchSpy = vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue({
      records: [record({ externalId: "a" })],
      matchedTotal: 1,
      geocodedTotal: 1,
      yearsCovered: [2025],
      truncated: false,
    });

    const injury = await import("@/lib/safety/sources/ccrs-injury");
    const injurySpy = vi
      .spyOn(injury, "fetchSeriousInjuryCollisionIds")
      .mockRejectedValue(new Error("injury table unreachable"));

    const result = await ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "ws-1",
      bbox: CA_BBOX,
      years: [2025],
      includeParties: false,
    });

    expect(result.status).toBe("ready");
    expect(result.storedCount).toBe(1);
    expect(result.severityCompleteness).toBe("fatal_injury_only");
    expect(result.seriousInjuryUpgrades).toBe(0);

    fetchSpy.mockRestore();
    injurySpy.mockRestore();
  });

  it("upserts on the natural key so re-ingest cannot duplicate rows", async () => {
    const service = fakeService();

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
      enrichSeriousInjury: false,
      includeParties: false,
    });

    expect(service.upsertOptions[0]).toMatchObject({ onConflict: "workspace_id,ingest_id,source_id,external_id" });
    expect(service.updates).toContainEqual(expect.objectContaining({ stored_count: 1 }));
    fetchSpy.mockRestore();
  });
});
