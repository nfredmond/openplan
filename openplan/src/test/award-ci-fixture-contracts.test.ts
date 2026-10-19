import { describe, expect, it } from "vitest";
import { exactCountResult } from "./helpers/exact-count-result";
import { AWARD_MIRRORED, buildDb, createFakeSupabase, loadSeededMyWork } from "./helpers/fake-my-work-tables";

describe("award reader fixture contracts", () => {
  it("counts a complete fixture without repairing explicit truncation or failed reads", () => {
    expect(exactCountResult({ data: [], error: null }).count).toBe(0);
    expect(exactCountResult({ data: [{ id: "one" }], error: null }).count).toBe(1);
    expect(exactCountResult({ data: [], error: null, count: 4 }).count).toBe(4);
    expect(exactCountResult({ data: [], error: null, count: null }).count).toBeNull();
    expect(exactCountResult({ data: null, error: { message: "Permission denied" } })).toEqual({ data: null, count: null, error: { message: "Permission denied" } });
  });

  it("reads current calendar views while preserving excluded historical base rows", async () => {
    const db = buildDb();
    const current = db.project_milestones.find((row) => row.id === "m-mine")!;
    current.handoff_origin_revision_id = "older-revision";
    const historical = { ...current, id: "m-historical", title: "Superseded work" };
    db.project_milestones.push(historical);
    db.current_award_handoff_records = [{ milestone_id: current.id, submittal_id: null }];
    db.funding_awards.find((row) => row.id === AWARD_MIRRORED)!.current_handoff_revision_id = "current-revision";
    // Assert the view boundary itself; the item mapper may independently exclude a managed award.
    const legacy = await createFakeSupabase(db).client.from("legacy_calendar_funding_awards").select("id");
    expect(legacy.error).toBeNull();
    expect(legacy.data).not.toContainEqual({ id: AWARD_MIRRORED });
    const legacyAward = db.funding_awards.find((row) => row.current_handoff_revision_id == null)!;
    expect(legacy.data).toContainEqual({ id: legacyAward.id });
    const { result, selects } = await loadSeededMyWork({ db });
    expect(result.items.some((row) => row.id === current.id)).toBe(true);
    expect(result.items.some((row) => row.id === historical.id)).toBe(false);
    expect(result.items.some((row) => row.id === AWARD_MIRRORED)).toBe(false);
    expect(db.project_milestones).toContain(historical);
    expect(db.funding_awards.some((row) => row.id === AWARD_MIRRORED)).toBe(true);
    expect(selects.active_project_milestones).toContain("projects!inner");
    expect(selects.active_project_submittals).toContain("projects!inner");
    expect(selects.legacy_calendar_funding_awards).toContain("closure_basis");
  });

  it("can fail the active milestone view independently of its retained base table", async () => {
    const { result } = await loadSeededMyWork({ failures: { active_project_milestones: "Permission denied" } });
    expect(result.reads.describe()).toContain("project milestones");
    expect(result.items.some((row) => row.id === "m-mine")).toBe(false);
    expect(result.items.some((row) => row.id === "d-mine-overdue")).toBe(true);
  });
});
