import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { ReportCreator } from "@/components/reports/report-creator";

describe("ReportCreator", () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("surfaces existing stale report guidance for the selected project", () => {
    render(
      <ReportCreator
        projects={[
          { id: "project-1", workspace_id: "workspace-1", name: "Downtown Mobility Plan" },
          { id: "project-2", workspace_id: "workspace-1", name: "Transit Access Plan" },
        ]}
        runs={[]}
        reportGuidanceByProject={{
          "project-1": {
            reportCount: 2,
            refreshRecommendedCount: 1,
            noPacketCount: 1,
            comparisonBackedCount: 0,
            recommendedReportId: "report-1",
            recommendedReportTitle: "Downtown Safety Packet",
          },
        }}
      />
    );

    expect(screen.getByText(/This project already has 2 report records\./i)).toBeInTheDocument();
    expect(screen.getByText(/1 refresh recommended and 1 without packet\./i)).toBeInTheDocument();
    expect(screen.getByText(/Review Downtown Safety Packet before creating another packet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open existing report/i })).toHaveAttribute(
      "href",
      "/reports/report-1"
    );
  });

  it("shows calm guidance when the latest packet is current", () => {
    render(
      <ReportCreator
        projects={[{ id: "project-2", workspace_id: "workspace-1", name: "Transit Access Plan" }]}
        runs={[]}
        reportGuidanceByProject={{
          "project-2": {
            reportCount: 1,
            refreshRecommendedCount: 0,
            noPacketCount: 0,
            comparisonBackedCount: 0,
            recommendedReportId: "report-2",
            recommendedReportTitle: "Transit Access Packet",
          },
        }}
      />
    );

    expect(screen.getByText(/This project already has 1 report record\./i)).toBeInTheDocument();
    expect(screen.getByText(/Latest packet looks current\./i)).toBeInTheDocument();
  });

  it("defaults to the latest workspace county run with structured claim evidence and submits it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ reportId: "report-123" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReportCreator
        projects={[{ id: "project-1", workspace_id: "workspace-1", name: "Downtown Mobility Plan" }]}
        runs={[]}
        modelingCountyRuns={[
          {
            id: "county-run-latest-no-claim",
            workspace_id: "workspace-1",
            runName: "Latest raw county run",
            geographyLabel: "Nevada County",
            stage: "manifest-imported",
            updatedAt: "2026-04-24T17:00:00.000Z",
            claimStatus: null,
            statusReason: null,
            validationSummary: null,
            decidedAt: null,
          },
          {
            id: "county-run-screening",
            workspace_id: "workspace-1",
            runName: "Nevada County assignment screening",
            geographyLabel: "Nevada County, CA",
            stage: "validated-screening",
            updatedAt: "2026-04-24T16:00:00.000Z",
            claimStatus: "screening_grade",
            statusReason: "Validation evidence exists, but critical APE remains screening-grade.",
            validationSummary: { passed: 4, warned: 1, failed: 0 },
            decidedAt: "2026-04-24T16:10:00.000Z",
          },
        ]}
      />
    );

    expect(screen.getByLabelText("Modeling evidence")).toHaveValue("county-run-screening");
    expect(screen.getByText(/Validation evidence exists, but critical APE remains screening-grade\./i)).toBeInTheDocument();
    expect(screen.getByText(/Validation: 4 pass \/ 1 warn \/ 0 fail\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /create report/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const request = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request[0]).toBe("/api/reports");
    const body = JSON.parse(String(request[1]?.body)) as { modelingCountyRunId?: string };
    expect(body.modelingCountyRunId).toBe("county-run-screening");
    expect(pushMock).toHaveBeenCalledWith("/reports/report-123");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("lets an operator leave a report unattached to modeling evidence", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ reportId: "report-456" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReportCreator
        projects={[{ id: "project-1", workspace_id: "workspace-1", name: "Downtown Mobility Plan" }]}
        runs={[]}
        modelingCountyRuns={[
          {
            id: "county-run-claim-grade",
            workspace_id: "workspace-1",
            runName: "Claim-grade assignment run",
            geographyLabel: "Nevada County, CA",
            stage: "validated-screening",
            updatedAt: "2026-04-24T16:00:00.000Z",
            claimStatus: "claim_grade_passed",
            statusReason: "All required public-data validation checks passed.",
            validationSummary: { passed: 5, warned: 0, failed: 0 },
            decidedAt: "2026-04-24T16:10:00.000Z",
          },
        ]}
      />
    );

    fireEvent.change(screen.getByLabelText("Modeling evidence"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create report/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const request = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request[1]?.body)) as { modelingCountyRunId?: string };
    expect(body).not.toHaveProperty("modelingCountyRunId");
  });
});
