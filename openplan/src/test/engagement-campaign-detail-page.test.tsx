import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});

const authGetUserMock = vi.fn();

const campaignMaybeSingleMock = vi.fn();
const campaignEqMock = vi.fn(() => ({ maybeSingle: campaignMaybeSingleMock }));
const campaignSelectMock = vi.fn(() => ({ eq: campaignEqMock }));

const projectMaybeSingleMock = vi.fn();
const projectOrderMock = vi.fn();
const projectSelectMock = vi.fn(() => ({
  eq: (column: string) => {
    if (column === "id") {
      return { maybeSingle: projectMaybeSingleMock };
    }

    if (column === "workspace_id") {
      return { order: projectOrderMock };
    }

    throw new Error(`Unexpected projects eq column: ${column}`);
  },
}));

const categoriesOrderCreatedMock = vi.fn();
const categoriesOrderSortMock = vi.fn(() => ({ order: categoriesOrderCreatedMock }));
const categoriesEqMock = vi.fn(() => ({ order: categoriesOrderSortMock }));
const categoriesSelectMock = vi.fn(() => ({ eq: categoriesEqMock }));

const itemsOrderMock = vi.fn();
const itemsEqMock = vi.fn(() => ({ order: itemsOrderMock }));
const itemsSelectMock = vi.fn(() => ({ eq: itemsEqMock }));

const reportsOrderMock = vi.fn();
const reportsEqMock = vi.fn(() => ({ order: reportsOrderMock }));
const reportsSelectMock = vi.fn(() => ({ eq: reportsEqMock }));

const reportSectionsInMock = vi.fn();
const reportSectionsSelectMock = vi.fn(() => ({ in: reportSectionsInMock }));

const reportArtifactsInMock = vi.fn();
const reportArtifactsSelectMock = vi.fn(() => ({ in: reportArtifactsInMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "engagement_campaigns") {
    return { select: campaignSelectMock };
  }
  if (table === "projects") {
    return { select: projectSelectMock };
  }
  if (table === "engagement_categories") {
    return { select: categoriesSelectMock };
  }
  if (table === "engagement_items") {
    return { select: itemsSelectMock };
  }
  if (table === "reports") {
    return { select: reportsSelectMock };
  }
  if (table === "report_sections") {
    return { select: reportSectionsSelectMock };
  }
  if (table === "report_artifacts") {
    return { select: reportArtifactsSelectMock };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/components/engagement/engagement-campaign-controls", () => ({
  EngagementCampaignControls: () => <div data-testid="engagement-campaign-controls" />,
}));

vi.mock("@/components/engagement/engagement-report-create-button", () => ({
  EngagementReportCreateButton: ({ existingReportGuidance }: { existingReportGuidance?: { recommendedReportTitle?: string } | null }) => (
    <div data-testid="engagement-report-create-button">
      {existingReportGuidance?.recommendedReportTitle ?? "no-guidance"}
    </div>
  ),
}));

vi.mock("@/components/engagement/engagement-category-creator", () => ({
  EngagementCategoryCreator: () => <div data-testid="engagement-category-creator" />,
}));

vi.mock("@/components/engagement/engagement-item-composer", () => ({
  EngagementItemComposer: () => <div data-testid="engagement-item-composer" />,
}));

vi.mock("@/components/engagement/engagement-item-registry", () => ({
  EngagementItemRegistry: () => <div data-testid="engagement-item-registry" />,
}));

vi.mock("@/components/engagement/engagement-share-controls", () => ({
  EngagementShareControls: () => <div data-testid="engagement-share-controls" />,
}));

vi.mock("@/components/engagement/engagement-bulk-moderation", () => ({
  EngagementBulkModeration: () => <div data-testid="engagement-bulk-moderation" />,
}));

import EngagementCampaignDetailPage from "@/app/(app)/engagement/[campaignId]/page";

async function renderPage() {
  render(
    await EngagementCampaignDetailPage({
      params: Promise.resolve({ campaignId: "campaign-1" }),
    })
  );
}

