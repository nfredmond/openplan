import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

import {
  describeReportSourceReviewPosture,
  ReportDetailControls,
} from "@/components/reports/report-detail-controls";

describe("ReportDetailControls", () => {
  it("distinguishes ready, changed, and missing source-review posture", () => {
    expect(
      describeReportSourceReviewPosture({
        hasGeneratedArtifact: true,
        evidenceSummary: {
          headline: "2 linked runs · 1 scenario set · 6 project records",
          detail: "Active engagement · 4/9 handoff-ready · Hold present governance",
        },
        driftSummary: { changedCount: 0, totalCount: 4, labels: [] },
      })
    ).toMatchObject({
      state: "ready",
      label: "Current / ready",
      headline: "Evidence chain current",
      changedSourceText: null,
    });

    expect(
      describeReportSourceReviewPosture({
        hasGeneratedArtifact: true,
        evidenceSummary: {
          headline: "2 linked runs · 1 scenario set · 6 project records",
          detail: "Active engagement · 4/9 handoff-ready · Hold present governance",
        },
        driftSummary: {
          changedCount: 2,
          totalCount: 4,
          labels: ["Project records", "Stage gates"],
        },
      })
    ).toMatchObject({
      state: "needs-review",
      label: "Changed source context",
      headline: "2 source areas need review",
      changedSourceText: "Project records and Stage gates",
    });

    expect(
      describeReportSourceReviewPosture({
        hasGeneratedArtifact: true,
        evidenceSummary: null,
        driftSummary: { changedCount: 0, totalCount: 0, labels: [] },
      })
    ).toMatchObject({
      state: "missing",
      label: "Missing evidence",
      headline: "No evidence chain captured",
    });
  });

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
    expect(screen.getByText(/Regeneration posture/i)).toBeInTheDocument();
    expect(screen.getByText(/Changed source context/i)).toBeInTheDocument();
    expect(screen.getByText(/3 source areas need review/i)).toBeInTheDocument();
    expect(screen.getByText(/2 linked runs · 1 scenario set · 6 project records/i)).toBeInTheDocument();
    expect(screen.getByText(/4\/9 handoff-ready/i)).toBeInTheDocument();
    expect(screen.getByText(/Blocked gate: G02/i)).toBeInTheDocument();
    expect(screen.getByText(/3 live source changes detected since the current packet was generated\./i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/Engagement handoff, Project records, and Stage gates/i).length
    ).toBeGreaterThan(0);
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
    expect(screen.getByText(/Missing evidence/i)).toBeInTheDocument();
    expect(screen.getByText(/No evidence chain captured/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate HTML packet/i })).toBeInTheDocument();
  });

  it("shows current ready posture when linked evidence exists without source drift", () => {
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
          headline: "1 linked run · 1 scenario set · 3 project records",
          detail: "Active engagement · 2/2 handoff-ready · Complete governance",
        }}
        driftSummary={{
          changedCount: 0,
          totalCount: 4,
          labels: [],
        }}
      />
    );

    expect(screen.getByText(/Current \/ ready/i)).toBeInTheDocument();
    expect(screen.getByText(/Evidence chain current/i)).toBeInTheDocument();
    expect(screen.getByText(/no live source drift is currently visible/i)).toBeInTheDocument();
    expect(screen.queryByText(/Changed sources:/i)).not.toBeInTheDocument();
  });
});
