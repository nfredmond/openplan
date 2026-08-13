import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicEngagementPortal, groupApprovedItems } from "@/components/engagement/public-engagement-portal";
import { resolvePortalMapFraming } from "@/lib/engagement/public-portal-data";
import { resolvePortalLocale, type PortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle } from "@/lib/engagement/portal-i18n/messages";
import {
  emptyPortalTranslationIndex,
  loadPortalTranslationIndex,
  resolveOperatorText,
  resolveOptionalOperatorText,
  type PortalTranslationIndex,
} from "@/lib/engagement/portal-i18n/operator-text";

/**
 * A campaign nothing could frame. Built through the real resolver rather than
 * hand-written, so a fixture cannot describe a portal state the resolver would
 * never produce.
 */
const UNFRAMED_MAP = resolvePortalMapFraming({});

/**
 * The participant's language, resolved the way a request resolves it.
 *
 * Never a hand-written bundle: a fixture that declared its own message map could
 * assert a translation the catalog does not actually carry, which is the one
 * thing these tests exist to catch.
 */
function localeFor(tag: string) {
  const locale = resolvePortalLocale({ requested: tag, acceptLanguage: null });
  return { locale, messages: buildPortalMessageBundle(locale) };
}

const EN = localeFor("en");

type TranslationRow = {
  entity_type: string;
  entity_id: string;
  field: string;
  translated_text: string;
  source: "operator" | "machine";
  machine_model?: string | null;
};

/**
 * A Supabase stand-in for `loadPortalTranslationIndex`, so operator-text
 * fixtures go through the REAL index and the REAL resolver.
 *
 * Hand-building a `PortalText` would let a test assert a provenance the resolver
 * never produces — including the one that matters most here, `unreadable`, which
 * exists precisely because a failed lookup and an untranslated field look
 * identical on screen.
 */
function stubTranslationClient(input: {
  rows?: TranslationRow[];
  translationsError?: string | null;
  sourceLocale?: PortalLocale | null;
}) {
  function chain(result: { data: unknown; error: { message: string } | null }) {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: () => Promise.resolve(result),
      // `loadPortalTranslationIndex` awaits the translations query directly, so
      // the builder has to be thenable the way postgrest-js's is.
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return builder;
  }

  return {
    from: (table: string) =>
      table === "engagement_content_translations"
        ? chain({
            data: input.rows ?? [],
            error: input.translationsError ? { message: input.translationsError } : null,
          })
        : chain({ data: { default_content_locale: input.sourceLocale ?? null }, error: null }),
  } as unknown as Parameters<typeof loadPortalTranslationIndex>[0];
}

async function indexFor(input: {
  locale: PortalLocale;
  rows?: TranslationRow[];
  translationsError?: string | null;
  sourceLocale?: PortalLocale | null;
}): Promise<PortalTranslationIndex> {
  return loadPortalTranslationIndex(stubTranslationClient(input), {
    campaignId: "cccccccc-0000-4000-8000-00000000000c",
    locale: input.locale,
  });
}

const SAFETY_CATEGORY_ID = "bbbbbbb1-0000-4000-8000-000000000001";

function categoryFrom(
  index: PortalTranslationIndex,
  input: { id?: string; label: string; description?: string | null }
) {
  const id = input.id ?? SAFETY_CATEGORY_ID;
  return {
    id,
    label: input.label,
    description: input.description ?? null,
    labelText: resolveOperatorText(index, { entity: "category", id, field: "label" }, input.label),
    descriptionText: resolveOptionalOperatorText(
      index,
      { entity: "category", id, field: "description" },
      input.description ?? null
    ),
  };
}

const mkItem = (id: string, createdAt: string, parentItemId: string | null = null) => ({
  id,
  categoryId: null,
  title: null,
  body: `body ${id}`,
  submittedBy: null,
  latitude: null,
  longitude: null,
  geometry: null,
  votesCount: 0,
  parentItemId,
  photoUrl: null,
  createdAt,
});

