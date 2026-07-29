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

const routerRefreshMock = vi.fn();

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

// The membership row `loadCampaignAccess` reads to decide whether this member
// may change the campaign's map layers. RLS proves the user is IN the
// workspace; only this proves what they are allowed to do there.
const membershipMaybeSingleMock = vi.fn();

/**
 * The campaign's GIS context layers, read twice by the page: once as summaries
 * for the management panel, once — filtered on `visible_to_participants` — as
 * the published geometry the moderators' review map draws. One chainable serves
 * both, and answers according to the filters it was actually given, so a query
 * that forgot the publication filter would be visible here as unpublished
 * geometry arriving at a surface that must not have it.
 */
let contextLayerRows: Array<Record<string, unknown>> = [];
let contextLayerReadError: { message: string } | null = null;

function contextLayerChain(): Record<string, unknown> {
  const filters: Array<[string, unknown]> = [];
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return chain;
    },
    order: () => chain,
    then: (resolve: (value: { data: unknown[]; error: { message: string } | null }) => unknown) => {
      if (contextLayerReadError) return resolve({ data: [], error: contextLayerReadError });
      const publishedOnly = filters.some(([column, value]) => column === "visible_to_participants" && value === true);
      const rows = publishedOnly
        ? contextLayerRows.filter((row) => row.visible_to_participants === true)
        : contextLayerRows;
      return resolve({ data: rows, error: null });
    },
  };
  return chain;
}

function contextLayerRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "layer-1",
    campaign_id: "campaign-1",
    workspace_id: "workspace-1",
    name: "Proposed alignment",
    description: "Centreline as designed at 30% plans",
    source_format: "geojson",
    source_filename: "alignment.geojson",
    source_byte_size: 2048,
    srs_authority: "EPSG",
    srs_code: "4326",
    srs_name: "WGS 84",
    srs_basis: "geojson_rfc7946_default",
    geometry_kinds: ["LineString"],
    feature_count: 1,
    source_feature_count: 1,
    dropped_feature_count: 0,
    truncated: false,
    bbox: [-121.1, 39.2, -121, 39.3],
    display_color: "#38bdf8",
    sort_order: 0,
    visible_to_participants: true,
    created_at: "2026-07-29T00:00:00.000Z",
    updated_at: "2026-07-29T00:00:00.000Z",
    features: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: [[-121.1, 39.2], [-121, 39.3]] },
        },
      ],
    },
    ...overrides,
  };
}

