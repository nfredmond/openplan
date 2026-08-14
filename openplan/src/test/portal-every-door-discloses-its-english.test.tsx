/**
 * A SPANISH PAGE THAT IS PARTLY ENGLISH HAS TO SAY SO — on every door, not on
 * the two that happened to share a component.
 *
 * ═══════════════════════════════════════════════════ THE DEFECT, IN ONE LINE
 *
 * `PortalPendingCopyNotice` lived inside `public-engagement-portal.tsx`, and
 * `/engage/<token>` — the busiest public route in the product, the one a resident
 * reaches from a mailed postcard — does not render that component. It renders
 * `PublicMapShell`.
 *
 * So a Spanish campaign with demographics switched on published English option
 * text ("Own", "Rent", "Under 18" — `demographicLabel`, whose wording is shared
 * with the operator console's aggregate views and cannot simply become catalog
 * keys) with nothing anywhere on the page saying the English was a fallback
 * rather than the agency's choice. Under Title VI that is a claim about what the
 * agency published.
 *
 * Spanish is the locale this can be seen in AT ALL, and that is the subtle part:
 * Spanish is a COMPLETE catalog, so `translator.hasFallbacks` is false and the
 * page-wide `PortalLanguageNotice` is correctly silent. On Korean, where every
 * key falls back, the page-wide notice speaks and hides the hole. A test written
 * at any other locale would have passed on the broken code.
 *
 * ═════════════════════════════════════════════════ WHAT THIS CANNOT PROVE
 *
 * jsdom applies no stylesheet, has no box model, and does not run Mapbox GL.
 * Nothing here is evidence that the notice is visible, legible, or above the fold
 * — only that it is in the document, before the English it is about, and in the
 * language it claims to be in.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle } from "@/lib/engagement/portal-i18n/messages";
import { resolvePortalMapFraming } from "@/lib/engagement/public-portal-data";
import {
  emptyPortalTranslationIndex,
  resolveOperatorText,
} from "@/lib/engagement/portal-i18n/operator-text";

vi.mock("mapbox-gl", async () => {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  return createMapboxGlModuleFake();
});
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

const ES_LOCALE = resolvePortalLocale({ requested: "es", acceptLanguage: null });
const ES = buildPortalMessageBundle(ES_LOCALE);
const EN_LOCALE = resolvePortalLocale({ requested: "en", acceptLanguage: null });
const EN = buildPortalMessageBundle(EN_LOCALE);

const operatorText = (text: string) =>
  resolveOperatorText(emptyPortalTranslationIndex("es"), { entity: "campaign", id: "c1", field: "title" }, text);

/** The token has to exist before the map modules are imported. See the other portal suites. */
let PublicMapShell: typeof import("@/components/engagement/public-map-shell").PublicMapShell;
let PublicEngagementPortal: typeof import("@/components/engagement/public-engagement-portal").PublicEngagementPortal;

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token-for-the-participant-map");
  vi.resetModules();
  PublicMapShell = (await import("@/components/engagement/public-map-shell")).PublicMapShell;
  PublicEngagementPortal = (await import("@/components/engagement/public-engagement-portal"))
    .PublicEngagementPortal;
});

afterEach(cleanup);
afterAll(() => vi.unstubAllEnvs());

function renderShell(messages = ES, demographicsEnabled = true) {
  return render(
    <PublicMapShell
      shareToken="share-token-12345"
      acceptingSubmissions
      categories={[]}
      items={[]}
      readFailures={{ comments: false, categories: false, closeLoop: false, project: false }}
      demographicsEnabled={demographicsEnabled}
      mapFraming={resolvePortalMapFraming({})}
      messages={messages}
      campaignTitle={operatorText("Escuchando al centro")}
      campaignDescription={null}
      detailsHref="/engage/share-token-12345/about"
      detailsContents={{ survey: false, comments: false, closeLoop: false }}
      mapAvailable
    />
  );
}

function renderPortal(messages = ES, locale = ES_LOCALE) {
  return render(
    <PublicEngagementPortal
      shareToken="share-token-12345"
      acceptingSubmissions
      engagementType="map_feedback"
      categories={[]}
      approvedItems={[]}
      demographicsEnabled
      mapFraming={resolvePortalMapFraming({})}
      locale={locale}
      messages={messages}
    />
  );
}

describe("every public door discloses the English it is still showing", () => {
  /**
   * THE NEGATIVE CONTROL, and it is not optional here: the notice renders on a
   * CONDITION, so a version that always returned null would pass a "the English
   * page says nothing" assertion and fail nothing else.
   */
  it("says nothing on an English page, which has nothing to disclose", () => {
    renderShell(EN);
    expect(screen.queryByTestId("portal-pending-copy-notice")).toBeNull();
  });

  it("discloses it on the map-first page a resident opens from a postcard", () => {
    renderShell();

    const notice = screen.getByTestId("portal-pending-copy-notice");
    expect(notice).toHaveTextContent(
      ES.messages["language.partialNotice"].replace("{language}", ES.nativeName)
    );
    // The sentence is the Spanish it claims to be — this key is one the complete
    // catalog carries, which is why this branch is reachable at all.
    expect(notice.getAttribute("lang")).toBe("es");
  });

  it("discloses it on the context page and the embeddable widget", () => {
    renderPortal();
    expect(screen.getByTestId("portal-pending-copy-notice").getAttribute("lang")).toBe("es");
  });

  /**
   * AND IT SITS ABOVE THE ENGLISH IT IS ABOUT. A disclosure a resident meets
   * after the English has already misled them is a disclosure that did not work.
   *
   * The English is found by the ATTRIBUTE THAT MARKS IT rather than by its words,
   * so this keeps testing the disclosure rather than one option's spelling — and
   * so it cannot go stale when `demographicLabel` is reworded.
   */
  it("puts the notice before the untranslated demographic options, not after them", () => {
    const { container } = renderShell();

    const notice = screen.getByTestId("portal-pending-copy-notice");
    /*
      The demographics block is on the step about the resident, so walk there the
      way a resident does. The comment step comes first because the form refuses
      to walk anybody forward with nothing written — that refusal is
      `portal-rail-refuses-an-empty-comment.test.tsx`'s subject and is not
      defeated here.
    */
    const chips = within(screen.getByTestId("portal-step-list")).getAllByRole("button");
    fireEvent.click(chips[1]);
    fireEvent.change(container.querySelector("#portal-body") as HTMLTextAreaElement, {
      target: { value: "El semáforo dura muy poco." },
    });
    fireEvent.click(chips[3]);

    const englishOption = container.querySelector(
      '[data-testid="portal-demographics"] [lang="en"], [data-testid="portal-demographics"] option[lang="en"]'
    ) as HTMLElement | null;
    expect(englishOption, "no English left in the demographics block to disclose").toBeTruthy();
    expect(englishOption?.getAttribute("lang")).toBe("en");
    expect(
      notice.compareDocumentPosition(englishOption as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
