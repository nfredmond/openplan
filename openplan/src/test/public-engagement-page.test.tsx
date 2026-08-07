import { fireEvent, render, screen, within } from "@testing-library/react";
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

/**
 * The portal now reads a THIRD row from `engagement_campaigns`: the language the
 * campaign's own text was written in. It is a separate select on purpose (see
 * `loadPortalTranslationIndex`), so the fake client routes on it separately.
 */
const selectsContentLocale = (columns: string) => columns.trim() === "default_content_locale";

/**
 * And a FOURTH: whether this campaign refuses pins outside its own area
 * (20260730000002). Split out for the same reason as the two above — folding a
 * brand-new column into the main select would 404 the whole portal in the window
 * between a deploy and its migration — so the double routes on it separately.
 */
const selectsSubmissionGeofence = (columns: string) =>
  columns.trim() === "submission_geofence_enabled";

const campaignPlaceMaybeSingleMock = vi.fn();
const campaignContentLocaleMaybeSingleMock = vi.fn();
const campaignGeofenceMaybeSingleMock = vi.fn();
const campaignSelectMock = vi.fn((columns: string) => {
  if (selectsPlaceColumns(columns)) return { eq: () => ({ maybeSingle: campaignPlaceMaybeSingleMock }) };
  if (selectsContentLocale(columns)) {
    return { eq: () => ({ maybeSingle: campaignContentLocaleMaybeSingleMock }) };
  }
  if (selectsSubmissionGeofence(columns)) {
    return { eq: () => ({ maybeSingle: campaignGeofenceMaybeSingleMock }) };
  }
  return { eq: campaignEqTokenMock };
});

// loadPortalTranslationIndex — select → eq(campaign_id) → eq(locale).
const translationsEqLocaleMock = vi.fn();
const translationsEqCampaignMock = vi.fn(() => ({ eq: translationsEqLocaleMock }));
const translationsSelectMock = vi.fn(() => ({ eq: translationsEqCampaignMock }));

/**
 * The request header, which `loadPublicPortalBundle` reads through
 * `readAcceptLanguageHeader`. Mocked rather than left to throw so the
 * Accept-Language branch is exercised by something real — that branch is what
 * serves a resident whose phone is already set to their language.
 */
let acceptLanguageHeader: string | null = null;
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => (name === "accept-language" ? acceptLanguageHeader : null) }),
}));

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

