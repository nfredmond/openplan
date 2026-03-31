import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

import { ReportDetailControls } from "@/components/reports/report-detail-controls";

describe("ReportDetailControls", () => {
  it("shows compact evidence posture alongside regeneration guidance", () => {
    render(
      <ReportDetailControls
        report={{
          id: "report-1",
          title: "Downtown Safety Packet",
          summary: "Generated packet",
          status: "generated",
          hasGeneratedArtifact: true,
        }}
        evidenceSummary={{
          headline: "2 linked runs · 1 scenario set · 6 project records",
          detail: "Active engagement · 4/9 handoff-ready · Hold present governance",
          blockedGateDetail: "Blocked gate: G02 · Agreements, Procurement, and Civil Rights Setup",
        }}
        driftSummary={{
          changedCount: 3,
          totalCount: 4,
          labels: ["Engagement handoff", "Project records", "Stage gates"],
        }}
      />
    );

    expect(screen.getByText(/Evidence chain posture/i)).toBeInTheDocument();
    expect(screen.getByText(/2 linked runs · 1 scenario set · 6 project records/i)).toBeInTheDocument();
    expect(screen.getByText(/4\/9 handoff-ready/i)).toBeInTheDocument();
    expect(screen.getByText(/Blocked gate: G02/i)).toBeInTheDocument();
    expect(screen.getByText(/3 live source changes detected since the current packet was generated\./i)).toBeInTheDocument();
    expect(screen.getByText(/Engagement handoff, Project records, and Stage gates/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Regenerate HTML packet/i })).toBeInTheDocument();
  });

  it("does not show the drift banner when nothing has changed", () => {
    render(
      <ReportDetailControls
        report={{
          id: "report-1",
          title: "Downtown Safety Packet",
          summary: "Generated packet",
          status: "generated",
          hasGeneratedArtifact: true,
        }}
        driftSummary={{
          changedCount: 0,
          totalCount: 4,
          labels: [],
        }}
      />
    );

    expect(screen.queryByText(/live source changes detected/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate HTML packet/i })).toBeInTheDocument();
  });
});
