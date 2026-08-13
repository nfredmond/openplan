/**
 * THE HELPER IS NOT THE FEATURE. THE CALL SITE IS.
 *
 * ═══ THE HOLE THIS FILLS ═══
 *
 * `public-engagement-drawing-map-words.test.tsx` proves that
 * `buildGeometryPickerWords` produces the catalog's Spanish and that
 * `GeometryPickerMap` renders whatever `words` it is handed. Both are true and
 * neither says the portal hands it anything. Deleting
 * `words={buildGeometryPickerWords(translator)}` from
 * `public-engagement-portal.tsx` — the CLASSIC form, the one `/engage/<token>/about`
 * and `/embed/<token>` serve to the public — left that file green 4/4 (mutation
 * M10, 2026-08-13). The component simply falls back to its English defaults, so
 * a Spanish page keeps rendering and starts speaking English at the one control
 * a resident has to operate to say where they mean.
 *
 * The context therefore comes from a REAL RENDER of the portal at a real locale,
 * not from a fixture describing one. This repo has shipped a hand-written
 * fixture that passed for an offer no board could render; a props object typed
 * out here would prove the same amount about the call site — nothing.
 *
 * ═══ WHY THE ASSERTIONS ARE SHAPED THIS WAY ═══
 *
 * Both halves are needed. "Spanish is present" alone would pass if the picker
 * were handed Spanish and ALSO left its English hint in place; "English is
 * absent" alone would pass if the picker rendered nothing at all. The strings
 * are read from the catalog rather than typed, so this file cannot assert copy
 * the product does not carry, and it cannot go stale when the wording improves.
 *
 * ═══ WHAT THIS FILE CANNOT PROVE ═══
 *
 * jsdom applies no stylesheet, has no box model and does not run Mapbox GL — the
 * map is a double here. Nothing below is evidence that any of this is visible,
 * legible, sized, positioned, or reachable by thumb. It is evidence about which
 * words the portal puts on the drawing map, which is the half that regresses in
 * silence.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildGeometryPickerWords } from "@/lib/engagement/portal-i18n/drawing-map-words";
import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle } from "@/lib/engagement/portal-i18n/messages";
import { createPortalTranslator } from "@/lib/engagement/portal-i18n/translator";
import { resolvePortalMapFraming } from "@/lib/engagement/public-portal-data";

vi.mock("mapbox-gl", async () => {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  return createMapboxGlModuleFake();
});
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

const localeFor = (requested: string) => resolvePortalLocale({ requested, acceptLanguage: null });

/**
 * The picker reads its Mapbox token at MODULE scope. Without one it renders the
 * no-map branch, there is no drawing map to have words at all, and every
 * assertion below would be about a component that never drew anything — green
 * either way.
 */
let PublicEngagementPortal: typeof import("@/components/engagement/public-engagement-portal").PublicEngagementPortal;
let EN_GEOMETRY_PICKER_WORDS: import("@/components/engagement/geometry-picker-map").GeometryPickerWords;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token-for-the-participant-map");
  PublicEngagementPortal = (await import("@/components/engagement/public-engagement-portal"))
    .PublicEngagementPortal;
  EN_GEOMETRY_PICKER_WORDS = (await import("@/components/engagement/geometry-picker-map"))
    .EN_GEOMETRY_PICKER_WORDS;
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

/** The classic portal, at a locale, with nothing else to distract from the map. */
function renderPortal(requested: string) {
  const locale = localeFor(requested);
  return render(
    <PublicEngagementPortal
      shareToken="share-token-12345"
      acceptingSubmissions
      engagementType="map_feedback"
      categories={[]}
      approvedItems={[]}
      surveyQuestions={[]}
      closeLoopEntries={[]}
      emailUpdatesAvailable
      mapFraming={resolvePortalMapFraming({})}
      locale={locale}
      messages={buildPortalMessageBundle(locale)}
    />
  );
}

