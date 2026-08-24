/**
 * THE PATH TO THE UNIT — can a planner outside the storable source's territory
 * actually reach crash data?
 *
 * The FARS adapter has been registered, covered, and unit-tested since Wave 8.2,
 * and the Explore corridor scorecard has read it the whole time. The Safety
 * module could not: `resolveCrashSource(bbox, "ingest")` filters the registry
 * down to adapters `safety_crashes.source_id` admits, and the module reported
 * that FILTERED miss as `out_of_coverage` — telling every planner outside the
 * storable source's territory that no registered crash source covered them,
 * while one did. A complete, tested, registered capability that nobody could
 * reach: the shipped-invisible defect class, instance twelve.
 *
 * Every study area in this file is SEARCHED FOR using the registry's own
 * `covers()` predicates (see `helpers/crash-coverage-probe.ts`) rather than
 * typed in, so no assertion here can pass by describing a place the product
 * cannot produce.
 */

import { describe, expect, it, vi } from "vitest";
import { ingestCrashesForStudyArea } from "@/lib/safety/ingest";
import { readCrashesForStudyArea } from "@/lib/safety/read-only-lane";
import { CRASH_SOURCE_ADAPTERS, resolveCrashSource } from "@/lib/safety/sources/registry";
import { CrashSourceUnavailableError, type CrashRecord } from "@/lib/safety/sources/types";
import {
  findReadOnlyOnlyStudyArea,
  findStorableStudyArea,
  findUncoveredStudyArea,
} from "./helpers/crash-coverage-probe";

function record(overrides: Partial<CrashRecord> = {}): CrashRecord {
  return {
    externalId: "case-1",
    collisionDate: "2024-03-04",
    collisionYear: 2024,
    severity: "fatal",
    killedCount: 1,
    injuredCount: 0,
    pedestrianInvolved: false,
    bicyclistInvolved: false,
    motorcyclistInvolved: false,
    collisionType: "rear_end",
    lighting: "daylight",
    weather: "clear",
    sourceAttributes: {},
    latitude: 0,
    longitude: 0,
    ...overrides,
  };
}

