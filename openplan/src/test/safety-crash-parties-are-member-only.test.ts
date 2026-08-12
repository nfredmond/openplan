import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  applyPartyInvolvement,
  buildDimensionCoverage,
  ingestCrashesForStudyArea,
} from "@/lib/safety/ingest";
import { CRASH_LEVEL_ONLY_DIMENSION_SUPPORT } from "@/lib/safety/vocabulary";
import type { CrashPartyRecord, CrashRecord } from "@/lib/safety/sources/types";
import { loadGrantInventory } from "./migrations/grant-inventory";
import { loadPolicyInventory } from "./migrations/policy-inventory";
import { loadSchemaInventory } from "./migrations/schema-inventory";

/**
 * Person rows are the most sensitive thing this platform stores, and the most
 * useful thing the Safety module has ever had. Both halves are load-bearing:
 *
 *   USEFUL — the crash-level involvement flags UNDERCOUNT. Probed against one
 *   state's live 2025 file, the crash-level bicycle flag names 10,221
 *   collisions where 11,944 carry a bicyclist party (+16.9%), pedestrians 12,789
 *   vs 13,177 (+3.0%), and motorcyclists have no crash-level flag at all while
 *   12,513 collisions involve a motorcycle. Every vulnerable-road-user figure
 *   this product has published was low.
 *
 *   SENSITIVE — a role, an age band and an injury outcome next to a precise
 *   coordinate and a date is quasi-identifying in a small town. So the table is
 *   member-read only, service-role written, and unreachable by `anon` at the
 *   privilege layer rather than by the absence of a query.
 *
 * The PII refusals themselves live in `refused-crash-person-fields.test.ts`.
 * This file is about reachability, degradation, and the disclosure that keeps a
 * missing pull from reading as an empty one.
 */

const CA_BBOX = { minLon: -121.3, minLat: 39.1, maxLon: -120.0, maxLat: 39.6 };

function record(overrides: Partial<CrashRecord> = {}): CrashRecord {
  return {
    externalId: "c1",
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

function party(overrides: Partial<CrashPartyRecord> = {}): CrashPartyRecord {
  return {
    crashExternalId: "c1",
    externalPartyId: "c1-1",
    role: "driver",
    ageBand: "25_44",
    injury: "unknown",
    sourceAttributes: {},
    ...overrides,
  };
}

function fakeService(options: { partyError?: boolean } = {}) {
  const upserts: unknown[][] = [];
  const partyUpserts: unknown[][] = [];
  const updates: Record<string, unknown>[] = [];
  return {
    upserts,
    partyUpserts,
    updates,
    from(table: string) {
      if (table === "safety_crash_ingests") {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: "ingest-1" }, error: null }) }) }),
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              updates.push(patch);
              return { error: null };
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

describe("the person table is member-read and service-role-written", () => {
  const schema = loadSchemaInventory();
  const policies = loadPolicyInventory();
  const grants = loadGrantInventory();

  it("exists with RLS on and exactly one permissive policy — member SELECT", () => {
    expect(schema.tables()).toContain("safety_crash_parties");
    expect(schema.rlsEnabled("safety_crash_parties")).toBe(true);
    expect(policies.permissiveGrants("safety_crash_parties", "SELECT").map((p) => p.policy)).toEqual([
      "safety_crash_parties_read",
    ]);
    // No client write policy at all — a person row is authored by an authed
    // route after a membership check, never by a browser through PostgREST.
    for (const command of ["INSERT", "UPDATE", "DELETE"] as const) {
      expect(policies.permissiveGrants("safety_crash_parties", command)).toEqual([]);
    }
  });

  it("holds the SELECT privilege the policy promises — a policy alone is a locked door", () => {
    // The v0.14.0 defect exactly: RLS on, policies written, no GRANT, and every
    // signed-in planner got `permission denied` before RLS was ever consulted.
    expect(grants.holds("safety_crash_parties", "authenticated", "SELECT")).not.toBe("none");
  });

  it("gives anon nothing, which is the enforcement and not the intention", () => {
    // `anon` is the role every public engagement surface runs as. A person's
    // role, age band and injury outcome beside a precise coordinate and date is
    // quasi-identifying, so the refusal has to live at the privilege layer where
    // a future permissive policy cannot undo it.
    for (const command of ["SELECT", "INSERT", "UPDATE", "DELETE"] as const) {
      expect(grants.holds("safety_crash_parties", "anon", command)).toBe("none");
      // …and no client write either.
      if (command !== "SELECT") {
        expect(grants.holds("safety_crash_parties", "authenticated", command)).toBe("none");
      }
    }
  });

  it("cascades from the crash, so no person row can outlive its collision", () => {
    const sql = readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/20260812000002_safety_crash_parties.sql"),
      "utf8"
    );
    expect(sql).toMatch(/crash_id\s+uuid NOT NULL REFERENCES public\.safety_crashes\(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/UNIQUE \(workspace_id, source_id, external_party_id\)/);
  });
});

