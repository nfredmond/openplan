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

describe("EngagementReportCreateButton", () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