describe("the classic portal hands the drawing map the resident's own words", () => {
  /**
   * NEGATIVE CONTROL, and the one that matters most here: if the picker were
   * not on the page at all — a changed tab default, a token missing, a render
   * that threw — every "no English" assertion below would pass while proving
   * nothing.
   */
  it("actually renders a drawing map to have words", () => {
    renderPortal("en");
    expect(screen.getByText(EN_GEOMETRY_PICKER_WORDS.hintPoint)).toBeTruthy();
    expect(
      screen.getByRole("group", { name: EN_GEOMETRY_PICKER_WORDS.modeGroupLabel })
    ).toBeTruthy();
  });

  it("renders the catalog's Spanish on the map, not the component's English defaults", () => {
    const es = buildGeometryPickerWords(createPortalTranslator(buildPortalMessageBundle(localeFor("es"))));
    renderPortal("es");

    // The starting hint under the map and the three mode buttons above it —
    // every sentence a resident has to read to use the control.
    expect(screen.getByText(es.hintPoint)).toBeTruthy();
    expect(screen.getByRole("button", { name: es.modePoint })).toBeTruthy();
    expect(screen.getByRole("button", { name: es.modeLine })).toBeTruthy();
    expect(screen.getByRole("button", { name: es.modeArea })).toBeTruthy();
    expect(screen.getByRole("group", { name: es.modeGroupLabel })).toBeTruthy();

    // And none of the English the picker falls back to when nobody hands it
    // words. This is the half that fails when the `words` prop is dropped.
    expect(screen.queryByText(EN_GEOMETRY_PICKER_WORDS.hintPoint)).toBeNull();
    expect(
      screen.queryByRole("button", { name: EN_GEOMETRY_PICKER_WORDS.modePoint })
    ).toBeNull();
  });

  /**
   * AND THE WORDS ARE DECLARED AS THE LANGUAGE THEY ARE IN. Without this a
   * screen reader told the page is Spanish still pronounces the map's sentences
   * with English phonology — or, after a half-done edit that passes `words` and
   * drops `lang`, announces Spanish text as English.
   *
   * ONLY SPANISH IS TESTED, and that is a statement about the product rather
   * than a gap in this file: `messages.ts` carries exactly two catalogs today
   * (`EN_PORTAL_MESSAGES` and `ES_PORTAL_MESSAGES`). At any other locale every
   * drawing-map key falls back to English by design, so an "is it translated"
   * assertion there would compare English to English and pass whether or not
   * the call site passed anything at all. When a third catalog lands, add it to
   * the Spanish test above rather than here.
   */
  it("declares the language those words are written in", () => {
    const { container } = renderPortal("es");
    const es = buildGeometryPickerWords(createPortalTranslator(buildPortalMessageBundle(localeFor("es"))));

    /*
      THE MAP'S OWN DECLARATION, not the page's — and the first draft of this
      assertion could not tell them apart. It asked whether any `[lang="es"]`
      element contained the Spanish mode label, and deleting `lang={bcp47}` from
      the picker left it green: the portal's own wrapper already declares the
      locale, so the label was still inside a Spanish element.

      Walking UP from the control to the nearest element that declares a
      language, and requiring that element to be the map's rather than the
      page's, is what distinguishes the two. `#public-title` is the submission
      form's own field, outside the map block: if the nearest declaration
      contains it, the attribute is the page's and the map declared nothing.
    */
    const group = screen.getByRole("group", { name: es.modeGroupLabel });
    const declaring = group.closest("[lang]");
    expect(declaring).not.toBeNull();
    expect(declaring?.getAttribute("lang")).toBe("es");
    expect(declaring?.textContent ?? "").toContain(es.modePoint);
    expect(container.querySelector("#public-title")).not.toBeNull();
    expect(declaring?.contains(container.querySelector("#public-title"))).toBe(false);
  });
});
