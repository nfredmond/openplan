import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadPublicPortalBundle = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});

vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));
/**
 * The LOADER is doubled; everything else in that module is the real thing.
 *
 * `PortalReadUnavailableError` in particular has to be the real class, or the
 * failed-lookup test below would be asserting against an error this file made up
 * — and a test that invents both halves of a contract proves neither.
 */
vi.mock("@/lib/engagement/public-portal-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/engagement/public-portal-data")>();
  return {
    ...actual,
    loadPublicPortalBundle: (...args: unknown[]) => loadPublicPortalBundle(...args),
  };
});
/**
 * The portal is doubled, but its LANGUAGE CHROME SWITCH is recorded rather than
 * discarded. The picker and the coverage notice this route depends on are built
 * inside that component and rendered only when it is asked, so a double that
 * swallowed the prop would let the exact defect this file now guards go back in
 * while every assertion still passed.
 */
vi.mock("@/components/engagement/public-engagement-portal", () => ({
  PublicEngagementPortal: (props: { shareToken: string; renderLanguagePicker?: boolean }) => (
    <div
      data-testid="portal"
      data-share-token={props.shareToken}
      data-language-chrome={props.renderLanguagePicker ? "yes" : "no"}
    />
  ),
}));

import EmbedEngagementPage from "@/app/(embed)/embed/[shareToken]/page";
import { PortalReadUnavailableError } from "@/lib/engagement/public-portal-data";
import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle } from "@/lib/engagement/portal-i18n/messages";
import type { PortalLocale } from "@/lib/engagement/portal-i18n/locales";
import type { PortalText } from "@/lib/engagement/portal-i18n/operator-text";

/**
 * Operator text as the LOADER would hand it over: the string plus how it came
 * to be in that language. Built here rather than hand-written as a bare string
 * because the whole point of this route's fix is that the embed renders the
 * resolved value and not `campaign.title`.
 */
function operatorText(text: string, requestedLocale: PortalLocale, textLocale: PortalLocale): PortalText {
  return {
    text,
    // The agency's own wording when it came back in the language asked for;
    // the source string, disclosed as such, when it did not.
    provenance: textLocale === requestedLocale ? "operator" : "untranslated",
    textLocale,
    // A recorded source language, so the disclosure is allowed to name it.
    textLocaleStated: true,
    requestedLocale,
    model: null,
  };
}

function bundle(locale: PortalLocale = "en") {
  const resolved = resolvePortalLocale({ requested: locale, acceptLanguage: null });
  return {
    campaign: {
      id: "c1",
      project_id: null,
      title: "Downtown listening campaign",
      summary: null,
      public_description: "Tell us about downtown.",
      status: "active",
      engagement_type: "map_feedback",
      allow_public_submissions: true,
      submissions_closed_at: null,
      demographics_enabled: false,
      updated_at: "2026-07-22T00:00:00Z",
      // 20260730000001 — an embedded portal is still a participant surface, so
      // a resident who cannot use it needs the same way out.
      accessibility_contact_label: null,
      accessibility_contact_email: "access@city.example",
      accessibility_contact_phone: null,
      accessibility_alternate_formats: null,
    },
    project: null,
    acceptingSubmissions: true,
    campaignText: {
      accessibilityContactLabel: null,
      accessibilityAlternateFormats: null,
      title:
        locale === "es"
          ? operatorText("Campaña de escucha del centro", "es", "es")
          : operatorText("Downtown listening campaign", locale, "en"),
      summary: null,
      publicDescription:
        locale === "es"
          ? operatorText("Cuéntenos sobre el centro.", "es", "es")
          : operatorText("Tell us about downtown.", locale, "en"),
    },
    locale: resolved,
    messages: buildPortalMessageBundle(resolved),
    portalProps: {
      shareToken: "share-token-12345",
      acceptingSubmissions: true,
      categories: [],
      approvedItems: [],
      engagementType: "map_feedback",
      demographicsEnabled: false,
      projectContext: null,
      surveyQuestions: [],
      closeLoopEntries: [],
    },
  };
}

const renderEmbed = async (search?: Record<string, string | string[]>) => {
  const page = await EmbedEngagementPage({
    params: Promise.resolve({ shareToken: "share-token-12345" }),
    searchParams: search ? Promise.resolve(search) : undefined,
  });
  return render(page);
};

