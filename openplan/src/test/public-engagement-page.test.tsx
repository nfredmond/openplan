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

/**
 * The portal now reads a THIRD row from `engagement_campaigns`: the language the
 * campaign's own text was written in. It is a separate select on purpose (see
 * `loadPortalTranslationIndex`), so the fake client routes on it separately.
 */
const selectsContentLocale = (columns: string) => columns.trim() === "default_content_locale";

const campaignPlaceMaybeSingleMock = vi.fn();
const campaignContentLocaleMaybeSingleMock = vi.fn();
const campaignSelectMock = vi.fn((columns: string) => {
  if (selectsPlaceColumns(columns)) return { eq: () => ({ maybeSingle: campaignPlaceMaybeSingleMock }) };
  if (selectsContentLocale(columns)) {
    return { eq: () => ({ maybeSingle: campaignContentLocaleMaybeSingleMock }) };
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

    acceptLanguageHeader = null;
    // No operator translations and no stated source language: the ordinary
    // shape of a campaign nobody has translated yet.
    translationsEqLocaleMock.mockResolvedValue({ data: [], error: null });
    campaignContentLocaleMaybeSingleMock.mockResolvedValue({
      data: { default_content_locale: null },
      error: null,
    });
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
    await renderPage({ lang: "so" });

    expect(screen.getByText(/not available here/i)).toBeInTheDocument();
    expect(screen.getByText(/\(so\)/)).toBeInTheDocument();
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
});