const fromMock = vi.fn((table: string) => {
  if (table === "workspace_members") {
    return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: membershipMaybeSingleMock }) }) }) };
  }
  if (table === "engagement_context_layers") {
    return { select: () => contextLayerChain() };
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
  if (table === "reports") {
    return { select: reportsSelectMock };
  }
  if (table === "report_sections") {
    return { select: reportSectionsSelectMock };
  }
  if (table === "report_artifacts") {
    return { select: reportArtifactsSelectMock };
  }
  // Survey builder definition tables (loadSurveyBuilderDefinition) — empty in these tests.
  if (table === "engagement_survey_questions") {
    return { select: () => ({ eq: () => ({ order: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) };
  }
  if (table === "engagement_survey_question_options") {
    return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) };
  }
  // Close-loop entries (loadCloseLoopEntries) — empty in these tests.
  if (table === "engagement_closeloop_entries") {
    return { select: () => ({ eq: () => ({ order: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) };
  }
  // Operator notifications (loadOperatorNotifications) — select → eq → order → limit.
  if (table === "engagement_notifications") {
    return { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: (...args: unknown[]) => redirectMock(...args),
  // The context-layer panel is a client component that refreshes the route
  // after every write; without this the whole page fails to render.
  useRouter: () => ({ refresh: routerRefreshMock }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/server", () => {
  // Generic empty-result chainable for the service-role client (survey results
  // aggregation + photo signing). Every builder method returns itself; awaiting
  // yields { data: [], error: null }.
  const emptyChain = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order", "limit", "not", "gte"]) chain[method] = () => chain;
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.single = async () => ({ data: null, error: null });
    chain.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null });
    return chain;
  };
  return {
    createClient: (...args: unknown[]) => createClientMock(...args),
    createServiceRoleClient: () => ({
      from: () => emptyChain(),
      storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) },
    }),
  };
});

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

vi.mock("@/components/engagement/engagement-public-link-compact", () => ({
  EngagementPublicLinkCompact: () => <div data-testid="engagement-public-link-compact" />,
}));

vi.mock("@/components/engagement/engagement-bulk-moderation", () => ({
  EngagementBulkModeration: () => <div data-testid="engagement-bulk-moderation" />,
}));

vi.mock("@/components/engagement/engagement-synthesis-panel", () => ({
  EngagementSynthesisPanel: () => <div data-testid="engagement-synthesis-panel" />,
}));
vi.mock("@/components/engagement/representativeness-panel", () => ({
  RepresentativenessPanel: () => <div data-testid="representativeness-panel" />,
}));
vi.mock("@/components/engagement/ai-moderation-panel", () => ({
  AiModerationPanel: () => <div data-testid="ai-moderation-panel" />,
}));

/**
 * The review map stands in for itself, rendering the NAMES of the context
 * layers it was handed.
 *
 * The real component is exercised against a Mapbox double elsewhere; what has
 * to be proven HERE is the seam this repo keeps breaking — that the render site
 * actually passes the prop. A map that silently receives `undefined` looks
 * identical to one that received an empty campaign.
 */
vi.mock("@/components/engagement/location-display-map", () => ({
  LocationDisplayMap: ({ contextLayers }: { contextLayers?: { layers: Array<{ name: string }> } | null }) => (
    <div data-testid="location-display-map">
      {(contextLayers?.layers ?? []).map((layer) => (
        <span key={layer.name}>drawn under review: {layer.name}</span>
      ))}
    </div>
  ),
}));

import EngagementCampaignDetailPage from "@/app/(app)/engagement/[campaignId]/page";

async function renderPage(searchParams?: { created?: string }) {
  render(
    await EngagementCampaignDetailPage({
      params: Promise.resolve({ campaignId: "campaign-1" }),
      searchParams: Promise.resolve(searchParams ?? {}),
    })
  );
}

describe("EngagementCampaignDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    contextLayerRows = [];
    contextLayerReadError = null;
    membershipMaybeSingleMock.mockResolvedValue({
      data: { workspace_id: "workspace-1", role: "admin" },
      error: null,
    });

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
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    });
  });

  it("surfaces campaign-linked packet freshness guidance and handoff readiness", async () => {
    await renderPage();

    expect(screen.getByText(/Campaign handoff decision/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Nearly ready/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/close the campaign when intake is complete/i)).toBeInTheDocument();
    expect(screen.getByText(/Campaign reporting posture/i)).toBeInTheDocument();
    expect(screen.getByText(/Report appendix readiness/i)).toBeInTheDocument();
    expect(screen.getByText(/1 approved public comment ready for appendix review/i)).toBeInTheDocument();
    expect(screen.getByText(/not a representativeness or legal sufficiency finding/i)).toBeInTheDocument();
    expect(screen.getByText(/Comment matrix export preview/i)).toBeInTheDocument();
    expect(screen.getByText(/1 included · 0 held · 0 internal\/private excluded/i)).toBeInTheDocument();
    expect(screen.getByText(/Included in matrix preview/i)).toBeInTheDocument();
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

  it("shows comment matrix inclusion, duplicate hold, and internal/private exclusion posture", async () => {
    itemsOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "item-1",
          campaign_id: "campaign-1",
          category_id: "category-1",
          title: "Safer crossings",
          body: "Add a protected crossing.",
          submitted_by: "Resident",
          status: "approved",
          source_type: "public",
          moderation_notes: "Duplicate reviewed - canonical public comment.",
          latitude: 34.1,
          longitude: -118.2,
          metadata_json: { body_fingerprint: "crossing" },
          created_at: "2026-03-28T20:00:00.000Z",
          updated_at: "2026-03-28T21:30:00.000Z",
        },
        {
          id: "item-2",
          campaign_id: "campaign-1",
          category_id: "category-1",
          title: "Safer crossings",
          body: "Add a protected crossing.",
          submitted_by: "Resident 2",
          status: "approved",
          source_type: "public",
          moderation_notes: null,
          latitude: null,
          longitude: null,
          metadata_json: { body_fingerprint: "crossing" },
          created_at: "2026-03-28T20:05:00.000Z",
          updated_at: "2026-03-28T21:35:00.000Z",
        },
        {
          id: "item-3",
          campaign_id: "campaign-1",
          category_id: "category-1",
          title: "Staff assignment note",
          body: "Follow up internally before the board packet.",
          submitted_by: "Planner",
          status: "approved",
          source_type: "internal",
          moderation_notes: null,
          latitude: null,
          longitude: null,
          metadata_json: { visibility: "private" },
          created_at: "2026-03-28T20:10:00.000Z",
          updated_at: "2026-03-28T21:40:00.000Z",
        },
      ],
      error: null,
    });

    await renderPage();

    expect(screen.getByText(/1 included · 1 held · 1 internal\/private excluded/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Held for duplicate review/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Excluded — internal\/private note/i)).toBeInTheDocument();
    expect(screen.getByText(/does not establish representativeness, legal sufficiency/i)).toBeInTheDocument();
  });

  it("hoists the compact public-link block into the console header", async () => {
    await renderPage();

    expect(screen.getByTestId("engagement-public-link-compact")).toBeInTheDocument();
  });

  it("surfaces the create-success public-link explainer only when arriving from creation", async () => {
    await renderPage({ created: "1" });

    expect(screen.getByText(/Campaign created\./)).toBeInTheDocument();
    // The seeded campaign is active with a token → the banner may call the link live.
    expect(screen.getByText(/public link is live/i)).toBeInTheDocument();
    expect(screen.getByText(/every submission lands in this console's moderation queue/i)).toBeInTheDocument();
  });

  it("keeps the create-success banner honest for a campaign with no live portal", async () => {
    campaignMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "campaign-1",
        workspace_id: "workspace-1",
        project_id: "project-1",
        title: "Downtown listening campaign",
        summary: "Collect downtown safety feedback.",
        status: "draft",
        engagement_type: "comment_collection",
        share_token: null,
        public_description: null,
        allow_public_submissions: false,
        submissions_closed_at: null,
        created_at: "2026-03-01T00:00:00.000Z",
        updated_at: "2026-03-28T22:00:00.000Z",
      },
      error: null,
    });

    await renderPage({ created: "1" });

    expect(screen.getByText(/Campaign created\./)).toBeInTheDocument();
    expect(screen.getByText(/stays offline until a share link is generated/i)).toBeInTheDocument();
    expect(screen.queryByText(/public link is live/i)).toBeNull();
  });

  it("does not show the create-success banner on a normal visit", async () => {
    await renderPage();

    expect(screen.queryByText(/Campaign created\./)).toBeNull();
  });

  it("shows the empty report state when no reports exist for the linked project", async () => {
    reportsOrderMock.mockResolvedValueOnce({ data: [], error: null });

    await renderPage();

    expect(
      screen.getByText(/No reports linked through this project yet/i)
    ).toBeInTheDocument();
  });

  /**
   * THE REACHABILITY SEAM.
   *
   * The importer, the route, the storage, the RLS and the paint module were all
   * built and all tested, and `EngagementContextLayersPanel` appeared in no file
   * outside `src/test/` — so no operator could upload a layer and no resident
   * could see one. A capability a planner cannot reach has not shipped, however
   * green its unit tests are, and this console is where an operator reaches this
   * one. These assertions are on the rendered page for that reason.
   */
  describe("the campaign's GIS context layers", () => {
    it("puts the upload panel on the console a planner actually opens", async () => {
      await renderPage();

      expect(screen.getByText(/Put your project on the map/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /add layer/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/Layer file/i)).toBeInTheDocument();
    });

    it("lists an uploaded layer and hands the published one to the review map", async () => {
      contextLayerRows = [
        contextLayerRow(),
        contextLayerRow({ id: "layer-2", name: "Draft parcels", visible_to_participants: false }),
      ];

      await renderPage();

      // Both layers are the operator's business…
      expect(screen.getByText("Proposed alignment")).toBeInTheDocument();
      expect(screen.getByText("Draft parcels")).toBeInTheDocument();
      expect(screen.getByText("Public")).toBeInTheDocument();
      expect(screen.getByText("Hidden")).toBeInTheDocument();

      // …but only the published one reaches a map, and it reaches it by name.
      expect(screen.getByText(/drawn under review: Proposed alignment/)).toBeInTheDocument();
      expect(screen.queryByText(/drawn under review: Draft parcels/)).not.toBeInTheDocument();
    });

    it("offers a viewer no control the upload route would refuse", async () => {
      // Driven through the same `loadCampaignAccess` gate the route uses, so the
      // console and the API cannot come to disagree about who gets a button.
      membershipMaybeSingleMock.mockResolvedValue({
        data: { workspace_id: "workspace-1", role: "viewer" },
        error: null,
      });
      contextLayerRows = [contextLayerRow()];

      await renderPage();

      expect(screen.getByText("Proposed alignment")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /add layer/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /show to participants/i })).not.toBeInTheDocument();
      expect(screen.getByText(/map layers but not change them/i)).toBeInTheDocument();
    });

    it("says the layer list could not be read instead of showing a campaign with none", async () => {
      contextLayerReadError = { message: "connection reset" };

      await renderPage();

      expect(screen.getByText(/could not be read/i)).toBeInTheDocument();
      expect(screen.getByText(/not a finding/i)).toBeInTheDocument();
      expect(screen.queryByText(/No map layers yet/i)).not.toBeInTheDocument();
    });
  });
});
