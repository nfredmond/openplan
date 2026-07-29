import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createServiceRoleClientMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});

const campaignMaybeSingleMock = vi.fn();
const campaignEqStatusMock = vi.fn(() => ({ maybeSingle: campaignMaybeSingleMock }));
const campaignEqTokenMock = vi.fn(() => ({ eq: campaignEqStatusMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));

/**
 * The portal now reads a second row from `engagement_campaigns` and `projects` —
 * the place of record that frames the resident-facing map — so the fake client
 * has to route on the SELECT string rather than pretend one row shape serves
 * both. `place_source` is the discriminator because only the framing read asks
 * for it; the same split `engagement-campaign-detail-route.test.ts` makes.
 */
const selectsPlaceColumns = (columns: string) => columns.includes("place_source");

const campaignPlaceMaybeSingleMock = vi.fn();
const campaignSelectMock = vi.fn((columns: string) =>
  selectsPlaceColumns(columns)
    ? { eq: () => ({ maybeSingle: campaignPlaceMaybeSingleMock }) }
    : { eq: campaignEqTokenMock }
);

const projectPlaceMaybeSingleMock = vi.fn();
const projectSelectMock = vi.fn((columns: string) =>
  selectsPlaceColumns(columns)
    ? { eq: () => ({ maybeSingle: projectPlaceMaybeSingleMock }) }
    : { eq: projectEqMock }
);

const workspaceMaybeSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock }));
const workspaceSelectMock = vi.fn(() => ({ eq: workspaceEqMock }));

const categoriesOrderCreatedMock = vi.fn();
const categoriesOrderSortMock = vi.fn(() => ({ order: categoriesOrderCreatedMock }));
const categoriesEqCampaignMock = vi.fn(() => ({ order: categoriesOrderSortMock }));
const categoriesSelectMock = vi.fn(() => ({ eq: categoriesEqCampaignMock }));

const itemsLimitMock = vi.fn();
const itemsOrderMock = vi.fn(() => ({ limit: itemsLimitMock }));
const itemsEqStatusMock = vi.fn(() => ({ order: itemsOrderMock }));
const itemsEqCampaignMock = vi.fn(() => ({ eq: itemsEqStatusMock }));
const itemsSelectMock = vi.fn(() => ({ eq: itemsEqCampaignMock }));

// loadSurveyDefinition — questions: select → eq(campaign) → eq(is_active) → order → order.
const surveyQuestionsOrderCreatedMock = vi.fn().mockResolvedValue({ data: [], error: null });
const surveyQuestionsOrderSortMock = vi.fn(() => ({ order: surveyQuestionsOrderCreatedMock }));
const surveyQuestionsEqActiveMock = vi.fn(() => ({ order: surveyQuestionsOrderSortMock }));
const surveyQuestionsEqCampaignMock = vi.fn(() => ({ eq: surveyQuestionsEqActiveMock }));
const surveyQuestionsSelectMock = vi.fn(() => ({ eq: surveyQuestionsEqCampaignMock }));

// loadSurveyDefinition — options: select → eq(campaign) → eq(is_active) → order.
const surveyOptionsOrderMock = vi.fn().mockResolvedValue({ data: [], error: null });
const surveyOptionsEqActiveMock = vi.fn(() => ({ order: surveyOptionsOrderMock }));
const surveyOptionsEqCampaignMock = vi.fn(() => ({ eq: surveyOptionsEqActiveMock }));
const surveyOptionsSelectMock = vi.fn(() => ({ eq: surveyOptionsEqCampaignMock }));

// loadPublishedCloseLoopEntries — select → eq(campaign) → eq(status) → order → order.
const closeLoopOrderCreatedMock = vi.fn().mockResolvedValue({ data: [], error: null });
const closeLoopOrderSortMock = vi.fn(() => ({ order: closeLoopOrderCreatedMock }));
const closeLoopEqStatusMock = vi.fn(() => ({ order: closeLoopOrderSortMock }));
const closeLoopEqCampaignMock = vi.fn(() => ({ eq: closeLoopEqStatusMock }));
const closeLoopSelectMock = vi.fn(() => ({ eq: closeLoopEqCampaignMock }));