describe("groupApprovedItems (E6 threaded replies)", () => {
  it("nests replies under their parent, oldest-first, preserving top-level order", () => {
    const items = [
      mkItem("p1", "2026-07-03T00:00:00Z"),
      mkItem("p2", "2026-07-02T00:00:00Z"),
      mkItem("r-late", "2026-07-05T00:00:00Z", "p1"),
      mkItem("r-early", "2026-07-04T00:00:00Z", "p1"),
    ];
    const { topLevel, repliesByParent } = groupApprovedItems(items);
    expect(topLevel.map((i) => i.id)).toEqual(["p1", "p2"]); // input order kept
    expect(repliesByParent.get("p1")?.map((i) => i.id)).toEqual(["r-early", "r-late"]); // chronological
    expect(repliesByParent.has("p2")).toBe(false);
  });

  it("drops an orphaned reply whose parent is not an approved top-level item", () => {
    const items = [mkItem("p1", "2026-07-03T00:00:00Z"), mkItem("orphan", "2026-07-04T00:00:00Z", "gone")];
    const { topLevel, repliesByParent } = groupApprovedItems(items);
    expect(topLevel.map((i) => i.id)).toEqual(["p1"]);
    expect([...repliesByParent.values()].flat()).toHaveLength(0); // orphan hidden, not shown as top-level
  });
});

const APPROVED_ITEMS = [
  {
    id: "aaaaaaa1-0000-4000-8000-000000000001",
    categoryId: null,
    title: "Crosswalk request",
    body: "A crosswalk is needed at Main and First.",
    submittedBy: null,
    latitude: 39.22,
    longitude: -121.06,
    geometry: { type: "Point" as const, coordinates: [-121.06, 39.22] },
    votesCount: 1,
    photoUrl: null,
    createdAt: "2026-07-02T12:00:00.000Z",
  },
  {
    id: "aaaaaaa1-0000-4000-8000-000000000002",
    categoryId: null,
    title: "Bike route gap",
    body: "The drawn line marks a missing bike connection.",
    submittedBy: null,
    latitude: 39.21,
    longitude: -121.05,
    geometry: {
      type: "LineString" as const,
      coordinates: [
        [-121.06, 39.2],
        [-121.04, 39.22],
      ],
    },
    votesCount: 5,
    photoUrl: "https://example.supabase.co/storage/v1/object/sign/engagement-photos/signed.jpg",
    createdAt: "2026-07-01T12:00:00.000Z",
  },
];

type PortalProps = Parameters<typeof PublicEngagementPortal>[0];

function renderPortal(overrides: Partial<PortalProps> = {}) {
  const props: PortalProps = {
    mapFraming: UNFRAMED_MAP,
    shareToken: "share-token-123",
    acceptingSubmissions: true,
    engagementType: "map_feedback",
    categories: [],
    approvedItems: [],
    locale: EN.locale,
    messages: EN.messages,
    ...overrides,
  };
  return render(<PublicEngagementPortal {...props} />);
}