/** Minimal stand-in for the service-role client, recording every write. */
function fakeService() {
  const inserts: Record<string, unknown>[] = [];
  const upserts: unknown[][] = [];
  return {
    inserts,
    upserts,
    from(table: string) {
      if (table === "safety_crash_ingests") {
        return {
          insert: (row: Record<string, unknown>) => {
            inserts.push(row);
            return {
              select: () => ({ single: async () => ({ data: { id: "ingest-1" }, error: null }) }),
            };
          },
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      return {
        // The crash upsert now reads its ids back from the WRITE, so the fake
        // has to answer `.select()` — and it answers with a row per input, keyed
        // on the same external id, because a fake that returned nothing would
        // make every person row look unattachable and quietly pass.
        upsert: (rows: unknown[]) => {
          upserts.push(rows);
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

describe("crash coverage probes are derived from the live registry", () => {
  it("finds a study area a registered source covers but no storable source does", () => {
    // If this is null the read-only lane is unreachable by construction and
    // every reachability assertion below would be vacuous.
    const probe = findReadOnlyOnlyStudyArea();
    expect(probe, "no registered read-only crash source covers anywhere").not.toBeNull();
    expect(probe!.adapter.persistable).toBe(false);
    // The ingest resolver genuinely misses it — this is the state under test.
    expect(resolveCrashSource(probe!.bbox, "ingest").kind).toBe("out_of_coverage");
  });

  it("finds a study area a storable source covers, so the ingest path is still exercised", () => {
    const probe = findStorableStudyArea();
    expect(probe).not.toBeNull();
    expect(probe!.adapter.persistable).toBe(true);
  });

  it("finds a study area no registered source covers at all", () => {
    expect(findUncoveredStudyArea()).not.toBeNull();
  });
});

describe("readCrashesForStudyArea", () => {
  it("returns observed records from a source that may not be stored", async () => {
    const probe = findReadOnlyOnlyStudyArea()!;
    const spy = vi.spyOn(probe.adapter, "fetch").mockResolvedValue({
      records: [record({ externalId: "a" }), record({ externalId: "b" })],
      matchedTotal: 2,
      geocodedTotal: 2,
      yearsCovered: [2024],
      truncated: false,
    });

    const result = await readCrashesForStudyArea({ bbox: probe.bbox, years: [2024, 2023] });

    expect(result.kind).toBe("read_only");
    if (result.kind !== "read_only") return;
    expect(result.adapter.id).toBe(probe.adapter.id);
    expect(result.fetched.records).toHaveLength(2);
    // It names what it consulted, which is what lets a caller stop asserting
    // that nothing exists.
    expect(result.checked.length).toBeGreaterThan(0);

    spy.mockRestore();
  });

  it("reports an unreachable source as unreachable, never as zero crashes", async () => {
    const probe = findReadOnlyOnlyStudyArea()!;
    const spy = vi
      .spyOn(probe.adapter, "fetch")
      .mockRejectedValue(new CrashSourceUnavailableError(probe.adapter.id, "source unreachable"));

    const result = await readCrashesForStudyArea({ bbox: probe.bbox, years: [2024] });

    expect(result.kind).toBe("source_unavailable");
    if (result.kind !== "source_unavailable") return;
    expect(result.message).toContain("unreachable");

    spy.mockRestore();
  });

  it("reports a genuine coverage gap as a gap, naming every adapter it checked", async () => {
    const bbox = findUncoveredStudyArea()!;
    const result = await readCrashesForStudyArea({ bbox, years: [2024] });

    expect(result.kind).toBe("out_of_coverage");
    if (result.kind !== "out_of_coverage") return;
    // Everything registered was consulted — not just the storable subset.
    expect(result.checked.map((entry) => entry.id).sort()).toEqual(
      CRASH_SOURCE_ADAPTERS.map((adapter) => adapter.id).sort()
    );
  });
});

describe("the Safety ingest lane reaches the read-only registry", () => {
  it("serves crashes where a registered source covers the area but cannot be stored", async () => {
    const probe = findReadOnlyOnlyStudyArea()!;
    const service = fakeService();
    const spy = vi.spyOn(probe.adapter, "fetch").mockResolvedValue({
      records: [record({ externalId: "a", latitude: 1, longitude: 2 })],
      matchedTotal: 7,
      geocodedTotal: 1,
      yearsCovered: [2024],
      truncated: false,
    });

    const result = await ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "ws-1",
      bbox: probe.bbox,
      years: [2024, 2023],
    });

    // THE REGRESSION THIS FILE EXISTS FOR: before the read-only lane was wired,
    // this was `no_coverage` / `out_of_coverage` with zero crashes.
    expect(result.status).toBe("read_only");
    expect(result.coverageState).not.toBe("out_of_coverage");
    expect(result.sourceId).toBe(probe.adapter.id);
    expect(result.crashCount).toBe(7);
    expect(result.geocodedCount).toBe(1);

    // The crashes travel back to the caller, because nothing else can serve
    // them — they are in no table.
    expect(result.crashes?.features).toHaveLength(1);
    expect(result.crashes?.features[0].geometry.coordinates).toEqual([2, 1]);
    expect(result.crashes?.features[0].properties.sourceId).toBe(probe.adapter.id);

    // And NOTHING was stored, or claimed to be stored.
    expect(result.stored).toBe(false);
    expect(result.storedCount).toBe(0);
    expect(result.ingestId).toBeNull();
    expect(service.upserts).toHaveLength(0);
    // No acquisition row either: a row whose counts no crash row backs would
    // make the coverage banner and the map disagree on the next page load.
    expect(service.inserts).toHaveLength(0);

    spy.mockRestore();
  });

  it("does not swallow a read-only source outage as a coverage gap", async () => {
    const probe = findReadOnlyOnlyStudyArea()!;
    const service = fakeService();
    const spy = vi
      .spyOn(probe.adapter, "fetch")
      .mockRejectedValue(new CrashSourceUnavailableError(probe.adapter.id, "source unreachable"));

    const result = await ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "ws-1",
      bbox: probe.bbox,
      years: [2024],
    });

    // "Could not be read" and "not recorded" are different facts.
    expect(result.status).toBe("failed");
    expect(result.coverageState).toBe("source_unavailable");
    expect(result.error).toContain("unreachable");
    expect(result.crashes).toBeNull();
    expect(service.upserts).toHaveLength(0);

    spy.mockRestore();
  });

  it("still records a real coverage gap, and names what it checked", async () => {
    const bbox = findUncoveredStudyArea()!;
    const service = fakeService();

    const result = await ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "ws-1",
      bbox,
      years: [2024],
    });

    expect(result.status).toBe("no_coverage");
    expect(result.coverageState).toBe("out_of_coverage");
    expect(result.crashes).toBeNull();
    expect(result.checkedSources.map((entry) => entry.id).sort()).toEqual(
      CRASH_SOURCE_ADAPTERS.map((adapter) => adapter.id).sort()
    );
    // The acquisition row is still written — a recorded gap, not an error.
    expect(service.inserts).toHaveLength(1);
    // …and the attribution it stores names the sources rather than asserting
    // that none exist.
    for (const adapter of CRASH_SOURCE_ADAPTERS) {
      expect(String(service.inserts[0].attribution)).toContain(adapter.label);
    }
    expect(service.upserts).toHaveLength(0);
  });

  it("leaves the storable lane exactly as it was — it still stores", async () => {
    const probe = findStorableStudyArea()!;
    const service = fakeService();
    const spy = vi.spyOn(probe.adapter, "fetch").mockResolvedValue({
      records: [record({ externalId: "a" })],
      matchedTotal: 1,
      geocodedTotal: 1,
      yearsCovered: [2024],
      truncated: false,
    });
    const partiesSpy = probe.adapter.fetchParties
      ? vi.spyOn(probe.adapter, "fetchParties").mockRejectedValue(new Error("party fetch must stay disabled here"))
      : null;

    const result = await ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "ws-1",
      bbox: probe.bbox,
      years: [2024],
      enrichSeriousInjury: false,
      includeParties: false,
    });

    expect(result.status).toBe("ready");
    expect(result.stored).toBe(true);
    expect(result.ingestId).not.toBeNull();
    expect(result.crashes).toBeNull();
    expect(service.upserts.flat()).toHaveLength(1);
    expect(partiesSpy).not.toHaveBeenCalled();

    spy.mockRestore();
    partiesSpy?.mockRestore();
  });
});