// loadSurveyDefinition — questions:
//   select → eq(campaign) → eq(is_active) → eq(status) → order → order.
// The `.eq()` links chain into themselves rather than being counted, so adding
// a filter to the live-survey read is not a reason for this file to fail. The
// arguments each filter was called with are recorded and asserted below —
// which is the part that actually matters, and which a fixed-length chain was
// not doing.
const surveyQuestionsOrderCreatedMock = vi.fn().mockResolvedValue({ data: [], error: null });
const surveyQuestionsOrderSortMock = vi.fn(() => ({ order: surveyQuestionsOrderCreatedMock }));
const surveyQuestionsEqMock = vi.fn(() => surveyQuestionsChain);
const surveyQuestionsChain = {
  eq: surveyQuestionsEqMock,
  order: surveyQuestionsOrderSortMock,
};
const surveyQuestionsSelectMock = vi.fn(() => surveyQuestionsChain);

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
  if (table === "engagement_content_translations") {
    return { select: translationsSelectMock };
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
import {
  loadPublicPortalResult,
  PortalReadUnavailableError,
  type PublicPortalBundle,
} from "@/lib/engagement/public-portal-data";

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
        // 20260730000001 — how a resident who cannot use this page takes part
        // anyway. Present on the fixture because the page's `.select()` asks for
        // it, and a fixture that omits a projected column silently renders the
        // absent-value branch forever.
        accessibility_contact_label: "ADA Coordinator",
        accessibility_contact_email: "access@city.example",
        accessibility_contact_phone: null,
        accessibility_alternate_formats: "Paper copies at the front desk.",
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

    acceptLanguageHeader = null;
    // No operator translations and no stated source language: the ordinary
    // shape of a campaign nobody has translated yet.
    translationsEqLocaleMock.mockResolvedValue({ data: [], error: null });
    campaignContentLocaleMaybeSingleMock.mockResolvedValue({
      data: { default_content_locale: null },
      error: null,
    });
    // Off by default, which is what every campaign that existed before
    // 20260730000002 looks like.
    campaignGeofenceMaybeSingleMock.mockResolvedValue({
      data: { submission_geofence_enabled: false },
      error: null,
    });
    /*
      RE-SEEDED EVERY TEST, and it has to be. `vi.clearAllMocks()` clears
      recorded calls but NOT resolved values, so the declaration-site default is
      only ever in force until the first test that overrides it — after which a
      forced read failure leaks silently into every test below. That is the exact
      shape of a green suite proving nothing, and it cost one wrong assertion in
      this file before it was noticed.
    */
    closeLoopOrderCreatedMock.mockResolvedValue({ data: [], error: null });
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

  /**
   * A PORTAL MUST NOT INVITE A PIN IT IS GOING TO REFUSE.
   *
   * The campaign-area check (20260730000002) is enforced in the submit route,
   * which a resident meets only AFTER writing their comment and placing their
   * pin. This is the half that reaches them first: one sentence, beside the
   * sentence that already says where the map opens, on the real page — and it
   * carries the way through, because a comment with no pin is never refused.
   */
  it("warns a resident, before they drop a pin, when a campaign only accepts pins inside its area", async () => {
    campaignPlaceMaybeSingleMock.mockResolvedValue({
      data: {
        place_source: "drawn",
        place_label: "the Broad Street corridor",
        place_min_lon: -83.05,
        place_min_lat: 39.95,
        place_max_lon: -83.0,
        place_max_lat: 39.98,
      },
      error: null,
    });
    campaignGeofenceMaybeSingleMock.mockResolvedValue({
      data: { submission_geofence_enabled: true },
      error: null,
    });

    render(await PublicEngagementPage({ params: Promise.resolve({ shareToken: "share-token-12345" }) }));

    expect(
      screen.getByText(/Anything you mark on this map has to be inside the Broad Street corridor/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/a comment sent without a location is accepted from anywhere/i)
    ).toBeInTheDocument();
  });

  it("says nothing about a location rule on a campaign that has not asked for one", async () => {
    // The default, and every campaign that existed before the migration. A
    // sentence about a rule that is not in force is a false statement to the
    // public, not a harmless extra.
    render(await PublicEngagementPage({ params: Promise.resolve({ shareToken: "share-token-12345" }) }));

    expect(screen.queryByText(/has to be inside/i)).toBeNull();
  });

  it("asks the database whether this campaign refuses pins outside its area", async () => {
    // The projection assertion, not the behavioural one: the double answers with
    // its fixture whatever was selected, so a loader that never asked for the
    // flag would pass the two tests above.
    await PublicEngagementPage({ params: Promise.resolve({ shareToken: "share-token-12345" }) });

    const projections = campaignSelectMock.mock.calls.map((call) => call[0] as string);
    expect(projections).toContain("submission_geofence_enabled");

    // And it is asked for on its own, never welded onto the gate query — a
    // column that does not exist yet must not be able to 404 the whole portal.
    const gateProjection = projections.find((columns) => columns.includes("allow_public_submissions"));
    expect(gateProjection).toBeDefined();
    expect(gateProjection).not.toContain("submission_geofence_enabled");
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
    // Was `map feedback` — the raw enum with its underscore removed, which is
    // English shown to every reader in every language. It is now a catalog key,
    // so the mode is a phrase a resident can read in their own language.
    expect(screen.getAllByText("Map-based community input").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Mode: Map-based community input")).toBeInTheDocument();
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

  /**
   * THE LANGUAGE REACHABILITY SEAM.
   *
   * A locale resolver, a message catalog and a picker can all be complete,
   * typed and green while a resident still gets an English page — the prop is
   * not passed at the render site, or the page never reads the search param.
   * That is the defect this repo has paid for six times, so every assertion
   * below drives the REAL page and asks what a person would see.
   */
  const renderPage = async (search?: Record<string, string | string[]>) =>
    render(
      await PublicEngagementPage({
        params: Promise.resolve({ shareToken: "share-token-12345" }),
        searchParams: search ? Promise.resolve(search) : undefined,
      })
    );

  const portalSection = (container: HTMLElement) => container.querySelector("section.public-page");

  it("opens in the language a shared link names", async () => {
    const { container } = await renderPage({ lang: "es" });

    // The chrome, from the catalog — not a machine call at request time.
    expect(screen.getByText("Participación comunitaria")).toBeInTheDocument();
    expect(screen.getByText("Estado de los comentarios")).toBeInTheDocument();
    expect(portalSection(container)?.getAttribute("lang")).toBe("es");
  });

  /**
   * A COMPLETE CATALOG IS NOT A FULLY TRANSLATED PAGE, and the notice has to
   * track the page rather than the catalog.
   *
   * Spanish is the one locale whose catalog answers every key OpenPlan has
   * defined, so `translator.hasFallbacks` is false and the page-wide
   * `PortalLanguageNotice` is correctly silent. English is still on screen
   * anyway, from two sources the catalog knows nothing about: the campaign's
   * own title and description, which the agency has not translated here, and
   * every `PENDING_PORTAL_TEXT` string that has no catalog key yet. Saying
   * nothing would tell a resident the agency chose to publish that English.
   *
   * Asserting the absence of the sentence — which is what this test used to do
   * — encoded the opposite claim, and it was wrong in the direction that costs
   * a Title VI product the most.
   */
  it("still says parts are English when the catalog is complete but the page is not", async () => {
    await renderPage({ lang: "es" });

    expect(screen.getAllByText(/solo está disponible parcialmente/i)).toHaveLength(1);
  });

  it("discloses the gap once, not twice, on a language with no catalog", async () => {
    // Korean has no catalog, so `hasFallbacks` is true, the page-wide notice
    // speaks, and `PortalPendingCopyNotice` must stay silent. Both render the
    // same sentence from the same key, and a Korean portal printed it twice —
    // once above the campaign title and once inside the portal. Shown twice, it
    // reads as a bug and teaches a resident to skip both.
    //
    // This is the locale that proves the guard: on Spanish the two conditions
    // cannot both be true, so a Spanish-only assertion would pass with the
    // deduplication deleted.
    await renderPage({ lang: "ko" });

    expect(screen.getAllByText(/only partly available/i)).toHaveLength(1);
  });

  /**
   * THE MOUNT, not the component.
   *
   * `PortalAccessibilityNotice` has its own tests. This asserts the thing those
   * cannot: that the real page actually renders it, from a real `.select()` that
   * actually asks for the columns. That gap — a complete component reached by
   * nothing, or reached with a column missing from the projection — is the
   * defect this repo has shipped eight times.
   */
  it("offers a resident who cannot use the page a way to take part anyway", async () => {
    await renderPage();

    expect(screen.getByText(/If you cannot use this page/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "access@city.example" })).toBeInTheDocument();
    expect(screen.getByText("Paper copies at the front desk.")).toBeInTheDocument();
  });

  /**
   * THE PROJECTION, which a mocked client cannot catch by itself.
   *
   * `campaignMaybeSingleMock` returns the whole fixture regardless of what the
   * `.select()` asked for, so deleting a column from the projection leaves every
   * other assertion in this file green while the real page renders `undefined`.
   * That is not hypothetical: this repo shipped exactly that defect — closure
   * provenance landed with migration, routes, audit and UI complete, and neither
   * page added the columns to its `.select()`, so the honest "not loaded" state
   * was what everyone saw, permanently.
   *
   * The Supabase clients here are deliberately untyped, so `tsc` cannot see this
   * either. Asserting on the projection string is the only thing that can.
   */
  it("asks the database for the columns it renders", async () => {
    await renderPage();

    const projections = campaignSelectMock.mock.calls.map((call) => call[0] as string);
    const campaignProjection = projections.find((columns) => columns.includes("public_description"));

    expect(campaignProjection).toBeDefined();
    for (const column of [
      "accessibility_contact_label",
      "accessibility_contact_email",
      "accessibility_contact_phone",
      "accessibility_alternate_formats",
    ]) {
      expect(campaignProjection).toContain(column);
    }
  });

  it("asks only for survey questions that are active AND published", async () => {
    // THE FILTER IS THE WHOLE CONTROL. A draft is a question the Planner Agent
    // may have written and no person has released; the only thing standing
    // between it and a resident's screen is this predicate. A double answers its
    // fixture whether the filter was applied or not, so the arguments are what
    // gets asserted — not the absence of drafts from a fixture that has none.
    await renderPage();

    const filters = surveyQuestionsEqMock.mock.calls.map((call) => call as unknown as [string, unknown]);
    expect(filters).toContainEqual(["is_active", true]);
    expect(filters).toContainEqual(["status", "published"]);
  });

  it("says nothing about translation on the page it is written in", async () => {
    // English is the source, not a fallback from it. Disclosing here would
    // banner every English portal with an apology for its own language.
    await renderPage();

    expect(screen.queryByText(/only partly available/i)).toBeNull();
  });

  it("turns the page around for a right-to-left language", async () => {
    // Two of the eleven languages are RTL. Without this attribute they ship
    // visibly broken, which is the difference between offering Arabic and
    // appearing to offer it.
    const { container } = await renderPage({ lang: "ar" });

    expect(portalSection(container)?.getAttribute("dir")).toBe("rtl");
    expect(portalSection(container)?.getAttribute("lang")).toBe("ar");
  });

  it("stays left-to-right for a language that reads that way", async () => {
    const { container } = await renderPage({ lang: "es" });
    expect(portalSection(container)?.getAttribute("dir")).toBe("ltr");
  });

  it("honours the browser's own language when the link names none", async () => {
    // A resident whose phone is already set to Spanish has told us once. Making
    // them tell us again, in English, on a page they cannot read, is the whole
    // problem restated.
    acceptLanguageHeader = "es-MX,es;q=0.9,en;q=0.4";

    await renderPage();

    expect(screen.getByText("Participación comunitaria")).toBeInTheDocument();
  });

  it("lets an explicit choice beat the browser's language", async () => {
    acceptLanguageHeader = "es-MX,es;q=0.9";

    await renderPage({ lang: "en" });

    expect(screen.getByText("Community engagement")).toBeInTheDocument();
  });

  it("falls back rather than 404s when a link names a language this portal does not carry, and says so", async () => {
    // A forwarded link with a bad language must still open the consultation —
    // and the resident who followed it is owed the sentence explaining why they
    // are not reading what they were promised.
    await renderPage({ lang: "sw" });

    expect(screen.getByText(/not available here/i)).toBeInTheDocument();
    expect(screen.getByText(/\(sw\)/)).toBeInTheDocument();
  });

  it("says which parts of a partly translated page are not translated", async () => {
    // Chinese has no catalog yet. Every string falls back to English, and an
    // English sentence sitting unlabelled inside a page a resident opened in
    // Chinese reads as something the agency chose to write in English.
    await renderPage({ lang: "zh" });

    expect(screen.getByText(/only partly available in 中文/i)).toBeInTheDocument();
  });

  it("offers every language in its own script, in a link that can be shared", async () => {
    // A picker labelled in English is a locked door with the key inside; a
    // picker that only works after hydration strands the residents it is for.
    await renderPage({ lang: "es" });

    const korean = screen.getByRole("link", { name: /한국어/ });
    expect(korean).toHaveAttribute("href", "/engage/share-token-12345?lang=ko");
    expect(screen.getByRole("link", { name: /العربية/ })).toHaveAttribute("hreflang", "ar");
  });

  it("keeps the rest of the URL when the language changes", async () => {
    await renderPage({ lang: "es", tab: "survey" });

    const korean = screen.getByRole("link", { name: /한국어/ });
    expect(korean.getAttribute("href")).toContain("tab=survey");
    expect(korean.getAttribute("href")).toContain("lang=ko");
  });

  it("asks for this campaign's translations in the language the participant is reading", async () => {
    await renderPage({ lang: "vi" });

    expect(fromMock).toHaveBeenCalledWith("engagement_content_translations");
    expect(translationsEqCampaignMock).toHaveBeenCalledWith(
      "campaign_id",
      "11111111-1111-4111-8111-111111111111"
    );
    expect(translationsEqLocaleMock).toHaveBeenCalledWith("locale", "vi");
  });

  it("shows the agency's own translation as the agency's own words", async () => {
    translationsEqLocaleMock.mockResolvedValue({
      data: [
        {
          entity_type: "campaign",
          entity_id: "11111111-1111-4111-8111-111111111111",
          field: "title",
          translated_text: "Campaña de escucha del centro",
          source: "operator",
          machine_model: null,
        },
      ],
      error: null,
    });

    await renderPage({ lang: "es" });

    expect(screen.getByText("Campaña de escucha del centro")).toBeInTheDocument();
    // Operator-authored text carries NO caveat. Adding one would train
    // residents to ignore the badge that appears on text a machine wrote.
    expect(screen.queryByText(/Traducción automática/)).toBeNull();
    expect(screen.queryByText(/Traducido automáticamente/)).toBeNull();
  });

  it("labels a machine translation as one, every time", async () => {
    translationsEqLocaleMock.mockResolvedValue({
      data: [
        {
          entity_type: "campaign",
          entity_id: "11111111-1111-4111-8111-111111111111",
          field: "title",
          translated_text: "Campaña de escucha del centro",
          source: "machine",
          machine_model: "claude-haiku-4-5-20251001",
        },
      ],
      error: null,
    });

    await renderPage({ lang: "es" });

    expect(screen.getByText("Campaña de escucha del centro")).toBeInTheDocument();
    // An agency can be held to what it publishes. A model's wording is not the
    // agency's statement, and rendering the two identically publishes it as one.
    expect(screen.getByText(/Traducido automáticamente por conveniencia/)).toBeInTheDocument();
  });

  it("marks untranslated operator text as untranslated rather than as a choice", async () => {
    await renderPage({ lang: "es" });

    expect(screen.getByText("Downtown listening campaign")).toBeInTheDocument();
    expect(screen.getAllByText(/no ha publicado este texto en Español/).length).toBeGreaterThanOrEqual(1);
  });

  it("never presents a failed translation lookup as an untranslated campaign", async () => {
    // A translation that could not be READ and a translation that was never
    // MADE look identical on screen — the source text, in the source language —
    // and only the second is a fact about this campaign.
    translationsEqLocaleMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "engagement_content_translations" does not exist' },
    });

    await renderPage({ lang: "es" });

    expect(screen.getAllByText(/no pudo cargar sus traducciones/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/no ha publicado este texto en Español/)).toBeNull();
  });

  it("says nothing about translation on the campaign's own language", async () => {
    // The ordinary English portal of an English campaign must not carry a
    // "not translated" notice on every string in the product.
    await renderPage();

    expect(screen.queryByText(/has not published this in/i)).toBeNull();
    expect(screen.queryByText(/only partly available/i)).toBeNull();
  });

  it("names the campaign's stated source language rather than presuming English", async () => {
    // A campaign an agency wrote in Spanish must not be described to a
    // Vietnamese reader as "shown in English".
    campaignContentLocaleMaybeSingleMock.mockResolvedValue({
      data: { default_content_locale: "es" },
      error: null,
    });

    await renderPage({ lang: "vi" });

    expect(screen.getAllByText(/Español/).length).toBeGreaterThanOrEqual(1);
  });

  it("formats the last-updated timestamp in the participant's locale", async () => {
    // A Spanish page with an en-US date is half-done, and for most of this
    // language list a numeric US date names a different day.
    await renderPage({ lang: "es" });

    const spanish = screen.getByText(/Última actualización/).textContent ?? "";
    expect(spanish).not.toContain("3/28/2026");
  });

  /**
   * A READ THAT FAILED IS NOT AN EMPTY CAMPAIGN.
   *
   * `engagement_items` and `engagement_categories` discarded their errors, so a
   * dropped column, a policy change or a permission error rendered as "No
   * published feedback yet. Be the first to share something." — a public portal
   * telling residents that nobody in their community took part, when in fact the
   * query broke. It is the most consequential sentence this page can say: the
   * comment list IS the public record of participation.
   *
   * These drive the REAL page with a failing read, which is the path no test
   * exercised. The loader's own mocks return the fixture whatever is asked, so
   * making a named read answer with an error is the only way to reach it.
   */
  /**
   * The comment list lives behind the "Community feedback" tab, so reaching its
   * empty state means opening that tab — the same two clicks a resident makes.
   * Asserting without opening it would pass against a page that renders nothing
   * at all.
   */
  function openFeedbackTab() {
    fireEvent.click(screen.getByText(/Community feedback/i).closest("button")!);
  }

  it("does not tell residents nobody commented when the comment read failed", async () => {
    itemsLimitMock.mockResolvedValue({ data: null, error: { message: "permission denied" } });

    render(await PublicEngagementPage({ params: Promise.resolve({ shareToken: "share-token-12345" }) }));
    openFeedbackTab();

    expect(screen.queryByText(/No published feedback yet/i)).toBeNull();
    expect(screen.getByText(/Published comments could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByText(/does not mean no one has commented/i)).toBeInTheDocument();
  });

  it("discloses a failed read at the top of the page, above what it affects", async () => {
    itemsLimitMock.mockResolvedValue({ data: null, error: { message: "permission denied" } });

    render(await PublicEngagementPage({ params: Promise.resolve({ shareToken: "share-token-12345" }) }));

    expect(screen.getByText(/Part of this page could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByText(/Anything that looks empty below may not be empty/i)).toBeInTheDocument();
  });

  it("discloses a failed category read as well, not only comments", async () => {
    categoriesOrderCreatedMock.mockResolvedValue({ data: null, error: { message: "relation does not exist" } });

    render(await PublicEngagementPage({ params: Promise.resolve({ shareToken: "share-token-12345" }) }));

    expect(screen.getByText(/Part of this page could not be loaded/i)).toBeInTheDocument();
  });

  it("never shows the database's own message to a resident", async () => {
    itemsLimitMock.mockResolvedValue({
      data: null,
      error: { message: "permission denied for relation engagement_items" },
    });

    render(await PublicEngagementPage({ params: Promise.resolve({ shareToken: "share-token-12345" }) }));

    // Disclosing THAT a read failed is the honesty requirement. Disclosing HOW
    // is an information leak on a page anyone can open.
    expect(screen.queryByText(/permission denied/i)).toBeNull();
    expect(screen.queryByText(/engagement_items/i)).toBeNull();
  });

  /*
    THESE TWO ASSERT THE RENDER, AND THAT IS THE ENTIRE POINT OF THEM.

    The loader-level tests below already proved `readFailures.closeLoop` and
    `readFailures.comments` are raised. Both passed while the portal component
    accepted only two of the four flags the loader produces — this prop arrives
    by JSX spread, and TypeScript does not excess-property-check a spread, so the
    other two were dropped silently with a green build. A flag that describes a
    failure no surface shows is the same defect as swallowing the failure.

    So: fail a NAMED read, then look at what a resident would actually see.
  */
  it("keeps the close-the-loop tab, and says so, when that read failed", async () => {
    closeLoopOrderCreatedMock.mockResolvedValue({
      data: null,
      error: { message: "permission denied for relation engagement_closeloop_entries" },
    });

    render(await PublicEngagementPage({ params: Promise.resolve({ shareToken: "share-token-12345" }) }));

    // The tab survives. Hiding it would assert the agency never answered its
    // community, which is the one thing this failure must not be allowed to say.
    const tab = screen.getByText(/You said \/ We did/i).closest("button") as HTMLElement;
    expect(tab).toBeInTheDocument();
    // No "(0)" badge either — that is a count of the agency's responses, and
    // this read did not get to take it.
    expect(within(tab).queryByText("(0)")).toBeNull();
    expect(screen.getByText(/Part of this page could not be loaded/i)).toBeInTheDocument();
  });

  it("prints no feedback count at all when the comment read failed", async () => {
    itemsLimitMock.mockResolvedValue({
      data: null,
      error: { message: "permission denied for relation engagement_items" },
    });

    render(await PublicEngagementPage({ params: Promise.resolve({ shareToken: "share-token-12345" }) }));

    // "0" beside "Published feedback" tells a resident nobody spoke. An em dash
    // is the honest reading of a count we could not take.
    const label = screen.getByText("Published feedback");
    const tile = label.closest("div") as HTMLElement;
    expect(within(tile).getByText("—")).toBeInTheDocument();
    expect(within(tile).queryByText("0")).toBeNull();
  });

  it("says the ordinary empty-state when the reads succeeded and there is simply nothing yet", async () => {
    render(await PublicEngagementPage({ params: Promise.resolve({ shareToken: "share-token-12345" }) }));
    openFeedbackTab();

    expect(screen.getByText(/No published feedback yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Part of this page could not be loaded/i)).toBeNull();
  });

  /**
   * A FAILED LOOKUP IS NOT A CONSULTATION THAT DOES NOT EXIST — and this is the
   * worst instance of the class in the product, because of what a 404 says and
   * to whom.
   *
   * The campaign lookup bound no error, so `if (!campaignData) return null` was
   * reached by BOTH "no active campaign carries this token" and "the query
   * failed". Both public surfaces turn that `null` into `notFound()`. An RLS
   * change, a dropped column or a transient outage therefore told a member of
   * the public — on a link their agency printed on a flyer — that the
   * consultation does not exist. The neighbouring reads in the very same
   * function already kept their errors; the one that decides whether the page
   * exists at all was the one that was skipped.
   */
  it("does not tell a resident the consultation does not exist when the lookup failed", async () => {
    campaignMaybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: "permission denied for relation engagement_campaigns" },
    });

    await expect(
      PublicEngagementPage({ params: Promise.resolve({ shareToken: "share-token-12345" }) })
    ).rejects.toBeInstanceOf(PortalReadUnavailableError);

    // THE CLAIM THAT HAD TO GO. `notFound()` renders "this page does not exist",
    // which is a statement about the agency's consultation that a read failure
    // cannot support.
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("still 404s when the lookup succeeded and no active campaign carries the token", async () => {
    campaignMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    await expect(
      PublicEngagementPage({ params: Promise.resolve({ shareToken: "share-token-12345" }) })
    ).rejects.toThrow("notFound");

    // A read that SUCCEEDED and found nothing. This 404 is the truth, and the
    // fix above must not have blurred it into an error page.
    expect(notFoundMock).toHaveBeenCalled();
  });

  /**
   * THE LOADER'S OWN ANSWER, asserted directly.
   *
   * `loadPublicPortalResult` is the entry point that can name the three cases
   * apart, and the two page assertions above can only observe the first of them
   * through a thrown error. These drive the same real loader over the same real
   * fake client and check what it actually reports — including the two failures
   * whose disclosure still has nowhere to render (see `readFailures`).
   */
  describe("loadPublicPortalResult", () => {
    it("reports the campaign lookup as unreadable rather than as absent", async () => {
      campaignMaybeSingleMock.mockResolvedValue({
        data: null,
        error: { message: "permission denied for relation engagement_campaigns" },
      });

      const result = await loadPublicPortalResult("share-token-12345");

      expect(result.status).toBe("unreadable");
      expect(result).not.toMatchObject({ status: "absent" });
    });

    it("reports absent only when the lookup answered with no row", async () => {
      campaignMaybeSingleMock.mockResolvedValue({ data: null, error: null });

      expect((await loadPublicPortalResult("share-token-12345")).status).toBe("absent");
    });

    /**
     * THE ONE FAILURE THAT DAMAGES THE AGENCY RATHER THAN THE READER. The portal
     * hides the "You said / We did" tab entirely when the entry list is empty,
     * so a swallowed error removed the evidence that an agency answered its
     * community and left nothing on screen to doubt.
     */
    it("reports a failed close-the-loop read instead of an agency that never answered", async () => {
      closeLoopOrderCreatedMock.mockResolvedValue({
        data: null,
        error: { message: "permission denied for relation engagement_closeloop_entries" },
      });

      const result = await loadPublicPortalResult("share-token-12345");

      expect(result.status).toBe("ok");
      const bundle = (result as { status: "ok"; bundle: PublicPortalBundle }).bundle;
      expect(bundle.portalProps.readFailures.closeLoop).toBe(true);
      // The empty list is still empty — the point is that it now arrives beside
      // the reason, instead of alone and indistinguishable from "none published".
      expect(bundle.portalProps.closeLoopEntries).toEqual([]);
    });

    it("reports a failed project read instead of a standalone consultation", async () => {
      projectMaybeSingleMock.mockResolvedValue({
        data: null,
        error: { message: "permission denied for relation projects" },
      });

      const result = await loadPublicPortalResult("share-token-12345");
      const bundle = (result as { status: "ok"; bundle: PublicPortalBundle }).bundle;

      expect(bundle.portalProps.readFailures.project).toBe(true);
      expect(bundle.project).toBeNull();
    });

    it("claims no read failure when every read answered", async () => {
      const result = await loadPublicPortalResult("share-token-12345");
      const bundle = (result as { status: "ok"; bundle: PublicPortalBundle }).bundle;

      expect(bundle.portalProps.readFailures).toEqual({
        comments: false,
        categories: false,
        closeLoop: false,
        project: false,
      });
    });

    /**
     * A CAMPAIGN WITH NO LINKED PROJECT IS NOT A FAILED PROJECT READ. Nothing was
     * read for, so there is no error to carry — the one branch in this loader
     * where "no project" is a fact rather than a silence.
     */
    it("does not invent a project read failure for a standalone campaign", async () => {
      campaignMaybeSingleMock.mockResolvedValue({
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          workspace_id: "33333333-3333-4333-8333-333333333333",
          project_id: null,
          title: "Downtown listening campaign",
          summary: null,
          public_description: null,
          status: "active",
          engagement_type: "map_feedback",
          allow_public_submissions: true,
          submissions_closed_at: null,
          updated_at: "2026-03-28T18:00:00.000Z",
          accessibility_contact_label: null,
          accessibility_contact_email: null,
          accessibility_contact_phone: null,
          accessibility_alternate_formats: null,
        },
        error: null,
      });

      const result = await loadPublicPortalResult("share-token-12345");
      const bundle = (result as { status: "ok"; bundle: PublicPortalBundle }).bundle;

      expect(bundle.portalProps.readFailures.project).toBe(false);
    });
  });
});
