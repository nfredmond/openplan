vi.mock("server-only", () => ({}));
import { describe, expect, it, vi } from "vitest";

import {
  loadSs4aSeedFenceStanding,
  SS4A_SEED_STANDING_ACQUISITION_SELECT,
  SS4A_SEED_STANDING_PROJECT_SELECT,
  SS4A_SEED_STANDING_SELECT,
} from "@/lib/grants/ss4a-seed-fence-standing";
import { createFakeSupabase, type Db } from "./helpers/fake-my-work-tables";
import { mergeDb, seedFenceRows, SEED_AWARDED_OPPORTUNITY, SEED_OPEN_OPPORTUNITY } from "./helpers/ss4a-seed-fence-fixtures";

/**
 * Whether an applied SS4A seed still matches the crash records and project
 * place its Safety report was generated from. The comparison is the seed
 * route's own (`safetySeedFenceChanges`); these tests vary each fenced input.
 */

const WS = "aaaaaaaa-0000-4000-8000-000000000001";
const WS_OTHER = "bbbbbbbb-0000-4000-8000-000000000002";

async function load(db: Db, failures: Record<string, string> = {}) {
  const fake = createFakeSupabase(db, failures);
  const result = await loadSs4aSeedFenceStanding(fake.client, { workspaceId: WS });
  const byOpportunity = new Map(result.entries.map((entry) => [entry.opportunityId, entry]));
  return { ...fake, result, byOpportunity };
}

describe("loadSs4aSeedFenceStanding", () => {
  it("reads the receipts with their application and artifact, then the fenced sources", async () => {
    const { selects, queries } = await load(seedFenceRows(WS));

    expect(selects.funding_opportunity_safety_seeds).toBe(SS4A_SEED_STANDING_SELECT);
    for (const column of ["opportunity_id", "artifact_id", "created_at", "funding_opportunities!inner(", "opportunity_status", "report_artifacts(id, report_id, metadata_json)"]) {
      expect(selects.funding_opportunity_safety_seeds, column).toContain(column);
    }
    // Every place column the fence hashes, and the fenced revision.
    expect(selects.projects).toBe(SS4A_SEED_STANDING_PROJECT_SELECT);
    for (const column of ["place_source", "place_kind", "place_ref", "place_label", "place_min_lon", "place_max_lat", "place_set_at"]) {
      expect(selects.projects, column).toContain(column);
    }
    expect(selects.safety_crash_ingests).toBe(SS4A_SEED_STANDING_ACQUISITION_SELECT);
    for (const table of ["funding_opportunity_safety_seeds", "projects", "safety_crash_ingests"]) {
      const read = queries.find((query) => query.table === table)!;
      expect(read.ops, table).toContainEqual({ verb: "eq", args: ["workspace_id", WS] });
      expect(read.ops.some((op) => op.verb === "range"), table).toBe(true);
    }
  });

  it("calls an unchanged seed current, using only the latest receipt per application", async () => {
    const { result, byOpportunity } = await load(seedFenceRows(WS));
    expect(result.failures).toEqual([]);
    expect(byOpportunity.get(SEED_OPEN_OPPORTUNITY)?.standing).toEqual({ state: "current" });
    expect(byOpportunity.get(SEED_OPEN_OPPORTUNITY)?.seedId).toBe("seed-open");
    expect(byOpportunity.get(SEED_AWARDED_OPPORTUNITY)?.opportunityStatus).toBe("awarded");
  });

  it("calls a seed stale when its crash records changed", async () => {
    const db = seedFenceRows(WS);
    db.safety_crash_ingests[0].evidence_revision = 8;
    const { byOpportunity } = await load(db);
    expect(byOpportunity.get(SEED_OPEN_OPPORTUNITY)?.standing).toEqual({
      state: "stale",
      reasons: ["The crash records behind the seeded Safety report changed after it was generated."],
    });
  });

  it("calls a seed stale when its crash acquisition is gone", async () => {
    const db = seedFenceRows(WS);
    db.safety_crash_ingests = [];
    const { byOpportunity } = await load(db);
    expect(byOpportunity.get(SEED_OPEN_OPPORTUNITY)?.standing.state).toBe("stale");
  });

  it("calls a seed stale when the project's place changed", async () => {
    const db = seedFenceRows(WS);
    db.projects[0].place_label = "A different city";
    const { byOpportunity } = await load(db);
    expect(byOpportunity.get(SEED_OPEN_OPPORTUNITY)?.standing).toEqual({
      state: "stale",
      reasons: ["The project's place changed after the seeded Safety report was generated."],
    });
  });

  it("leaves a seed from before the fence unassessed, never current", async () => {
    const { byOpportunity } = await load(seedFenceRows(WS, { fenced: false }));
    expect(byOpportunity.get(SEED_OPEN_OPPORTUNITY)?.standing).toEqual({
      state: "unassessed",
      reasons: [expect.stringContaining("cannot be compared")],
    });
  });

  it("leaves a seed unassessed and names the read when its sources cannot be read", async () => {
    const { result, byOpportunity } = await load(seedFenceRows(WS), { projects: "permission denied for table projects" });
    expect(result.failures).toEqual([{ label: "projects cited by SS4A seeds", message: "permission denied for table projects", pending: false }]);
    expect(byOpportunity.get(SEED_OPEN_OPPORTUNITY)?.standing.state).toBe("unassessed");
  });

  it("returns nothing and names the read when the receipts cannot be read", async () => {
    const { result } = await load(seedFenceRows(WS), { funding_opportunity_safety_seeds: "permission denied" });
    expect(result).toEqual({ entries: [], failures: [{ label: "seeded SS4A applications", message: "permission denied", pending: false }] });
  });

  it("keeps another workspace's seeds out", async () => {
    const other = seedFenceRows(WS_OTHER);
    for (const row of other.funding_opportunity_safety_seeds) row.id = `${String(row.id)}-other`;
    const { result } = await load(mergeDb({ funding_opportunity_safety_seeds: other.funding_opportunity_safety_seeds }, { funding_opportunities: [] }, seedFenceRows(WS)));
    expect(result.entries.map((entry) => entry.seedId).sort()).toEqual(["seed-awarded", "seed-open"]);
  });
});