/**
 * A READ-ONLY LANE MAY NOT BE GATED AS A WRITE.
 *
 * `POST /api/safety/crashes/ingest` is the only door into the crash lane, and
 * it refused viewers outright. But the lane's read-only path — the one that
 * matters everywhere a storable source does NOT reach, which today is every
 * state but California — writes nothing at all. So a viewer in Ohio was shown
 * no crash data, ever, by a request that would have stored nothing. That is
 * restriction standing in for a permission the request never needed.
 *
 * The capability is passed to the lane rather than predicted by the route. A
 * route that guessed which branch it would get would be resting a permission
 * decision on a comment claiming a branch is unreachable — and the no-coverage
 * branch below writes an acquisition row exactly where such a guess says it
 * will not. These tests assert BOTH directions: nothing is written without the
 * capability, and nothing is withheld that the caller may have.
 */
describe("mayStore separates what a viewer may read from what they may store", () => {
  it("serves live read-only crashes to a caller that may not store, and writes nothing", async () => {
    const probe = findReadOnlyOnlyStudyArea()!;
    const service = fakeService();
    const spy = vi.spyOn(probe.adapter, "fetch").mockResolvedValue({
      records: [record({ externalId: "fatal-1" })],
      matchedTotal: 1,
      geocodedTotal: 1,
      yearsCovered: [2024],
      truncated: false,
    });

    const result = await ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "ws-1",
      bbox: probe.bbox,
      years: [2024],
      mayStore: false,
      enrichSeriousInjury: false,
    });

    // The planner gets their crashes...
    expect(result.status).toBe("read_only");
    expect(result.crashes?.features ?? []).toHaveLength(1);
    // ...and nothing at all was written.
    expect(service.inserts).toHaveLength(0);
    expect(service.upserts.flat()).toHaveLength(0);

    spy.mockRestore();
  });

  it("records no acquisition row for a coverage gap when the caller may not store", async () => {
    const bbox = findUncoveredStudyArea()!;
    const service = fakeService();

    const result = await ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "ws-1",
      bbox,
      years: [2024],
      mayStore: false,
      enrichSeriousInjury: false,
    });

    // The FINDING is unchanged — the gap is still reported as a gap, and every
    // adapter consulted is still named. Only the row is not written.
    expect(result.status).toBe("no_coverage");
    expect(result.checkedSources.length).toBeGreaterThan(0);
    expect(result.ingestId).toBeNull();
    expect(service.inserts).toHaveLength(0);
  });

  it("refuses to store where a storable source covers the area, and says why", async () => {
    const probe = findStorableStudyArea()!;
    const service = fakeService();
    const spy = vi.spyOn(probe.adapter, "fetch").mockResolvedValue({
      records: [record({ externalId: "a" })],
      matchedTotal: 1,
      geocodedTotal: 1,
      yearsCovered: [2024],
      truncated: false,
    });

    const result = await ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "ws-1",
      bbox: probe.bbox,
      years: [2024],
      mayStore: false,
      enrichSeriousInjury: false,
    });

    expect(result.stored).toBe(false);
    expect(service.inserts).toHaveLength(0);
    expect(service.upserts.flat()).toHaveLength(0);
    // The refusal names the missing permission rather than presenting itself as
    // a coverage gap, which would be a false statement about the planner's area.
    expect(result.error).toMatch(/write access/i);
    expect(result.coverageState).not.toBe("out_of_coverage");

    spy.mockRestore();
  });

  /**
   * The control. Without this, a lane that refused EVERYTHING would satisfy
   * every assertion above — the defect this whole change exists to remove.
   */
  it("stores exactly as before when the caller may store", async () => {
    const probe = findStorableStudyArea()!;
    const service = fakeService();
    const spy = vi.spyOn(probe.adapter, "fetch").mockResolvedValue({
      records: [record({ externalId: "a" })],
      matchedTotal: 1,
      geocodedTotal: 1,
      yearsCovered: [2024],
      truncated: false,
    });
    const partiesSpy = probe.adapter.fetchParties
      ? vi.spyOn(probe.adapter, "fetchParties").mockRejectedValue(new Error("party fetch must stay disabled here"))
      : null;

    const result = await ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "ws-1",
      bbox: probe.bbox,
      years: [2024],
      mayStore: true,
      enrichSeriousInjury: false,
      includeParties: false,
    });

    expect(result.status).toBe("ready");
    expect(result.stored).toBe(true);
    expect(service.upserts.flat()).toHaveLength(1);
    expect(partiesSpy).not.toHaveBeenCalled();

    spy.mockRestore();
    partiesSpy?.mockRestore();
  });
});