describe("EngagementCampaignDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
        },
      },
    });

    campaignMaybeSingleMock.mockResolvedValue({
      data: {
        id: "campaign-1",
        workspace_id: "workspace-1",
        project_id: "project-1",
        title: "Downtown listening campaign",
        summary: "Collect downtown safety feedback.",
        status: "active",
        engagement_type: "comment_collection",
        share_token: "share-token",
        public_description: null,
        allow_public_submissions: true,
        submissions_closed_at: null,
        created_at: "2026-03-01T00:00:00.000Z",
        updated_at: "2026-03-28T22:00:00.000Z",
      },
      error: null,
    });

    projectMaybeSingleMock.mockResolvedValue({
      data: {
        id: "project-1",
        workspace_id: "workspace-1",
        name: "Downtown Mobility Plan",
        summary: "Planning effort focused on corridor safety and access.",
        status: "active",
        plan_type: "corridor_plan",
        delivery_phase: "analysis",
        updated_at: "2026-03-28T22:00:00.000Z",
      },
      error: null,
    });

    projectOrderMock.mockResolvedValue({
      data: [{ id: "project-1", name: "Downtown Mobility Plan" }],
      error: null,
    });

    categoriesOrderCreatedMock.mockResolvedValue({
      data: [
        {
          id: "category-1",
          campaign_id: "campaign-1",
          label: "Safety",
          slug: "safety",
          description: "Safety comments",
          sort_order: 0,
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-28T21:00:00.000Z",
        },
      ],
      error: null,
    });

    itemsOrderMock.mockResolvedValue({
      data: [
        {
          id: "item-1",
          campaign_id: "campaign-1",
          category_id: "category-1",
          title: "Safer crossings",
          body: "Add a protected crossing.",
          submitted_by: "Resident",
          status: "approved",
          source_type: "public_comment",
          moderation_notes: null,
          latitude: 34.1,
          longitude: -118.2,
          metadata_json: {},
          created_at: "2026-03-28T20:00:00.000Z",
          updated_at: "2026-03-28T21:30:00.000Z",
        },
      ],
      error: null,
    });

    reportsOrderMock.mockResolvedValue({
      data: [
        {
          id: "report-1",
          project_id: "project-1",
          title: "Downtown Safety Packet",
          report_type: "project_status",
          status: "generated",
          generated_at: "2026-03-28T20:00:00.000Z",
          updated_at: "2026-03-28T22:00:00.000Z",
          latest_artifact_kind: "html",
        },
        {
          id: "report-2",
          project_id: "project-1",
          title: "Board Packet",
          report_type: "board_packet",
          status: "generated",
          generated_at: "2026-03-28T19:00:00.000Z",
          updated_at: "2026-03-28T19:00:00.000Z",
          latest_artifact_kind: "html",
        },
      ],
      error: null,
    });

    reportSectionsInMock.mockResolvedValue({
      data: [
        {
          report_id: "report-1",
          section_key: "engagement_summary",
          enabled: true,
          config_json: { campaignId: "campaign-1" },
        },
      ],
      error: null,
    });

    reportArtifactsInMock.mockResolvedValue({
      data: [
        {
          report_id: "report-1",
          generated_at: "2026-03-28T20:00:00.000Z",
        },
        {
          report_id: "report-2",
          generated_at: "2026-03-28T19:00:00.000Z",
        },
      ],
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("surfaces campaign-linked packet freshness guidance and handoff readiness", async () => {
    await renderPage();

    expect(screen.getByText(/Campaign handoff decision/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Nearly ready/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/close the campaign when intake is complete/i)).toBeInTheDocument();
    expect(screen.getByText(/Campaign reporting posture/i)).toBeInTheDocument();
    expect(screen.getByText(/Downtown Safety Packet needs packet attention/i)).toBeInTheDocument();
    expect(screen.getByText(/Refresh recommended/i)).toBeInTheDocument();
    expect(screen.getAllByText(/1 packet issue/i)).toHaveLength(2);
    expect(screen.getByTestId("engagement-report-create-button")).toHaveTextContent(
      /Downtown Safety Packet/i
    );
  });

  it("keeps explicit campaign packet guidance current when the newest artifact is fresher than the report row", async () => {
    reportsOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "report-1",
          project_id: "project-1",
          title: "Downtown Safety Packet",
          report_type: "project_status",
          status: "generated",
          generated_at: null,
          updated_at: "2026-03-28T20:00:00.000Z",
          latest_artifact_kind: "html",
        },
      ],
      error: null,
    });
    reportArtifactsInMock.mockResolvedValueOnce({
      data: [
        {
          report_id: "report-1",
          generated_at: "2026-03-28T20:30:00.000Z",
        },
      ],
      error: null,
    });

    await renderPage();

    expect(screen.getAllByText(/Packet current/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Refresh recommended/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("engagement-report-create-button")).toHaveTextContent(
      /Downtown Safety Packet/i
    );
    expect(screen.getAllByText(/run release review on the current packet/i).length).toBeGreaterThan(0);
  });

  it("shows the empty report state when no reports exist for the linked project", async () => {
    reportsOrderMock.mockResolvedValueOnce({ data: [], error: null });

    await renderPage();

    expect(
      screen.getByText(/No reports linked through this project yet/i)
    ).toBeInTheDocument();
  });
});