// loadParticipantContextLayers — select → eq(campaign) → eq(visible_to_participants) → order → order.
// The second `eq` is the one that decides what an anonymous reader may see, so
// the double keeps it rather than collapsing the chain: a test that let an
// unpublished layer through would be asserting the wrong contract.
const contextLayersOrderCreatedMock = vi.fn().mockResolvedValue({
  data: [
    {
      id: "layer-1",
      campaign_id: "11111111-1111-4111-8111-111111111111",
      name: "Proposed alignment",
      description: null,
      geometry_kinds: ["line"],
      feature_count: 3,
      truncated_feature_count: 0,
      style_json: null,
      geojson: { type: "FeatureCollection", features: [] },
      sort_order: 0,
      created_at: "2026-07-29T00:00:00.000Z",
    },
  ],
  error: null,
});
const contextLayersOrderSortMock = vi.fn(() => ({ order: contextLayersOrderCreatedMock }));
const contextLayersEqVisibleMock = vi.fn(() => ({ order: contextLayersOrderSortMock }));
const contextLayersEqCampaignMock = vi.fn(() => ({ eq: contextLayersEqVisibleMock }));
const contextLayersSelectMock = vi.fn(() => ({ eq: contextLayersEqCampaignMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "engagement_context_layers") {
    return { select: contextLayersSelectMock };
  }
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
  if (table === "engagement_survey_questions") {
    return { select: surveyQuestionsSelectMock };
  }
  if (table === "engagement_survey_question_options") {
    return { select: surveyOptionsSelectMock };
  }
  if (table === "engagement_closeloop_entries") {
    return { select: closeLoopSelectMock };
  }
  // The workspace's home geography is the third framing candidate behind the
  // campaign's own area and the linked project's.
  if (table === "workspaces") {
    return { select: workspaceSelectMock };
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
        // The portal reads the workspace's home geography as a framing
        // fallback, so the campaign row has to carry the id it reads it by.
        workspace_id: "33333333-3333-4333-8333-333333333333",
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

    // The campaign states no area of its own and the workspace none either, so
    // the linked project's place of record is what should frame the map. This
    // is the ordinary shape and it is what makes the precedence observable on
    // the page a resident actually loads.
    campaignPlaceMaybeSingleMock.mockResolvedValue({ data: {}, error: null });
    projectPlaceMaybeSingleMock.mockResolvedValue({
      data: {
        place_source: "tigerweb",
        place_label: "Franklin County, Ohio",
        place_min_lon: -83.2,
        place_min_lat: 39.85,
        place_max_lon: -82.8,
        place_max_lat: 40.1,
      },
      error: null,
    });
    workspaceMaybeSingleMock.mockResolvedValue({ data: {}, error: null });
  });

  /**
   * THE PAGE-LEVEL REACHABILITY SEAM.
   *
   * `resolvePortalMapFraming` being correct proves nothing on its own: the
   * defect this repo keeps paying for is a finished capability that never
   * reaches the render site. This drives the real server page with the real
   * loader and asserts what a RESIDENT reads under the map — that it opens on
   * the linked project's study area, and which area that is.
   */
  it("tells a resident which area frames the map, on the page they actually open", async () => {
    const page = await PublicEngagementPage({
      params: Promise.resolve({ shareToken: "share-token-12345" }),
    });

    render(page);

    expect(
      screen.getByText(/This map opens on Franklin County, Ohio — the linked project's study area\./i)
    ).toBeInTheDocument();
    // The continental instruction belongs only to a campaign nothing framed.
    expect(screen.queryByText(/zoom to your neighbourhood before dropping a pin/i)).toBeNull();
  });

  it("shows linked project context on the public engagement page", async () => {
    const page = await PublicEngagementPage({
      params: Promise.resolve({ shareToken: "share-token-12345" }),
    });

    render(page);

    expect(screen.getByText("Linked project: Downtown Mobility Plan")).toBeInTheDocument();
    expect(screen.getByText("This input supports")).toBeInTheDocument();
    expect(screen.getAllByText("Downtown Mobility Plan").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Submission status")).toBeInTheDocument();
    expect(screen.getByText("Submissions open")).toBeInTheDocument();
    expect(screen.getByText("Published feedback")).toBeInTheDocument();
    expect(screen.getByText("Engagement mode")).toBeInTheDocument();
    expect(screen.getByText("map feedback")).toBeInTheDocument();
    expect(
      screen.getAllByText(/A planning effort focused on safety, access, and street operations in the downtown core\./i).length
    ).toBeGreaterThanOrEqual(1);
  });

  /**
   * The reachability seam, and the reason this test exists at the PAGE rather
   * than at the loader or the map component.
   *
   * The importer, the route, the storage, the RLS policy and the paint module
   * all shipped complete, tested and green — and `loadParticipantContextLayers`
   * had no caller on any public surface, so no resident could ever see a layer.
   * Every one of those unit tests kept passing while the capability did not
   * exist for anybody. That failure is invisible to the type checker too: the
   * portal's `contextLayers` prop was optional, so omitting it compiled.
   *
   * So this asserts the whole path — page → bundle → published-only query — and
   * fails if the caller is removed again.
   */
  it("asks for this campaign's published layers on the page a resident opens", async () => {
    await PublicEngagementPage({
      params: Promise.resolve({ shareToken: "share-token-12345" }),
    });

    expect(fromMock).toHaveBeenCalledWith("engagement_context_layers");
    expect(contextLayersEqCampaignMock).toHaveBeenCalledWith("campaign_id", "11111111-1111-4111-8111-111111111111");
    // The filter that keeps an unpublished layer away from an anonymous reader.
    // Dropping it would widen the public read, not merely show more.
    expect(contextLayersEqVisibleMock).toHaveBeenCalledWith("visible_to_participants", true);
  });
});
