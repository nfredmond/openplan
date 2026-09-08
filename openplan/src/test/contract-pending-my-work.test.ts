import { describe, expect, it } from "vitest";
import { loadMyWork } from "@/lib/my-work/query";
import { createFakeSupabase, ME, NOW, ROSTER, WS_A, WS_B } from "./helpers/fake-my-work-tables";

describe("pending contract decisions in My Work", () => {
  it("reads scoped retained versions with their decision-specific destination", async () => {
    const kinds = ["baseline", "master", "received_review", "received_finance", "response"];
    const fake = createFakeSupabase({ contract_pending_my_work: [
      ...kinds.map((review_kind, index) => ({ id: `decision-${index}`, workspace_id: WS_A, engagement_id: "contract-a", project_id: "project-a", title: `Synthetic ${review_kind}`, review_kind, reported_on: "2026-09-08" })),
      { id: "foreign", workspace_id: WS_B, engagement_id: "private", title: "Private assignment", review_kind: "baseline" },
    ] });
    const result = await loadMyWork(fake.client, { workspaceId: WS_A, userId: ME, roster: ROSTER, now: NOW, scope: "assigned" });
    const items = result.items.filter(item => item.sourceId === "contract_pending_reviews");
    expect(fake.selects.contract_pending_my_work).toBe("id, workspace_id, engagement_id, project_id, title, review_kind, reported_on");
    expect(items.map(item => item.id)).toEqual(kinds.map((kind, index) => `${kind}:decision-${index}`));
    expect(items.map(item => item.title)).toEqual(["Approve contract baseline: Synthetic baseline", "Approve master terms: Synthetic master", "Review received invoice: Synthetic received_review", "Approve received invoice: Synthetic received_finance", "Review proposed response: Synthetic response"]);
    expect(items.map(item => item.href)).toEqual(["baselines", "master-terms", "received", "received", "remaining&section=Responses"].map(tab => `/invoicing/engagements/contract-a?tab=${tab}`));
    expect(items.every(item => item.block === "needs_review" && item.projectId === "project-a" && item.assigneeUserId === null)).toBe(true);
    expect(items[4].detail).toContain("changed inputs require a new comparison");
  });
  it("reports an unavailable decision queue instead of claiming nothing is pending", async () => {
    const fake = createFakeSupabase({}, { contract_pending_my_work: "Synthetic read failure" });
    const result = await loadMyWork(fake.client, { workspaceId: WS_A, userId: ME, roster: ROSTER, now: NOW });
    expect(result.reads.describe()).toContain("pending contract approvals and invoice reviews");
  });
});
