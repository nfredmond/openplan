import { render, screen, within } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PORTAL_LOCALES } from "@/lib/engagement/portal-i18n/locales";

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

/**
 * The campaign's recorded content language, read SEPARATELY from the campaign
 * row it lives on.
 *
 * The split is deliberate in the loader — `default_content_locale` arrives with
 * 20260729000004, and folding it into the main campaign select would 404 the
 * whole console in the window before that migration is applied — so the double
 * has to model it as a separate read, keyed on the projection, or the page tests
 * cannot reach the state every unmigrated deployment is actually in.
 */
let sourceLocaleResult: { data: unknown; error: { message: string } | null } = { data: null, error: null };

const campaignSelectMock = vi.fn((columns?: string) => {
  if (columns === "default_content_locale") {
    return { eq: () => ({ maybeSingle: async () => sourceLocaleResult }) };
  }
  return { eq: campaignEqMock };
});

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

/**
 * The campaign's per-locale operator translations, and whether that read works.
 *
 * `null` rows with an error is the state a deployment is genuinely in before
 * 20260729000004 is applied, so it is modelled rather than assumed away: the
 * console has to say "unknown", never "translated into nothing".
 */
let translationRows: Array<Record<string, unknown>> = [];
let translationReadError: { message: string } | null = null;

/**
 * A failure of the read that lists what a participant reads — as opposed to the
 * read of what has been translated. Separate, because they license different
 * sentences: one makes coverage unknown, the other makes it UNMEASURABLE,
 * because the list it would be measured against is short.
 */
let surveyQuestionsReadError: { message: string } | null = null;

/**
 * A chainable tolerant of ANY number of `.eq()` / `.order()` calls.
 *
 * Needed because three of these tables are now read by two loaders with
 * different filter counts: `loadSurveyBuilderDefinition` reads every question,
 * while the translation inventory reads only the ACTIVE ones (and only PUBLISHED
 * close-loop entries), because an archived question is not part of what a
 * participant reads and so is not part of what "translated" measures. A chain
 * hard-coded to one `.eq()` would make the second loader a TypeError.
 */
