import { describe, expect, it } from "vitest";
import { AWARD_MIRRORED, buildDb, loadSeededMyWork } from "./helpers/fake-my-work-tables";

describe("award obligation deadline conflicts", () => {
  it("keeps the current award date when its assigned milestone still has an older date", async () => {
    const db = buildDb();
    const award = db.funding_awards.find(row => row.id === AWARD_MIRRORED)!;
    award.obligation_due_at = "2026-08-01T00:00:00Z";
    const { result, selects } = await loadSeededMyWork({ db });
    expect(selects.funding_awards.split(", ")).toContain("obligation_due_at");
    expect(selects.project_milestones.split(", ")).toContain("target_date");
    expect(selects.project_milestones.split(", ")).toContain("funding_award_id");
    const current = result.items.find(item => item.id === AWARD_MIRRORED);
    expect(current).toMatchObject({ dueOn: "2026-08-01T00:00:00Z", isOverdue: true });
    expect(current?.detail).toContain("linked milestone has a different or unreadable deadline");
    expect(result.items.find(item => item.id === "m-obligation")?.dueOn).toBe("2026-09-10");
  });

  it("still collapses the same deadline when timestamp and date-only encodings agree", async () => {
    const db = buildDb();
    db.funding_awards.find(row => row.id === AWARD_MIRRORED)!.obligation_due_at = "2026-09-10T00:00:00+00:00";
    const { result } = await loadSeededMyWork({ db });
    expect(result.items.some(item => item.id === AWARD_MIRRORED)).toBe(false);
    expect(result.items.some(item => item.id === "m-obligation")).toBe(true);
  });

  it("does not treat two unreadable dates as proof of one deadline", async () => {
    const db = buildDb();
    db.funding_awards.find(row => row.id === AWARD_MIRRORED)!.obligation_due_at = "invalid";
    db.project_milestones.find(row => row.id === "m-obligation")!.target_date = "invalid";
    const { result } = await loadSeededMyWork({ db });
    expect(result.items.some(item => item.id === AWARD_MIRRORED)).toBe(true);
  });
});
