import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createServiceRoleClientMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});

const campaignMaybeSingleMock = vi.fn();
const campaignEqStatusMock = vi.fn(() => ({ maybeSingle: campaignMaybeSingleMock }));
const campaignEqTokenMock = vi.fn(() => ({ eq: campaignEqStatusMock }));
const campaignSelectMock = vi.fn(() => ({ eq: campaignEqTokenMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqMock }));

const categoriesOrderCreatedMock = vi.fn();
const categoriesOrderSortMock = vi.fn(() => ({ order: categoriesOrderCreatedMock }));
const categoriesEqCampaignMock = vi.fn(() => ({ order: categoriesOrderSortMock }));
const categoriesSelectMock = vi.fn(() => ({ eq: categoriesEqCampaignMock }));

const itemsLimitMock = vi.fn();
const itemsOrderMock = vi.fn(() => ({ limit: itemsLimitMock }));
const itemsEqStatusMock = vi.fn(() => ({ order: itemsOrderMock }));
const itemsEqCampaignMock = vi.fn(() => ({ eq: itemsEqStatusMock }));
const itemsSelectMock = vi.fn(() => ({ eq: itemsEqCampaignMock }));

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
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

import PublicEngagementPage from "@/app/(public)/engage/[shareToken]/page";

describe("PublicEngagementPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createServiceRoleClientMock.mockReturnValue({ from: fromMock });

    campaignMaybeSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        project_id: "22222222-2222-4222-8222-222222222222",
        title: "Downtown listening campaign",
        summary: "Help us identify the most urgent corridor issues.",
        public_description: null,
        status: "active",
        engagement_type: "map_feedback",
        allow_public_submissions: true,
        submissions_closed_at: null,
        updated_at: "2026-03-28T18:00:00.000Z",
      },
      error: null,
    });

    projectMaybeSingleMock.mockResolvedValue({
      data: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Downtown Mobility Plan",
        summary: "A planning effort focused on safety, access, and street operations in the downtown core.",
      },
      error: null,
    });

    categoriesOrderCreatedMock.mockResolvedValue({
      data: [{ id: "safety", label: "Safety", slug: "safety", description: "Crossings and speeding", sort_order: 1 }],
      error: null,
    });

    itemsLimitMock.mockResolvedValue({
      data: [],
      error: null,
    });
  });

  it("shows linked project context on the public engagement page", async () => {
    const page = await PublicEngagementPage({
      params: Promise.resolve({ shareToken: "share-token-12345" }),
    });

    render(page);

    expect(screen.getByText("Linked project: Downtown Mobility Plan")).toBeInTheDocument();
    expect(screen.getByText("This input supports")).toBeInTheDocument();
    expect(screen.getAllByText("Downtown Mobility Plan").length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getAllByText(/A planning effort focused on safety, access, and street operations in the downtown core\./i).length
    ).toBeGreaterThanOrEqual(1);
  });
});