function flexibleChain(result: () => { data: unknown[]; error: { message: string } | null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "in"]) chain[method] = () => chain;
  chain.then = (resolve: (value: { data: unknown[]; error: { message: string } | null }) => unknown) =>
    resolve(result());
  return chain;
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
  // Survey definition tables — read by `loadSurveyBuilderDefinition` (all
  // questions) and by the translation inventory (active questions only).
  if (table === "engagement_survey_questions") {
    return {
      // Keyed on the PROJECTION so a test can fail the translation inventory's
      // read on its own. The survey builder reads the same table with a wider
      // projection, and failing both at once would be testing two things and
      // proving neither.
      select: (columns?: string) =>
        flexibleChain(() => ({
          data: [],
          error: columns === "id, prompt, help_text" ? surveyQuestionsReadError : null,
        })),
    };
  }
  if (table === "engagement_survey_question_options") {
    return flexibleChain(() => ({ data: [], error: null }));
  }
  // Close-loop entries — `loadCloseLoopEntries` (all) and the translation
  // inventory (published only).
  if (table === "engagement_closeloop_entries") {
    return flexibleChain(() => ({ data: [], error: null }));
  }
  if (table === "engagement_content_translations") {
    return flexibleChain(() => ({
      data: translationReadError ? [] : translationRows,
      error: translationReadError,
    }));
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
    translationRows = [];
    translationReadError = null;
    sourceLocaleResult = { data: null, error: null };
    surveyQuestionsReadError = null;
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

  /**
   * THE REACHABILITY SEAM FOR TRANSLATION.
   *
   * Six times this week a capability shipped complete, tested and role-gated,
   * and no planner could reach it — a prop never passed at the render site, a
   * column never added to a `.select()`, a loader with no caller. The
   * translation store, its resolver and every participant surface already
   * existed and NOTHING WROTE THEM, which is the same defect one step earlier.
   *
   * So these assertions are at the point where a translation becomes SOMETHING
   * A PERSON DOES: the panel is on the console an operator opens, it was handed
   * this campaign's real strings, its controls follow the same role decision the
   * write route enforces, and a failed read is not rendered as an untranslated
   * campaign.
   */
  describe("the campaign's translations", () => {
    it("puts the translation panel on the console an operator actually opens", async () => {
      await renderPage();

      expect(
        screen.getByRole("heading", { name: /publish this campaign in your community.s languages/i })
      ).toBeInTheDocument();
    });

    it("hands the panel this campaign's own strings, not an empty inventory", async () => {
      await renderPage();

      // The seam: these strings exist inside the panel only because the page
      // built the inventory and passed it. A panel handed `undefined` renders
      // the same chrome with nothing to translate, which looks identical to a
      // campaign that has no participant-facing text.
      const campaignGroup = screen.getByRole("region", { name: "This campaign" });
      expect(within(campaignGroup).getByText("Campaign title")).toBeInTheDocument();
      expect(within(campaignGroup).getByText("Downtown listening campaign")).toBeInTheDocument();
      expect(within(campaignGroup).getByText("Campaign summary")).toBeInTheDocument();
      expect(within(campaignGroup).getByText("Collect downtown safety feedback.")).toBeInTheDocument();
      // …and the category the campaign really has, under its own heading.
      const topicGroup = screen.getByRole("region", { name: "Topic: Safety" });
      expect(within(topicGroup).getByText("Topic name")).toBeInTheDocument();
      expect(within(topicGroup).getByText("Safety comments")).toBeInTheDocument();
    });

    it("gives every editor the target language's own direction and language tag", async () => {
      await renderPage();

      // Arabic and Farsi are two of the eleven. An editor that reads
      // left-to-right is unusable for them, and a screen reader told the wrong
      // language is close to unintelligible — so this is asserted on the real
      // control, not on a constant.
      const editors = screen.getAllByLabelText(/^In .*Spanish/);
      expect(editors.length).toBeGreaterThan(0);
      expect(editors[0]).toHaveAttribute("lang", "es");
      expect(editors[0]).toHaveAttribute("dir", "ltr");
    });

    it("shows what a language can be claimed to be, per language", async () => {
      translationRows = [
        {
          entity_type: "campaign",
          entity_id: "campaign-1",
          field: "title",
          locale: "es",
          translated_text: "Campaña de escucha del centro",
          source: "operator",
          machine_model: null,
          source_text_hash: null,
        },
      ];

      await renderPage();

      // One of four strings translated is PARTLY translated, and the panel says
      // so rather than rounding up to a language the agency has published in.
      expect(screen.getByText(/Your text: 1 of 4 strings translated/)).toBeInTheDocument();
      expect(screen.getAllByText("Partly translated").length).toBeGreaterThan(0);
      expect(screen.getByText("Your agency’s wording")).toBeInTheDocument();
    });

    it("marks a machine translation as machine and says what accepting it does", async () => {
      translationRows = [
        {
          entity_type: "campaign",
          entity_id: "campaign-1",
          field: "title",
          locale: "es",
          translated_text: "Campaña de escucha del centro",
          source: "machine",
          machine_model: "claude-haiku-4-5-20251001",
          source_text_hash: null,
        },
      ];

      await renderPage();

      expect(screen.getByText(/Machine translation — participants are told/)).toBeInTheDocument();
      // The consequence, before the click: accepting removes the caveat a
      // resident is reading and publishes the words as the agency's own.
      expect(screen.getByText(/Accepting makes these words your agency's own/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /accept as our wording/i })).toBeInTheDocument();
    });

    it("offers a viewer no translation control the route would refuse", async () => {
      membershipMaybeSingleMock.mockResolvedValue({
        data: { workspace_id: "workspace-1", role: "viewer" },
        error: null,
      });

      await renderPage();

      // A viewer still sees coverage — "what have we published in Spanish" is a
      // question they are entitled to answer — and gets no way to change it.
      // One card per language that is not the campaign's own, DERIVED from the
      // taxonomy: this was a hardcoded 10 until the 2026 expansion, which is a
      // number that says nothing about the behaviour under test and breaks every
      // time the portal learns a language.
      expect(screen.getAllByText(/Your text: 0 of 4 strings translated/)).toHaveLength(
        PORTAL_LOCALES.length - 1
      );
      expect(screen.queryByRole("button", { name: /save as our wording/i })).not.toBeInTheDocument();
      expect(screen.getByText(/translations but not change them/i)).toBeInTheDocument();
    });

    it("says coverage is unknown rather than zero when the translations cannot be read", async () => {
      // The live state of any deployment that has not applied 20260729000004.
      translationReadError = { message: 'relation "engagement_content_translations" does not exist' };

      await renderPage();

      expect(screen.getByText(/does not have the translation storage yet/i)).toBeInTheDocument();
      expect(screen.getByText(/That is not the same as none/)).toBeInTheDocument();
      // The claim that must not be made out of a database failure.
      expect(screen.queryByText("Not translated")).not.toBeInTheDocument();
      expect(screen.queryByText(/strings translated/)).not.toBeInTheDocument();
    });

    it("does not tell an operator nobody recorded a language it merely could not read", async () => {
      // The OTHER half of the same unapplied migration, and the one that was
      // getting through: 20260729000004 adds `default_content_locale` as well as
      // the table, and a missing COLUMN reports itself completely differently
      // from a missing table. The page was rendering that failure as "nobody has
      // recorded which language this campaign is written in" — a finding about
      // the agency, manufactured out of a query that never returned.
      sourceLocaleResult = {
        data: null,
        error: { message: "column engagement_campaigns.default_content_locale does not exist" },
      };

      await renderPage();

      expect(screen.queryByText(/Nobody has recorded which language/)).not.toBeInTheDocument();
      expect(screen.getByText(/could not be read, so OpenPlan is falling back/)).toBeInTheDocument();
      // And it is a pending migration, not a fault to go investigating.
      expect(screen.getByText(/does not have the translation storage yet/i)).toBeInTheDocument();
    });

    it("withholds coverage when part of what participants read could not be listed", async () => {
      // The translations read SUCCEEDS here; the survey questions do not. That
      // shrinks the list "complete" is measured against, and a shrunken list
      // rounds every language UP — the one direction of error this screen
      // cannot make, because "we published in Spanish" is said out loud from it.
      surveyQuestionsReadError = { message: "connection reset" };

      await renderPage();

      expect(
        screen.getByText(/report a language as complete while the strings that failed to load/)
      ).toBeInTheDocument();
      expect(screen.queryByText(/strings translated/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /save as our wording/i })).not.toBeInTheDocument();
    });
  });

  /**
   * A READ THAT FAILED MAY NOT BE RENDERED AS AN ANSWER.
   *
   * Every read on this console used to be destructured as `const { data } =
   * await …`, which is the same `null` for "this campaign has no comments" and
   * "the query failed". The console's empty states are written for the first,
   * so a broken query rendered sentences a moderator has no way to doubt:
   * "No intake items yet" on a live campaign says the community did not
   * respond, and "No categories yet" says the backlog is unclassified.
   *
   * The campaign read was worse than that: it was `if (!campaignData)
   * notFound()`, so a database error rendered the 404 page — a moderator told
   * their campaign does not exist while its share token is public and comments
   * are still arriving. "Could not be read" and "not there" are different
   * facts.
   *
   * Each case below pairs the failure with the success that must still read
   * normally. Without that pair a page that warned unconditionally would pass.
   */
  describe("a read that failed is not rendered as an answer", () => {
    it("says the campaign could not be read instead of 404ing it out of existence", async () => {
      campaignMaybeSingleMock.mockResolvedValueOnce({
        data: null,
        error: { message: "permission denied for table engagement_campaigns" },
      });

      await renderPage();

      expect(notFoundMock).not.toHaveBeenCalled();
      expect(screen.getByText(/This campaign could not be read/i)).toBeInTheDocument();
      expect(screen.getByText(/permission denied for table engagement_campaigns/)).toBeInTheDocument();
      expect(screen.getByText(/not the same as the campaign not existing/i)).toBeInTheDocument();
    });

    it("still 404s a campaign that genuinely is not there", async () => {
      // The control for the case above: a real absence is still a 404. Without
      // it, "never call notFound" would pass and the page would render a
      // reassuring shell for a campaign that does not exist.
      campaignMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

      await expect(renderPage()).rejects.toThrow("notFound");
      expect(notFoundMock).toHaveBeenCalled();
    });

    it("does not tell a moderator nobody commented when the comments could not be read", async () => {
      itemsOrderMock.mockResolvedValueOnce({ data: null, error: { message: "statement timeout" } });

      await renderPage();

      expect(screen.queryByText("No intake items yet")).not.toBeInTheDocument();
      expect(screen.queryByText("No flagged items")).not.toBeInTheDocument();
      expect(screen.getByText(/Part of this campaign could not be read/i)).toBeInTheDocument();
      // Named in the top-of-page disclosure and again where the list would be.
      expect(screen.getAllByText(/the comments on this campaign/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/statement timeout/)).toBeInTheDocument();
      expect(screen.getByText(/This campaign's comments could not be read/i)).toBeInTheDocument();
      // The verdict above is computed over those comments, so it says so.
      expect(screen.getByText(/incomplete rather than a finding/i)).toBeInTheDocument();
      // …and the moderation workload is withheld rather than reported as zero.
      expect(screen.getByText(/Moderation workload unavailable/i)).toBeInTheDocument();
      expect(screen.queryByText("Pending: 0")).not.toBeInTheDocument();
    });

    /**
     * THE FIRST PASS AT THE ABOVE GATED THE HEADER TILES AND THE WORKLOAD LIST
     * AND STOPPED THERE, while the handoff-readiness section below went on
     * rendering every comment-derived figure as a zero. The page's own
     * disclosure sentence promises the opposite in so many words — "shown as
     * unavailable rather than as zero" — so the banner was making a claim about
     * the page that the page did not honour.
     *
     * The sharpest of them was "0 uncategorized" carrying a SUCCESS tone: a
     * green verdict that the moderation backlog is clean, rendered out of a
     * comment table that could not be read. A tone is a finding, and no failed
     * query reaches one.
     */
    it("withholds every comment-derived figure in the handoff section, not just the header tiles", async () => {
      itemsOrderMock.mockResolvedValueOnce({ data: null, error: { message: "statement timeout" } });

      await renderPage();

      // The green "clean backlog" verdict, and the coverage/export figures.
      expect(screen.queryByText(/0 uncategorized/)).not.toBeInTheDocument();
      expect(screen.queryByText(/0 handoff-ready/)).not.toBeInTheDocument();
      expect(screen.queryByText(/still need classification/)).not.toBeInTheDocument();
      expect(screen.queryByText(/ready for GIS\/map export/)).not.toBeInTheDocument();
      expect(screen.queryByText(/0 approved total/)).not.toBeInTheDocument();
      expect(screen.queryByText(/0 total items/)).not.toBeInTheDocument();
      expect(screen.queryByText("0%")).not.toBeInTheDocument();
      // Withheld as a block, and said once rather than left to be inferred.
      expect(screen.getByText(/coverage and workload figures could not be computed/i)).toBeInTheDocument();
    });

    /**
     * The packet button does not merely display the counts — it writes them into
     * the report's stored provenance through `buildEngagementHandoffProvenance`.
     * Seeded from an unread comment table it would record "0 total items" as a
     * captured fact about this campaign, and that record leaves the app with the
     * packet. This is the one place on the console where a failed read outlives
     * the render.
     */
    it("does not offer to seed a packet whose provenance would record unread counts as zero", async () => {
      itemsOrderMock.mockResolvedValueOnce({ data: null, error: { message: "statement timeout" } });

      await renderPage();

      expect(screen.queryByTestId("engagement-report-create-button")).not.toBeInTheDocument();
      expect(screen.getByText(/Packet creation is unavailable until the comments can be read/i)).toBeInTheDocument();
    });

    it("still offers the packet button and the coverage figures when the comments read succeeds", async () => {
      // The control for both cases above. Without it, a console that withheld
      // the packet button and every figure unconditionally would pass them —
      // and withholding a planner's own data is its own defect.
      itemsOrderMock.mockResolvedValueOnce({ data: [], error: null });

      await renderPage();

      expect(screen.getByTestId("engagement-report-create-button")).toBeInTheDocument();
      expect(screen.queryByText(/Packet creation is unavailable/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/coverage and workload figures could not be computed/i)).not.toBeInTheDocument();
      expect(screen.getByText(/0 uncategorized/)).toBeInTheDocument();
      expect(screen.getByText(/still need classification/)).toBeInTheDocument();
      expect(screen.getByText(/ready for GIS\/map export/)).toBeInTheDocument();
    });

    it("still shows the ordinary empty intake state when the read succeeds and there is nothing", async () => {
      itemsOrderMock.mockResolvedValueOnce({ data: [], error: null });

      await renderPage();

      expect(screen.getByText("No intake items yet")).toBeInTheDocument();
      expect(screen.getByText("No flagged items")).toBeInTheDocument();
      expect(screen.getByText("Pending: 0")).toBeInTheDocument();
      expect(screen.queryByText(/Moderation workload unavailable/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Part of this campaign could not be read/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/This campaign's comments could not be read/i)).not.toBeInTheDocument();
    });

    it("does not present an unread category list as a campaign with no categories", async () => {
      categoriesOrderCreatedMock.mockResolvedValueOnce({
        data: null,
        error: { message: "connection reset" },
      });

      await renderPage();

      expect(screen.queryByText("No categories yet")).not.toBeInTheDocument();
      expect(screen.getByText(/This campaign's categories could not be read/i)).toBeInTheDocument();
      expect(screen.getByText(/this campaign's comment categories/i)).toBeInTheDocument();
    });

    it("still shows the ordinary empty category state when the read succeeds", async () => {
      categoriesOrderCreatedMock.mockResolvedValueOnce({ data: [], error: null });

      await renderPage();

      expect(screen.getByText("No categories yet")).toBeInTheDocument();
      expect(screen.queryByText(/This campaign's categories could not be read/i)).not.toBeInTheDocument();
    });

    it("does not call a linked campaign unlinked because the project could not be read", async () => {
      projectMaybeSingleMock.mockResolvedValueOnce({
        data: null,
        error: { message: "connection reset" },
      });

      await renderPage();

      expect(screen.queryByText("Unlinked")).not.toBeInTheDocument();
      expect(screen.queryByText("No project linked yet")).not.toBeInTheDocument();
      expect(screen.queryByText("Unlinked project")).not.toBeInTheDocument();
      // Said where the project would be named, and again where its reports
      // would have been listed.
      expect(screen.getAllByText(/The linked project could not be read/i).length).toBeGreaterThan(1);
      expect(screen.getByText(/this is not an unlinked campaign/i)).toBeInTheDocument();
    });

    it("does not say a project has no reports when the report list could not be read", async () => {
      reportsOrderMock.mockResolvedValueOnce({ data: null, error: { message: "statement timeout" } });

      await renderPage();

      expect(screen.queryByText(/No reports linked through this project yet/i)).not.toBeInTheDocument();
      expect(screen.getByText(/Reports on this project could not be listed/i)).toBeInTheDocument();
      expect(screen.getByText(/reports on the linked project/i)).toBeInTheDocument();
    });

    it("does not label every report project-linked-only out of a failed section read", async () => {
      reportSectionsInMock.mockResolvedValueOnce({ data: null, error: { message: "connection reset" } });

      await renderPage();

      expect(screen.getByText(/Which reports source this campaign could not be read/i)).toBeInTheDocument();
      expect(screen.getByText(/That is the fallback label, not a finding/i)).toBeInTheDocument();
    });
  });
});