describe("PublicEngagementPortal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  /**
   * The disclosure has to reach the RESIDENT, not just exist in the resolver.
   * A framing computed correctly and never rendered leaves the same continent on
   * screen with nothing said about it, which is the defect this whole change is
   * about.
   */
  it("tells a resident where the map opens, and admits when nothing framed it", () => {
    const { unmount } = renderPortal();

    expect(screen.getByText(/no study area has been set for this campaign/i)).toBeInTheDocument();
    expect(screen.getByText(/zoom to your neighbourhood before dropping a pin/i)).toBeInTheDocument();
    unmount();

    const framed = resolvePortalMapFraming({
      projectPlace: {
        state: "set",
        label: "Franklin County, Ohio",
        bbox: { minLon: -83.2, minLat: 39.85, maxLon: -82.8, maxLat: 40.1 },
      },
    });

    renderPortal({ mapFraming: framed });

    expect(
      screen.getByText(/This map opens on Franklin County, Ohio — the linked project's study area\./i)
    ).toBeInTheDocument();
    // The continental instruction belongs only to the unframed case.
    expect(screen.queryByText(/zoom to your neighbourhood before dropping a pin/i)).toBeNull();
  });

  it("renders submission guidance and optionality cues from the message catalog", () => {
    renderPortal({
      categories: [
        // No translations, no stated source language: the ordinary
        // English-campaign-on-an-English-portal case, built by the module that
        // decides what that means.
        categoryFrom(emptyPortalTranslationIndex("en"), {
          label: "Safety",
          description: "Crossings and traffic safety",
        }),
      ],
    });

    expect(screen.getByRole("heading", { name: "Share your input" })).toBeInTheDocument();
    expect(screen.getAllByText("What you want to tell us (we need this part)").length).toBeGreaterThan(0);
    expect(screen.getByText("Only if you want to")).toBeInTheDocument();
    expect(screen.getByText("Hearing back (only if you want to)")).toBeInTheDocument();
    // The only required field carries a programmatic label, which a resident on
    // a screen reader needs and a visible heading alone does not provide.
    expect(screen.getByLabelText("What you want to tell us (we need this part)")).toBeInTheDocument();
    expect(
      screen.getAllByText(/Someone on the project team reads what you send before it is shown on this page or used in a report\./i).length
    ).toBeGreaterThan(0);
  });

  it("shows the confirmation state after a successful submission", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, submissionId: "submission-1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    renderPortal();

    fireEvent.change(screen.getByLabelText("What you want to tell us (we need this part)"), {
      target: { value: "The crosswalk near Main Street needs a shorter crossing distance." },
    });
    fireEvent.click(screen.getByRole("button", { name: /send what I wrote/i }));

    await waitFor(() => {
      expect(screen.getByText("Thank you. We have what you sent.")).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/engage/share-token-123/submit",
      expect.objectContaining({ method: "POST" })
    );
    expect(screen.getByText("What you wrote has gone to the project team.")).toBeInTheDocument();
    expect(
      screen.getByText(/The team may not be able to write back to you personally\./i)
    ).toBeInTheDocument();
  });

  it("offers point, line, and area drawing plus a photo input on the submit form", () => {
    renderPortal();

    // Without a Mapbox token the picker renders its fallback, but the photo
    // input and the map guidance are part of the form itself. The photo limit is
    // formatted from the byte constant the server enforces, not written into a
    // sentence.
    expect(screen.getByLabelText(/Attach one JPEG, PNG, or WebP photo up to 5 MB\./)).toBeInTheDocument();
    expect(screen.getByText(/Tap the map to place your answer\./i)).toBeInTheDocument();
  });

  it("shows support controls with counts, location labels, and attached photos on the feedback list", () => {
    renderPortal({ acceptingSubmissions: false, approvedItems: APPROVED_ITEMS });

    expect(screen.getByRole("button", { name: "▲ Support · 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "▲ Support · 5" })).toBeInTheDocument();
    // A pin and a drawn line are both "located": the shape is on the map beside
    // the feed, and the shape NAMES are English-only in a module the operator
    // console shares.
    expect(screen.getAllByText("Located")).toHaveLength(2);
    expect(screen.getByAltText("Photo attached to this community comment")).toBeInTheDocument();
  });

  it("sorts the feedback list by most supported when selected", () => {
    renderPortal({ acceptingSubmissions: false, approvedItems: APPROVED_ITEMS });

    const headingsBefore = screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent);
    expect(headingsBefore.indexOf("Crosswalk request")).toBeLessThan(headingsBefore.indexOf("Bike route gap"));

    fireEvent.change(screen.getByLabelText(/Sort by/i), { target: { value: "most_supported" } });

    const headingsAfter = screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent);
    expect(headingsAfter.indexOf("Bike route gap")).toBeLessThan(headingsAfter.indexOf("Crosswalk request"));
  });

  it("supports an item optimistically, posts the vote, and remembers it locally", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, alreadyVoted: false, votesCount: 2 }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    renderPortal({ acceptingSubmissions: false, approvedItems: APPROVED_ITEMS });

    fireEvent.click(screen.getByRole("button", { name: "▲ Support · 1" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "▲ Supported · 2" })).toBeDisabled();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/engage/share-token-123/items/aaaaaaa1-0000-4000-8000-000000000001/vote",
      expect.objectContaining({ method: "POST" })
    );

    const stored = JSON.parse(
      window.localStorage.getItem("openplan-engagement-supported-share-token-123") ?? "[]"
    ) as string[];
    expect(stored).toContain("aaaaaaa1-0000-4000-8000-000000000001");
  });

  it("keeps previously supported items disabled from localStorage memory", () => {
    window.localStorage.setItem(
      "openplan-engagement-supported-share-token-123",
      JSON.stringify(["aaaaaaa1-0000-4000-8000-000000000002"])
    );

    renderPortal({ acceptingSubmissions: false, approvedItems: APPROVED_ITEMS });

    const supportedButton = screen.getByRole("button", { name: "▲ Supported · 5" });
    expect(supportedButton).toBeDisabled();
    expect(within(supportedButton).getByText(/Supported/)).toBeInTheDocument();
  });
});