describe("EmbedEngagementPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the minimal-chrome portal for an active campaign", async () => {
    loadPublicPortalBundle.mockResolvedValue(bundle());
    await renderEmbed();

    expect(screen.getByText("Downtown listening campaign")).toBeInTheDocument();
    expect(screen.getByText("Tell us about downtown.")).toBeInTheDocument();
    expect(screen.getByTestId("portal")).toBeInTheDocument();
    // Minimal chrome carries an honest attribution + a link back to the full page.
    expect(screen.getByText(/Powered by OpenPlan/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open the full engagement page/i })).toHaveAttribute(
      "href",
      "/engage/share-token-12345"
    );
  });

  it("404s when there is no active campaign for the token", async () => {
    loadPublicPortalBundle.mockResolvedValue(null);
    await expect(
      EmbedEngagementPage({ params: Promise.resolve({ shareToken: "missing-token-000" }) })
    ).rejects.toThrow("notFound");
    expect(notFoundMock).toHaveBeenCalled();
  });

  /**
   * AN EMBED IS THE HALF OF THE PORTAL AN AGENCY PUTS ON ITS OWN SITE, so a 404
   * here renders inside the agency's own page frame — "this consultation does
   * not exist" published under the agency's masthead.
   *
   * The loader used to return `null` for a FAILED campaign lookup as well as an
   * absent one, and `if (!bundle) notFound()` cannot tell those apart. It now
   * raises instead, so the request ends as an error the reader is told about
   * rather than as a confident statement about the agency's consultation.
   */
  it("does not 404 the widget when the campaign lookup failed", async () => {
    loadPublicPortalBundle.mockRejectedValue(
      new PortalReadUnavailableError("permission denied for relation engagement_campaigns")
    );

    await expect(
      EmbedEngagementPage({ params: Promise.resolve({ shareToken: "share-token-12345" }) })
    ).rejects.toBeInstanceOf(PortalReadUnavailableError);

    expect(notFoundMock).not.toHaveBeenCalled();
  });

  /**
   * THE EMBED IS A PARTICIPANT SURFACE, and it shipped for a while as the half
   * of the language work that nothing reached — `?lang=` ignored, the header
   * rendered from the raw source strings, and the picker prop never passed.
   * Each assertion below is one of those three, driven through the real route.
   */
  it("honours the language named in the iframe's own URL", async () => {
    loadPublicPortalBundle.mockResolvedValue(bundle("es"));
    await renderEmbed({ lang: "es" });

    // The loader cannot read a query string; a route that does not pass it on
    // leaves `?lang=` with no effect at all and nothing on screen says so.
    expect(loadPublicPortalBundle).toHaveBeenCalledWith("share-token-12345", {
      requestedLocale: "es",
    });
  });

  it("takes the first value when the embed snippet repeated ?lang=", async () => {
    loadPublicPortalBundle.mockResolvedValue(bundle("es"));
    await renderEmbed({ lang: ["es", "ko"] });

    expect(loadPublicPortalBundle).toHaveBeenCalledWith("share-token-12345", {
      requestedLocale: "es",
    });
  });

  it("renders the agency's translated header, not the source strings", async () => {
    loadPublicPortalBundle.mockResolvedValue(bundle("es"));
    const { container } = await renderEmbed({ lang: "es" });

    expect(screen.getByText("Campaña de escucha del centro")).toBeInTheDocument();
    expect(screen.getByText("Cuéntenos sobre el centro.")).toBeInTheDocument();
    // The raw source is what this route used to publish over a Spanish body.
    expect(screen.queryByText("Downtown listening campaign")).toBeNull();
    // And the header is labelled, so a screen reader does not pronounce it with
    // the wrong phonology and an RTL title does not lay out from the wrong edge.
    expect(container.querySelector("h1")?.getAttribute("lang")).toBe("es");
  });

  it("says so when the header is the agency's untranslated English", async () => {
    const untranslated = bundle("es");
    untranslated.campaignText.title = operatorText("Downtown listening campaign", "es", "en");
    untranslated.campaignText.publicDescription = operatorText("Tell us about downtown.", "es", "en");
    loadPublicPortalBundle.mockResolvedValue(untranslated);

    const { container } = await renderEmbed({ lang: "es" });

    // English inside a page declared Spanish, marked as English rather than
    // passed off as something the agency wrote that way.
    expect(container.querySelector("h1")?.getAttribute("lang")).toBe("en");
    expect(screen.getAllByText(/no ha publicado este texto en Español/i).length).toBeGreaterThan(0);
  });

  it("gives the widget the language chrome the surrounding route does not have", async () => {
    loadPublicPortalBundle.mockResolvedValue(bundle("es"));
    await renderEmbed({ lang: "es" });

    // Without this an iframe participant is held in whichever language the
    // request resolved to, with no picker and no coverage notice anywhere.
    expect(screen.getByTestId("portal").getAttribute("data-language-chrome")).toBe("yes");
  });

  it("offers the same way out as the full page, not a lesser one", async () => {
    loadPublicPortalBundle.mockResolvedValue(bundle("es"));
    await renderEmbed({ lang: "es" });

    // An agency embedding the portal in an iframe has not opted its residents
    // out of being able to reach someone.
    expect(screen.getByText(/Si no puede usar esta página/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "access@city.example" })).toBeInTheDocument();
  });

  it("turns the widget around for a right-to-left language", async () => {
    loadPublicPortalBundle.mockResolvedValue(bundle("ar"));
    const { container } = await renderEmbed({ lang: "ar" });

    // The portal sets `dir` on its own wrapper, but the header above it is
    // outside that component — so without this the title alone lays out from
    // the wrong edge.
    const main = container.querySelector("main");
    expect(main?.getAttribute("dir")).toBe("rtl");
    expect(main?.getAttribute("lang")).toBe("ar");
  });
});
