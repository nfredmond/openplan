/**
 * THE MAP-BACKGROUND PICKER SPOKE ENGLISH IN ALL 22 LANGUAGES.
 *
 * `basemaps.ts` carried "Streets", "Roads, place names and landmarks.",
 * "Satellite", "Terrain", "Plain and pale" and their sentences as literals, and
 * nothing routed them through the participant catalog. The picker's HEADING was
 * translated — "Fondo del mapa" — and every option inside it was not. A resident
 * could read the name of the control and none of its choices.
 *
 * WHAT THIS FILE PROVES, and it is deliberately three separate things, because
 * the defect could come back in three different ways:
 *
 *   1. every id the registry offers has both catalog keys (a new background
 *      with no words would render its raw key to the public);
 *   2. the English catalog still says exactly what the registry says (two copies
 *      of the same English are a drift waiting to happen, and the picker shows
 *      whichever one it was handed);
 *   3. the translation swaps only the WORDS — `id`, `styleUrl` and `dark` come
 *      through untouched, because everything downstream looks a style up by id.
 *
 * WHAT IT CANNOT PROVE: that the picker is visible, or that a resident can reach
 * it on a 390px screen. jsdom applies no stylesheet, has no box model and does
 * not run Mapbox GL. That half was checked in a real browser at 390×844.
 */
import { describe, expect, it } from "vitest";

import {
  PUBLIC_BASEMAP_IDS,
  resolvePublicBasemapConfig,
  type PublicBasemapId,
} from "@/lib/cartographic/basemaps";
import {
  PORTAL_BASEMAP_MESSAGE_KEYS,
  translatePublicBasemapChoices,
} from "@/lib/engagement/portal-i18n/basemap-words";
import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle, EN_PORTAL_MESSAGES } from "@/lib/engagement/portal-i18n/messages";
import { createPortalTranslator } from "@/lib/engagement/portal-i18n/translator";

/** Every background the registry knows, not only the four offered by default. */
const everyChoice = resolvePublicBasemapConfig({
  mapboxToken: "pk.test",
  env: { OPENPLAN_PUBLIC_BASEMAPS: PUBLIC_BASEMAP_IDS.join(",") },
}).choices;

const translatorFor = (locale: string) =>
  createPortalTranslator(buildPortalMessageBundle(resolvePortalLocale({ requested: locale })));

describe("the map background picker's words", () => {
  it("has a catalog key for every background this product can offer", () => {
    expect(everyChoice).toHaveLength(PUBLIC_BASEMAP_IDS.length);
    for (const id of PUBLIC_BASEMAP_IDS) {
      const keys = PORTAL_BASEMAP_MESSAGE_KEYS[id];
      expect(keys, `no catalog keys for background "${id}"`).toBeTruthy();
      expect(EN_PORTAL_MESSAGES[keys.label]).toBeTruthy();
      expect(EN_PORTAL_MESSAGES[keys.description]).toBeTruthy();
    }
  });

  /**
   * The registry's English and the catalog's English are two copies of the same
   * sentence, and the picker renders whichever it was handed. Editing one and
   * not the other would put two different names on the same background depending
   * on the reader's language, with nothing failing.
   */
  it("says the same thing in the registry as in the English catalog", () => {
    for (const choice of everyChoice) {
      const keys = PORTAL_BASEMAP_MESSAGE_KEYS[choice.id];
      expect(EN_PORTAL_MESSAGES[keys.label]).toBe(choice.label);
      expect(EN_PORTAL_MESSAGES[keys.description]).toBe(choice.description);
    }
  });

  it("renders every option in Spanish on a Spanish page, and no English survives", () => {
    const translated = translatePublicBasemapChoices(everyChoice, translatorFor("es"));

    // Named explicitly rather than "not equal to English": a translation that
    // silently fell back would still differ from nothing.
    expect(translated.map((choice) => choice.label)).toEqual([
      "Calles",
      "Satélite",
      "Terreno",
      "Sencillo y claro",
      "Sencillo y oscuro",
    ]);

    for (const choice of translated) {
      expect(choice.label).not.toBe(EN_PORTAL_MESSAGES[PORTAL_BASEMAP_MESSAGE_KEYS[choice.id].label]);
      expect(choice.description).not.toBe(
        EN_PORTAL_MESSAGES[PORTAL_BASEMAP_MESSAGE_KEYS[choice.id].description]
      );
    }
  });

  /**
   * The one thing translation must NOT touch. Everything downstream — the style
   * the map is built with, the failed-choice marker, the dark-background flag —
   * keys off `id` and `styleUrl`, so a translation that rebuilt them would
   * either blank the map or point it at a style this deployment excluded.
   */
  it("changes only the words: id, style URL and darkness come through untouched", () => {
    const translated = translatePublicBasemapChoices(everyChoice, translatorFor("es"));
    expect(translated.map((c) => c.id)).toEqual(everyChoice.map((c) => c.id));
    expect(translated.map((c) => c.styleUrl)).toEqual(everyChoice.map((c) => c.styleUrl));
    expect(translated.map((c) => c.dark)).toEqual(everyChoice.map((c) => c.dark));
  });

  it("hands an English reader the English, unchanged", () => {
    const translated = translatePublicBasemapChoices(everyChoice, translatorFor("en"));
    expect(translated).toEqual(everyChoice);
  });

  /**
   * A locale with no catalog of its own falls back key by key, and the page
   * discloses that. What it must never do is render the raw key.
   */
  it("falls back to English words rather than to a key name", () => {
    const translated = translatePublicBasemapChoices(everyChoice, translatorFor("ko"));
    for (const choice of translated) {
      expect(choice.label).not.toContain("portal.background");
      expect(choice.label).toBe(
        EN_PORTAL_MESSAGES[PORTAL_BASEMAP_MESSAGE_KEYS[choice.id as PublicBasemapId].label]
      );
    }
  });
});
