import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { loadSpecializedReportPage } from "@/components/reports/specialized-report-page";

vi.mock("@/components/safety/safety-candidate-comparison-editor", () => ({ SafetyCandidateComparisonEditor: ({ reportId, ingestId }: { reportId: string; ingestId?: string }) => <div data-testid="safety-owner">{reportId}:{ingestId ?? "no-acquisition"}</div> }));
vi.mock("@/components/reports/land-use-plan-report-page", () => ({ LandUsePlanReportPage: () => <div>Land-use owner</div> }));
vi.mock("@/components/reports/report-detail-controls", () => ({ ReportDetailControls: () => null }));
vi.mock("@/components/engagement/engagement-review-files", () => ({ EngagementReviewFiles: () => null }));

const report: Parameters<typeof loadSpecializedReportPage>[1] = {
  id: "synthetic-report", workspace_id: "synthetic-workspace", title: "Synthetic report", summary: null, status: "draft", generated_at: null, report_type: "project_status", metadata_json: {},
};
const client: Parameters<typeof loadSpecializedReportPage>[0] = { from: vi.fn(() => { throw new Error("Unexpected generic read before selecting Safety owner"); }) };

describe("Safety comparison page ownership", () => {
  it("opens the requested Safety editor with its selected acquisition", async () => {
    const page = await loadSpecializedReportPage(client, report, "synthetic-actor", { safetyComparison: "1", safetyIngestId: "synthetic-acquisition" });
    expect(page).not.toBeNull();
    render(page);
    expect(screen.getByTestId("safety-owner")).toHaveTextContent("synthetic-report:synthetic-acquisition");
  });
  it("keeps the Safety owner on a bare reload of a retained comparison", async () => {
    const page = await loadSpecializedReportPage(client, { ...report, metadata_json: { safetyComparisonV2: { revisionId: "retained" } } }, "synthetic-actor");
    expect(page).not.toBeNull();
    render(page);
    expect(screen.getByTestId("safety-owner")).toHaveTextContent("synthetic-report:no-acquisition");
  });
  it("leaves ordinary report ownership and land-use reports unchanged", async () => {
    expect(await loadSpecializedReportPage(client, report, "synthetic-actor")).toBeNull();
    render(await loadSpecializedReportPage(client, { ...report, land_use_plan_id: "synthetic-plan" }, "synthetic-actor"));
    expect(screen.getByText("Land-use owner")).toBeTruthy();
  });
});