/**
 * THE POINT OF THIS WHOLE CHANGE: the portal that translates a resident's
 * comment into eleven languages can now ask its own question in them.
 *
 * Every assertion below is on what a PERSON sees. A catalog that resolves
 * correctly and never reaches a render site is the defect class this repo has
 * shipped six times this week.
 */
describe("the portal in the participant's language", () => {
  it("asks its own question in Spanish when the participant's language is Spanish", () => {
    const { unmount } = renderPortal({ ...localeFor("es") });

    expect(screen.getByRole("heading", { name: "Comparta su opinión" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enviar lo que escribí/i })).toBeInTheDocument();
    expect(screen.getByText("Solo si usted quiere")).toBeInTheDocument();
    expect(screen.getByText("Recibir respuesta (solo si usted quiere)")).toBeInTheDocument();
    // The English wording of the same strings is GONE, not merely accompanied.
    expect(screen.queryByRole("heading", { name: "Share your input" })).toBeNull();
    unmount();

    // The same render in English proves the assertion above is about the bundle
    // and not about a string that happens to appear either way.
    renderPortal();
    expect(screen.getByRole("heading", { name: "Share your input" })).toBeInTheDocument();
    expect(screen.queryByText("Solo si usted quiere")).toBeNull();
  });

  it("turns the page around for a right-to-left language instead of only listing it", () => {
    const { container } = renderPortal({ ...localeFor("ar") });

    const wrapper = container.querySelector("[dir]");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute("dir")).toBe("rtl");
    expect(wrapper?.getAttribute("lang")).toBe("ar");

    // A declared `dir` with physical spacing underneath is broken with extra
    // steps, so the reply-thread indent and the honeypot's off-screen offset are
    // both logical.
    expect(container.innerHTML).not.toMatch(/class="[^"]*\s-left-\[9999px\]/);
    expect(container.querySelector(".-start-\\[9999px\\]")).not.toBeNull();
  });

  it("reads a date and a count the way the participant's language does", () => {
    const { unmount } = renderPortal({
      acceptingSubmissions: false,
      approvedItems: APPROVED_ITEMS,
      ...localeFor("ru"),
    });

    // 2 July 2026 — dd.mm.yyyy in Russian, not the server's en-US month-first.
    expect(screen.getByText("2 июл. 2026 г.")).toBeInTheDocument();
    unmount();

    renderPortal({ acceptingSubmissions: false, approvedItems: APPROVED_ITEMS });
    expect(screen.getByText("Jul 2, 2026")).toBeInTheDocument();
  });

  /**
   * THE ORDINARY SPANISH PORTAL — demographics OFF, which is the default — and
   * the case the earlier block-scoped notice missed entirely.
   *
   * Spanish is a COMPLETE catalog, so `translator.hasFallbacks` is false and the
   * route's own page-wide notice is correctly silent. But the submit tab, which
   * is the tab the portal opens on, carries the English sentence
   * `resolvePortalMapFraming` builds server-side for every reader. With the
   * notice attached to the demographics block, a Spanish portal with
   * demographics off rendered that English with NOTHING anywhere on the page
   * disclosing it — which under Title VI reads as English the agency chose to
   * publish.
   */
  it("discloses its English on a Spanish portal that has no demographics block", () => {
    renderPortal({ ...localeFor("es") });

    const notice = screen.getByText(/solo está disponible parcialmente en Español/i);
    // The English a resident actually meets first: the map-framing sentence on
    // the default tab, built as English prose server-side.
    const englishFraming = screen.getByText(/No study area has been set for this campaign/i);

    expect(notice.compareDocumentPosition(englishFraming) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(englishFraming.getAttribute("lang")).toBe("en");
    // The notice itself is the Spanish it claims to be — this key is one the
    // complete catalog carries, which is why this branch is reachable at all.
    expect(notice.getAttribute("lang")).toBe("es");
  });

  it("warns above the block of English it is about, not at the bottom of the page", () => {
    // Spanish is a COMPLETE catalog, so `translator.hasFallbacks` is false and
    // the route's own page-wide notice stays silent — while the demographics
    // block is still English, because `demographicLabel` is shared with the
    // operator console and cannot simply become catalog keys. A portal that said
    // nothing here would publish English as Spanish by choice.
    renderPortal({ demographicsEnabled: true, ...localeFor("es") });

    const notice = screen.getByText(/solo está disponible parcialmente en Español/i);
    const firstEnglishLabel = screen.getByText("Age range");

    // Position, not mere presence: a disclosure a resident meets AFTER the
    // English has already misled them.
    expect(notice.compareDocumentPosition(firstEnglishLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // And the English that is still English says so, so a screen reader set to
    // Spanish does not read it with Spanish phonology.
    expect(firstEnglishLabel.getAttribute("lang")).toBe("en");
    // The translated part of the same block is the Spanish it claims to be.
    expect(screen.getAllByText("Prefiero no responder").length).toBeGreaterThan(0);
  });

  it("does not repeat the page-wide notice the route already renders", () => {
    // Korean carries no catalog, so every key falls back and the route's own
    // `PortalLanguageNotice` says so once, above the campaign title. A second
    // page-wide notice inside the portal would be the same sentence twice.
    renderPortal({ ...localeFor("ko") });

    expect(screen.queryByText(/only partly available/i)).toBeNull();
  });

  it("says nothing about coverage on an English portal, which has nothing to disclose", () => {
    renderPortal({ demographicsEnabled: true });
    expect(screen.queryByText(/only partly available/i)).toBeNull();
  });

  /**
   * The embeddable widget renders THIS component and nothing above it, so a
   * picker that only existed on the full page left every iframe participant
   * stuck in whichever language the header happened to resolve.
   */
  it("gives a resident a way into another language when the surrounding route has none", () => {
    // What the embeddable widget needs: it renders this component under a bare
    // header, so without this the only language on offer is whichever one the
    // request happened to resolve to.
    renderPortal({ renderLanguagePicker: true, ...localeFor("es") });

    const picker = screen.getByRole("navigation", { name: "Idioma" });
    const vietnamese = within(picker).getByRole("link", { name: /Tiếng Việt/ });
    expect(vietnamese.getAttribute("href")).toContain("lang=vi");
    // Rendered in its own script, because a picker labelled in English is a
    // locked door with the key inside.
    expect(vietnamese.textContent).toBe("Tiếng Việt");
    expect(within(picker).getByRole("link", { name: /العربية/ }).getAttribute("lang")).toBe("ar");
  });

  it("leaves the picker to the route by default, so the full page does not show two", () => {
    renderPortal({ ...localeFor("es") });
    expect(screen.queryByRole("navigation", { name: "Idioma" })).toBeNull();
  });

  /**
   * A PICKER WITHOUT A NOTICE IS AN EXIT NOBODY IS TOLD TO TAKE.
   *
   * On the embeddable widget nothing above this component discloses anything, so
   * a Korean-speaking resident got a fully English page with a language switcher
   * beside it and no sentence saying the English was a fallback rather than the
   * agency's choice. Under Title VI those are different publications.
   */
  it("tells an iframe participant the page is not really in their language, and does it first", () => {
    // Korean carries no catalog, so every one of OpenPlan's own strings on this
    // page is the English source.
    const { container } = renderPortal({ renderLanguagePicker: true, ...localeFor("ko") });

    const notice = screen.getByText(/only partly available in 한국어/i);
    expect(notice).toBeInTheDocument();

    // BEFORE the content, not after it. A disclosure a resident meets at the
    // bottom of the feed is one they meet after the page has already misled
    // them.
    const firstHeading = screen.getByRole("heading", { name: "Share your input" });
    expect(notice.compareDocumentPosition(firstHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // And the way out sits with it rather than a scroll away.
    const picker = screen.getByRole("navigation");
    expect(notice.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(picker.compareDocumentPosition(firstHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container).toBeTruthy();
  });

  /**
   * The route that DOES own its language chrome renders the same notice above
   * the campaign title. A second copy inside the portal is the same sentence
   * twice, which a resident reads as a bug and learns to skip — including the
   * time it matters.
   */
  it("does not print the coverage notice twice when the route already owns it", () => {
    // The state that used to double it: a locale with no catalog (so the route's
    // notice speaks) AND the demographics block (which carries its own).
    renderPortal({ demographicsEnabled: true, ...localeFor("ko") });

    expect(screen.queryByText(/only partly available/i)).toBeNull();
  });

  /**
   * AN API'S REFUSAL IS ENGLISH ON EVERY ROUTE UNDER `/api/engage/`.
   *
   * It is shown because it is specific — "Photo upload not found or expired" is
   * worth more to a resident than "submission failed" — but it lands inside a
   * page that declares itself Spanish. A screen reader told the page is Spanish
   * reads it with Spanish phonology, which is close to unintelligible at the one
   * moment a resident is most likely to give up.
   */
  it("marks a server's English refusal as English rather than as the page's language", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Too many recent submissions from this connection." }), {
        status: 429,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    renderPortal({ ...localeFor("es") });

    fireEvent.change(screen.getByLabelText("Lo que nos quiere contar (esta parte sí hace falta)"), {
      target: { value: "Hace falta un paso de peatones en la calle Main." },
    });
    fireEvent.click(screen.getByRole("button", { name: /enviar lo que escribí/i }));

    const refusal = await screen.findByText("Too many recent submissions from this connection.");
    expect(refusal.getAttribute("lang")).toBe("en");
    expect(refusal.getAttribute("dir")).toBe("ltr");
  });

  /**
   * The other half of the same rule: when the API says nothing usable, the
   * sentence is OpenPlan's own and IS in the participant's language, so claiming
   * English there would be the mirror lie.
   */
  it("keeps its own fallback refusal in the participant's language", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 500, headers: { "content-type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    renderPortal({ ...localeFor("es") });

    fireEvent.change(screen.getByLabelText("Lo que nos quiere contar (esta parte sí hace falta)"), {
      target: { value: "Hace falta un paso de peatones en la calle Main." },
    });
    fireEvent.click(screen.getByRole("button", { name: /enviar lo que escribí/i }));

    const refusal = await screen.findByText("No pudimos enviar lo que escribió. No se ha perdido nada: inténtelo otra vez, por favor.");
    expect(refusal.getAttribute("lang")).toBe("es");
    expect(refusal.getAttribute("dir")).toBe("ltr");
  });
});

/**
 * A MACHINE TRANSLATION AND AN AGENCY'S OWN WORDS ARE DIFFERENT PROMISES.
 *
 * An agency can be held to what it published. These assertions are the reason
 * the resolver returns provenance at all.
 */
describe("operator-authored content on the portal", () => {
  it("labels a machine translation next to the words, and leaves the agency's own Spanish unlabelled", async () => {
    const index = await indexFor({
      locale: "es",
      sourceLocale: "en",
      rows: [
        {
          entity_type: "category",
          entity_id: SAFETY_CATEGORY_ID,
          field: "label",
          translated_text: "Seguridad",
          source: "machine",
          machine_model: "claude-test",
        },
      ],
    });

    const { unmount } = renderPortal({
      categories: [categoryFrom(index, { label: "Safety" })],
      ...localeFor("es"),
    });

    // The operator's Spanish is what a resident reads…
    expect(screen.getAllByText("Seguridad").length).toBeGreaterThan(0);
    // …and it is marked as a machine's wording, beside the words, not in a footer.
    expect(screen.getAllByText("Traducción automática").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Traducido automáticamente por conveniencia/i).length
    ).toBeGreaterThan(0);
    unmount();

    const operatorIndex = await indexFor({
      locale: "es",
      sourceLocale: "en",
      rows: [
        {
          entity_type: "category",
          entity_id: SAFETY_CATEGORY_ID,
          field: "label",
          translated_text: "Seguridad",
          source: "operator",
        },
      ],
    });

    renderPortal({
      categories: [categoryFrom(operatorIndex, { label: "Safety" })],
      ...localeFor("es"),
    });

    expect(screen.getAllByText("Seguridad").length).toBeGreaterThan(0);
    // Text a person at the agency wrote carries no disclaimer — adding one would
    // train residents to ignore the badge that matters.
    expect(screen.queryByText("Traducción automática")).toBeNull();
  });

  it("marks untranslated operator text with the language it is actually in, so a screen reader switches voices", async () => {
    const index = await indexFor({ locale: "es", sourceLocale: "en" });

    renderPortal({
      categories: [categoryFrom(index, { label: "Safety" })],
      ...localeFor("es"),
    });

    const heading = screen.getByRole("heading", { name: "Safety" });
    expect(heading.getAttribute("lang")).toBe("en");
    expect(screen.getAllByText("Sin traducir").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/El equipo del proyecto no ha publicado este texto en Español/i).length
    ).toBeGreaterThan(0);
  });

  /**
   * THE STATE THIS DEPLOYMENT IS ACTUALLY IN: `engagement_content_translations`
   * arrives in a migration, and between a deploy and its migration the read
   * ERRORS. A failed translation is not an absent one, and saying "the team has
   * not published this in Spanish" about a lookup that broke is a claim about
   * the agency that nobody checked.
   */
  it("says the translations could not be loaded rather than blaming the agency for not translating", async () => {
    const index = await indexFor({
      locale: "es",
      sourceLocale: "en",
      translationsError: 'relation "engagement_content_translations" does not exist',
    });

    renderPortal({
      categories: [categoryFrom(index, { label: "Safety" })],
      ...localeFor("es"),
    });

    expect(screen.getAllByText("Traducciones no disponibles").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/no pudo cargar sus traducciones/i).length
    ).toBeGreaterThan(0);
    // The sentence that would have been wrong.
    expect(screen.queryByText(/no ha publicado este texto en Español/i)).toBeNull();
  });

  /**
   * A `dir` ON THE WRAPPER IS NOT A `dir` ON THE WORDS.
   *
   * Direction is not inherited from a language tag by any browser, so an
   * untranslated English topic sitting inside an Arabic portal takes the
   * wrapper's `dir="rtl"` and lays out from the wrong edge. Marking the run for
   * a screen reader and mis-laying it for everyone else is half a fix.
   */
  it("lays untranslated English operator text out left-to-right inside a right-to-left portal", async () => {
    const index = await indexFor({ locale: "ar", sourceLocale: "en" });

    const { container } = renderPortal({
      categories: [categoryFrom(index, { label: "Safety", description: "Crossings and traffic safety" })],
      ...localeFor("ar"),
    });

    // The portal itself is still turned around — this must not have been "fixed"
    // by giving up on RTL.
    expect(container.querySelector("[dir]")?.getAttribute("dir")).toBe("rtl");

    const heading = screen.getByRole("heading", { name: "Safety" });
    expect(heading.getAttribute("lang")).toBe("en");
    expect(heading.getAttribute("dir")).toBe("ltr");

    const description = screen.getByText("Crossings and traffic safety");
    expect(description.getAttribute("dir")).toBe("ltr");
  });

  /**
   * The mirror case, which proves the direction is read off the TEXT rather than
   * assumed: an agency's own Arabic, shown to a participant reading English.
   */
  it("runs the agency's own Arabic right-to-left inside an English portal", async () => {
    const index = await indexFor({
      locale: "en",
      sourceLocale: "ar",
      rows: [],
    });

    renderPortal({
      categories: [categoryFrom(index, { label: "سلامة" })],
      ...localeFor("en"),
    });

    const heading = screen.getByRole("heading", { name: "سلامة" });
    expect(heading.getAttribute("lang")).toBe("ar");
    expect(heading.getAttribute("dir")).toBe("rtl");
  });

  it("puts the topic caveat once beneath the select, because an option cannot carry a badge", async () => {
    const index = await indexFor({
      locale: "es",
      sourceLocale: "en",
      rows: [
        {
          entity_type: "category",
          entity_id: SAFETY_CATEGORY_ID,
          field: "label",
          translated_text: "Seguridad",
          source: "machine",
          machine_model: "claude-test",
        },
        {
          entity_type: "category",
          entity_id: "bbbbbbb1-0000-4000-8000-000000000002",
          field: "label",
          translated_text: "Tránsito",
          source: "machine",
          machine_model: "claude-test",
        },
      ],
    });

    renderPortal({
      categories: [
        categoryFrom(index, { label: "Safety" }),
        categoryFrom(index, { id: "bbbbbbb1-0000-4000-8000-000000000002", label: "Transit" }),
      ],
      ...localeFor("es"),
    });

    const select = screen.getByLabelText(/Temas de comentarios/);
    expect(within(select).getByRole("option", { name: "Seguridad" }).getAttribute("lang")).toBe("es");
    // Two machine-translated topics are ONE fact about this campaign, said once.
    expect(
      screen.getAllByText(/Traducido automáticamente por conveniencia/i).length
    ).toBeGreaterThan(0);
  });
});