describe("recomputing involvement from person rows", () => {
  it("finds the vulnerable road users the crash-level flags miss", () => {
    const { records, recomputed } = applyPartyInvolvement(
      [record({ externalId: "c1" })],
      [party({ role: "bicyclist" }), party({ externalPartyId: "c1-2", role: "motorcyclist" })]
    );
    expect(recomputed).toBe(1);
    expect(records[0].bicyclistInvolved).toBe(true);
    expect(records[0].motorcyclistInvolved).toBe(true);
    expect(records[0].pedestrianInvolved).toBe(false);
  });

  it("never clears a flag the source positively reported", () => {
    // OR, not replace. A crash-level flag that fired is a report from the
    // source; person rows that do not echo it are a gap in the person table, not
    // evidence that no pedestrian was there.
    const { records } = applyPartyInvolvement(
      [record({ externalId: "c1", pedestrianInvolved: true })],
      [party({ role: "driver" })]
    );
    expect(records[0].pedestrianInvolved).toBe(true);
  });

  it("leaves a crash the person query returned nothing for exactly as it was", () => {
    // Zeroing the flags here would replace a known undercount with a
    // fabrication — the worse of the two errors.
    const { records, recomputed } = applyPartyInvolvement(
      [record({ externalId: "c1", pedestrianInvolved: true }), record({ externalId: "c2" })],
      [party({ crashExternalId: "c1", role: "pedestrian" })]
    );
    expect(recomputed).toBe(1);
    expect(records[1].pedestrianInvolved).toBe(false);
    expect(records[1]).toEqual(record({ externalId: "c2" }));
  });
});

