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

import { EngagementReportCreateButton } from "@/components/engagement/engagement-report-create-button";

const sharedCampaignProps = {
  campaign: { id: "shared-campaign", title: "Shared listening", summary: null, status: "active", engagement_type: "comment_collection", project_id: "lead", created_at: "2026-09-01", updated_at: "2026-09-06" },
  counts: { moderationQueue: { actionableCount: 0, readyForHandoffCount: 1 }, uncategorizedItems: 0, totalItems: 1 },
  coveredProjects: [{ id: "lead", name: "Lead project" }, { id: "covered", name: "Covered project" }],
};

describe("EngagementReportCreateButton", () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates the report on the selected covered project while retaining the campaign's lead provenance", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ reportId: "report-covered" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<EngagementReportCreateButton {...sharedCampaignProps} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Project receiving this report" }), { target: { value: "covered" } });
    fireEvent.click(screen.getByRole("button", { name: "Create handoff report" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.projectId).toBe("covered");
    expect(body.sections.find((section: { sectionKey: string }) => section.sectionKey === "engagement_summary").configJson).toMatchObject({
      campaignId: "shared-campaign", provenance: { campaign: { id: "shared-campaign", projectId: "lead" } },
    });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/reports/report-covered"));
  });

  it("withholds creation when the selected project leaves the refreshed coverage set", () => {
    const { rerender } = render(<EngagementReportCreateButton {...sharedCampaignProps} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Project receiving this report" }), { target: { value: "covered" } });
    rerender(<EngagementReportCreateButton {...sharedCampaignProps} coveredProjects={[sharedCampaignProps.coveredProjects[0]]} />);
    expect(screen.getByRole("button", { name: "Create handoff report" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("no longer covered");
  });

  it("shows the frozen handoff snapshot that will be captured", () => {
    render(
      <EngagementReportCreateButton
        campaign={{
          id: "campaign-1",
          title: "Downtown listening campaign",
          summary: "Collect downtown safety feedback.",
          status: "active",
          engagement_type: "comment_collection",
          project_id: "project-1",
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-28T18:30:00.000Z",
        }}
        counts={{
          moderationQueue: {
            actionableCount: 3,
            readyForHandoffCount: 11,
          },
          uncategorizedItems: 2,
          totalItems: 18,
        }}
      />
    );

    expect(screen.getByText("What this creates")).toBeInTheDocument();
    expect(
      screen.getByText(/A project status packet with a frozen engagement handoff snapshot tied to this campaign\./i)
    ).toBeInTheDocument();
    expect(
      screen.getByText("11 ready for handoff • 18 total items • 3 actionable review • 2 uncategorized")
    ).toBeInTheDocument();
  });

  it("shows existing report guidance when a linked packet already needs attention", () => {
    render(
      <EngagementReportCreateButton
        campaign={{
          id: "campaign-1",
          title: "Downtown listening campaign",
          summary: "Collect downtown safety feedback.",
          status: "active",
          engagement_type: "comment_collection",
          project_id: "project-1",
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-28T18:30:00.000Z",
        }}
        counts={{
          moderationQueue: {
            actionableCount: 3,
            readyForHandoffCount: 11,
          },
          uncategorizedItems: 2,
          totalItems: 18,
        }}
        existingReportGuidance={{
          reportCount: 2,
          packetAttentionCount: 1,
          recommendedReportId: "report-77",
          recommendedReportTitle: "Downtown Safety Packet",
          recommendedAction: "Next action: open this report and regenerate the packet.",
          recommendedDetail: "The packet predates the latest campaign changes.",
        }}
      />
    );

    expect(screen.getByText(/This project already has 2 report records\./i)).toBeInTheDocument();
    expect(screen.getByText(/The packet predates the latest campaign changes\./i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Downtown Safety Packet/i })).toHaveAttribute(
      "href",
      "/reports/report-77"
    );
  });

  it("targets the campaign itself when no project is linked", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ reportId: "report-456" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <EngagementReportCreateButton
        campaign={{
          id: "campaign-standalone",
          title: "Countywide listening tour",
          summary: "Standalone campaign without a project.",
          status: "active",
          engagement_type: "comment_collection",
          project_id: null,
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-28T18:30:00.000Z",
        }}
        counts={{
          moderationQueue: {
            actionableCount: 1,
            readyForHandoffCount: 5,
          },
          uncategorizedItems: 0,
          totalItems: 9,
        }}
      />
    );

    expect(
      screen.getByText(/This campaign has no linked project, so the report targets the campaign directly\./i)
    ).toBeInTheDocument();

    const button = screen.getByRole("button", { name: /create handoff report/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const request = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request[1]?.body)) as {
      projectId?: string;
      engagementCampaignId?: string;
      reportType?: string;
      sections: Array<{ sectionKey: string }>;
    };

    expect(body.engagementCampaignId).toBe("campaign-standalone");
    expect(body.projectId).toBeUndefined();
    expect(body.reportType).toBe("project_status");
    expect(body.sections.map((section) => section.sectionKey)).not.toContain("project_overview");

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/reports/report-456");
    });
  });

  it("submits seeded provenance when creating the handoff report", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ reportId: "report-123" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <EngagementReportCreateButton
        campaign={{
          id: "campaign-1",
          title: "Downtown listening campaign",
          summary: "Collect downtown safety feedback.",
          status: "active",
          engagement_type: "comment_collection",
          project_id: "project-1",
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-28T18:30:00.000Z",
        }}
        counts={{
          moderationQueue: {
            actionableCount: 3,
            readyForHandoffCount: 11,
          },
          uncategorizedItems: 2,
          totalItems: 18,
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /create handoff report/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const request = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request[0]).toBe("/api/reports");
    expect(request[1]?.method).toBe("POST");

    const body = JSON.parse(String(request[1]?.body)) as {
      sections: Array<{ sectionKey: string; configJson?: { provenance?: { origin?: string; counts?: { readyForHandoffCount?: number } } } }>;
    };

    expect(body.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sectionKey: "status_snapshot",
          configJson: expect.objectContaining({
            provenance: expect.objectContaining({
              origin: "engagement_campaign_handoff",
              counts: expect.objectContaining({
                readyForHandoffCount: 11,
              }),
            }),
          }),
        }),
      ])
    );

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/reports/report-123");
      expect(refreshMock).toHaveBeenCalled();
    });
  });
});
