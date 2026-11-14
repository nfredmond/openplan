vi.mock("server-only", () => ({}));
import { describe, expect, it, vi } from "vitest";

import {
  loadSs4aSeedFenceStanding,
  SS4A_SEED_STANDING_ACQUISITION_SELECT,
  SS4A_SEED_STANDING_DRAFT_SELECT,
  SS4A_SEED_STANDING_PROJECT_SELECT,
  SS4A_SEED_STANDING_SECTION_SELECT,
  SS4A_SEED_STANDING_SELECT,
} from "@/lib/grants/ss4a-seed-fence-standing";
import { createFakeSupabase, FAKE_POSTGREST_MAX_ROWS, type Db } from "./helpers/fake-my-work-tables";
import {
  MISSING_ARTIFACT,
  mergeDb,
  reseededWithEarlierFinals,
  seedFenceRows,
  SEED_AWARDED_OPPORTUNITY,
  SEED_OPEN_OPPORTUNITY,
} from "./helpers/ss4a-seed-fence-fixtures";

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

/**
 * Seeding again adds working drafts and keeps every final section, so the
 * export still packages final text from the earlier seed. The application's
 * standing follows every seed it still reflects, not only the newest receipt.
 */
describe("loadSs4aSeedFenceStanding across the seeds an application still reflects", () => {
  const EARLIER_REASON = "Project overview and Budget narrative are still final from an earlier Safety seed.";
  const CRASH_REASON = "The crash records behind the seeded Safety report changed after it was generated.";

  it("reads the final sections and the seed drafts through the caller's client, paged and scoped", async () => {
    const { selects, queries } = await load(reseededWithEarlierFinals(WS));
    expect(selects.funding_opportunity_application_sections).toBe(SS4A_SEED_STANDING_SECTION_SELECT);
    for (const column of ["opportunity_id", "title", "sort_order", "status", "finalized_from_draft_id"]) {
      expect(selects.funding_opportunity_application_sections, column).toContain(column);
    }
    expect(selects.funding_opportunity_section_drafts).toBe(SS4A_SEED_STANDING_DRAFT_SELECT);
    for (const column of ["opportunity_id", "section_id", "safety_seed_id"]) {
      expect(selects.funding_opportunity_section_drafts, column).toContain(column);
    }
    const sections = queries.find((query) => query.table === "funding_opportunity_application_sections")!;
    expect(sections.ops).toContainEqual({ verb: "eq", args: ["workspace_id", WS] });
    expect(sections.ops).toContainEqual({ verb: "eq", args: ["status", "final"] });
    const drafts = queries.find((query) => query.table === "funding_opportunity_section_drafts")!;
    expect(drafts.ops).toContainEqual({ verb: "eq", args: ["workspace_id", WS] });
    expect(drafts.ops).toContainEqual({ verb: "eq", args: ["origin", "safety_plan_seed"] });
    for (const read of [sections, drafts]) expect(read.ops.some((op) => op.verb === "range")).toBe(true);
  });

  it("keeps a re-seeded application stale while final sections still come from the stale earlier seed", async () => {
    const { result, byOpportunity } = await load(reseededWithEarlierFinals(WS));
    const entry = byOpportunity.get(SEED_OPEN_OPPORTUNITY)!;
    expect(result.failures).toEqual([]);
    expect(entry.seedId).toBe("seed-open");
    expect(entry.standing).toEqual({ state: "stale", reasons: [EARLIER_REASON, CRASH_REASON] });
    expect(entry.latestSeedState).toBe("current");
    expect(entry.staleFinalSections).toEqual(["Project overview", "Budget narrative"]);
  });

  it("calls it current once those sections are finalized again from the newest seed", async () => {
    const db = reseededWithEarlierFinals(WS);
    for (const draft of db.funding_opportunity_section_drafts) draft.safety_seed_id = "seed-open";
    const { byOpportunity } = await load(db);
    expect(byOpportunity.get(SEED_OPEN_OPPORTUNITY)?.standing).toEqual({ state: "current" });
    expect(byOpportunity.get(SEED_OPEN_OPPORTUNITY)?.staleFinalSections).toEqual([]);
  });

  it("does not count a draft that belongs to another section", async () => {
    const db = reseededWithEarlierFinals(WS);
    for (const draft of db.funding_opportunity_section_drafts) {
      if (draft.safety_seed_id === "seed-open-earlier") draft.section_id = "00000000-0000-4000-8000-000000000999";
    }
    const { byOpportunity } = await load(db);
    expect(byOpportunity.get(SEED_OPEN_OPPORTUNITY)?.standing).toEqual({ state: "current" });
  });

  it("leaves it unassessed, never current, when the earlier seed behind final text cannot be compared", async () => {
    const db = reseededWithEarlierFinals(WS);
    db.funding_opportunity_safety_seeds.find((row) => row.id === "seed-open-earlier")!.artifact_id = MISSING_ARTIFACT;
    const { byOpportunity } = await load(db);
    expect(byOpportunity.get(SEED_OPEN_OPPORTUNITY)?.standing).toEqual({
      state: "unassessed",
      reasons: [EARLIER_REASON, "The seeded Safety report artifact could not be read."],
    });
  });

  it("leaves it unassessed and names the read when the final sections cannot be read", async () => {
    const { result, byOpportunity } = await load(reseededWithEarlierFinals(WS), { funding_opportunity_application_sections: "permission denied" });
    expect(result.failures).toEqual([{ label: "final sections of seeded SS4A applications", message: "permission denied", pending: false }]);
    expect(byOpportunity.get(SEED_OPEN_OPPORTUNITY)?.standing).toEqual({
      state: "unassessed",
      reasons: [expect.stringContaining("final sections could not be read")],
    });
  });

  it("finds the earlier seed's drafts past the server's 1,000-row cap", async () => {
    const db = reseededWithEarlierFinals(WS);
    // Older working drafts that sort ahead of the finalized ones.
    for (let n = 0; n < FAKE_POSTGREST_MAX_ROWS + 50; n += 1) {
      db.funding_opportunity_section_drafts.push({
        id: `00000000-0000-4000-7000-${String(n).padStart(12, "0")}`, workspace_id: WS, opportunity_id: SEED_OPEN_OPPORTUNITY,
        section_id: "00000000-0000-4000-8000-000000000203", origin: "safety_plan_seed", safety_seed_id: "seed-open-earlier",
      });
    }
    const { result, byOpportunity } = await load(db);
    expect(result.failures).toEqual([]);
    expect(byOpportunity.get(SEED_OPEN_OPPORTUNITY)?.standing.state).toBe("stale");
  });
});