describe("the ingest stores people and discloses when it could not", () => {
  async function runIngest(options: {
    parties?: CrashPartyRecord[];
    partiesThrow?: boolean;
    partyError?: boolean;
    includeParties?: boolean;
  }) {
    const service = fakeService({ partyError: options.partyError });
    const { ccrsAdapter } = await import("@/lib/safety/sources/ccrs");
    const fetchSpy = vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue({
      records: [record({ externalId: "c1" })],
      matchedTotal: 1,
      geocodedTotal: 1,
      yearsCovered: [2025],
      truncated: false,
      unmappedByDimension: { weather: 3 },
    });
    const partiesSpy = vi
      .spyOn(ccrsAdapter, "fetchParties")
      .mockImplementation(async () => {
        if (options.partiesThrow) throw new Error("data.ca.gov party query failed");
        return options.parties ?? [];
      });

    const result = await ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "ws-1",
      bbox: CA_BBOX,
      years: [2025],
      enrichSeriousInjury: false,
      includeParties: options.includeParties,
    });

    fetchSpy.mockRestore();
    partiesSpy.mockRestore();
    return { result, service };
  }

  it("stores person rows attached to the crash ids the write returned", async () => {
    const { result, service } = await runIngest({
      parties: [party({ role: "pedestrian", ageBand: "65_plus", injury: "suspected_serious" })],
    });

    expect(result.status).toBe("ready");
    expect(result.partyCompleteness).toBe("retrieved");
    expect(result.partyCount).toBe(1);
    expect(result.involvementBasis).toBe("party_rows");

    const rows = service.partyUpserts.flat() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspace_id: "ws-1",
      crash_id: "crash-0",
      party_role: "pedestrian",
      age_band: "65_plus",
      person_injury: "suspected_serious",
    });
  });

  it("keeps the crashes and records not_retrieved when the person pull fails", async () => {
    // Losing the enrichment must not lose the run — and must not let a missing
    // person count read as "these collisions involved nobody".
    const { result, service } = await runIngest({ partiesThrow: true });

    expect(result.status).toBe("ready");
    expect(result.storedCount).toBe(1);
    expect(service.upserts.flat()).toHaveLength(1);
    expect(result.partyCompleteness).toBe("not_retrieved");
    expect(result.partyCount).toBeNull();
    expect(result.involvementBasis).toBe("crash_flags");
    expect(service.updates.at(-1)).toMatchObject({
      party_completeness: "not_retrieved",
      party_count: null,
      involvement_basis: "crash_flags",
    });
  });

  it("does not claim people were retrieved when their write failed", async () => {
    const { result } = await runIngest({ parties: [party()], partyError: true });
    expect(result.status).toBe("ready");
    expect(result.partyCompleteness).toBe("not_retrieved");
    expect(result.partyCount).toBeNull();
  });

  it("distinguishes 'no people in these collisions' from 'we did not look'", async () => {
    // A genuine empty answer IS a finding and gets a 0. A run that did not ask
    // gets null. Collapsing the two is how "0 pedestrians" gets published for a
    // corridor nobody counted pedestrians in.
    const emptyAnswer = await runIngest({ parties: [] });
    expect(emptyAnswer.result.partyCompleteness).toBe("retrieved");
    expect(emptyAnswer.result.partyCount).toBe(0);

    const didNotAsk = await runIngest({ includeParties: false });
    expect(didNotAsk.result.partyCompleteness).toBe("not_retrieved");
    expect(didNotAsk.result.partyCount).toBeNull();
    expect(didNotAsk.service.partyUpserts).toHaveLength(0);
  });

  it("writes the per-dimension disclosure, including what it could not classify", async () => {
    const { result, service } = await runIngest({ parties: [party()] });

    expect(result.dimensionCoverage).toMatchObject({
      lighting: { support: "supplied" },
      severity: { support: "partial" },
      weather: { support: "supplied", unmapped: 3 },
    });
    expect(service.updates.at(-1)).toMatchObject({ dimension_coverage: result.dimensionCoverage });
  });
});

describe("buildDimensionCoverage", () => {
  it("declares a not_supplied dimension rather than leaving it out", () => {
    // A missing key would render as an empty facet, which reads as "no crash
    // here happened after dark" — a finding a fatality census cannot support.
    const coverage = buildDimensionCoverage(CRASH_LEVEL_ONLY_DIMENSION_SUPPORT);
    expect(coverage.lighting).toEqual({ support: "not_supplied" });
    expect(coverage.party_role).toEqual({ support: "partial" });
    expect(Object.keys(coverage).sort()).toEqual([
      "collision_type",
      "lighting",
      "party_role",
      "person_injury",
      "severity",
      "weather",
    ]);
  });

  it("omits an unmapped tally of zero rather than reporting a clean facet as dirty", () => {
    const coverage = buildDimensionCoverage(CRASH_LEVEL_ONLY_DIMENSION_SUPPORT, { weather: 0 });
    expect(coverage.weather).toEqual({ support: "not_supplied" });
  });
});
