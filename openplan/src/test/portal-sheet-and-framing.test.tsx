/**
 * TWO THINGS A RESIDENT MEETS BEFORE THEY MEET ANYTHING ELSE: the collapsed
 * bottom sheet, and the sentence that says where the map is looking.
 *
 * ============================================================================
 * WHAT THIS FILE CANNOT PROVE, STATED FIRST
 * ============================================================================
 *
 * jsdom applies NO stylesheet, has NO box model, and does not run Mapbox GL.
 * It cannot tell you that the collapsed sheet is 101 pixels tall, that nothing
 * peeks out of it, or that a scrollbar has stopped appearing. Those are browser
 * facts and were measured in a real browser at 390×844:
 *
 *   before — sheet 152px, its scrolling child a 51px window onto 1016px of
 *            content, showing eleven of twenty-two language chips cut off
 *            mid-row above a scroll track;
 *   after  — sheet 101px (45px handle + 56px door), the scrolling child
 *            `display: none` with height 0, deepest descendant bottom exactly
 *            at the viewport edge; the sheet still opens to 633px on a tap.
 *
 * What CAN be proved here is the STRUCTURE that produces that, and it is the
 * half that regresses silently: which element carries the collapse classes,
 * whether the toggle is still positioned where CSS can reach the body from it,
 * and whether the door survives the collapse.
 *
 * ============================================================================
 * AND THE SENTENCE, WHICH IS NOT A LAYOUT QUESTION AT ALL
 * ============================================================================
 *
 * `resolvePortalMapFraming` composes an English sentence server-side, and the
 * shell used to print it verbatim on every page in every language: "No study
 * area has been set for this campaign and no locations have been marked yet, so
 * this map opens on the whole country." English on a Spanish page, and written
 * in an administrator's vocabulary — "study area" and "campaign" are two objects
 * that exist in this software and nowhere in a resident's life.
 */
import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle, EN_PORTAL_MESSAGES } from "@/lib/engagement/portal-i18n/messages";
import { resolvePortalMapFraming } from "@/lib/engagement/public-portal-data";
import {
  emptyPortalTranslationIndex,
  resolveOperatorText,
} from "@/lib/engagement/portal-i18n/operator-text";

vi.mock("mapbox-gl", () => {
  const instance = {
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    remove: vi.fn(),
    resize: vi.fn(),
    addControl: vi.fn(),
    keyboard: { disable: vi.fn() },
    isStyleLoaded: vi.fn(() => false),
    setStyle: vi.fn(),
    getLayer: vi.fn(() => null),
    getSource: vi.fn(() => null),
    getCanvas: vi.fn(() => ({ setAttribute: vi.fn(), style: {} })),
    project: vi.fn(() => ({ x: 0, y: 0 })),
    panBy: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    getCenter: vi.fn(() => ({ lng: 0, lat: 0 })),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    fitBounds: vi.fn(),
  };
  const Map = vi.fn(function MockMap() {
    return instance;
  });
  const ctl = vi.fn(function MockControl() {
    const self = {
      setLngLat: vi.fn(() => self),
      setPopup: vi.fn(() => self),
      setDOMContent: vi.fn(() => self),
      addTo: vi.fn(() => self),
      remove: vi.fn(() => self),
      extend: vi.fn(() => self),
      isEmpty: vi.fn(() => true),
    };
    return self;
  });
  return {
    default: {
      Map,
      NavigationControl: ctl,
      AttributionControl: ctl,
      Popup: ctl,
      Marker: ctl,
      LngLatBounds: ctl,
      accessToken: "",
    },
    Map,
    NavigationControl: ctl,
    AttributionControl: ctl,
  };
});

const messagesFor = (locale: string) =>
  buildPortalMessageBundle(resolvePortalLocale({ requested: locale, acceptLanguage: null }));

const EN_INDEX = emptyPortalTranslationIndex("en");
const title = resolveOperatorText(
  EN_INDEX,
  { entity: "campaign", id: "campaign-1", field: "title" },
  "Downtown listening campaign"
);

type ShellProps = ComponentProps<typeof import("@/components/engagement/public-map-shell").PublicMapShell>;

function shellProps(overrides: Partial<ShellProps> = {}): ShellProps {
  return {
    shareToken: "share-token-12345",
    acceptingSubmissions: true,
    categories: [],
    items: [],
    readFailures: { comments: false, categories: false, closeLoop: false, project: false },
    demographicsEnabled: false,
    // The REAL resolver with no candidates: the state the defective sentence
    // was written for. A hand-built framing object could describe a shape the
    // resolver never produces.
    mapFraming: resolvePortalMapFraming({}),
    contextLayers: null,
    messages: messagesFor("en"),
    campaignTitle: title,
    campaignDescription: null,
    detailsHref: "/engage/share-token-12345/about",
    detailsContents: { survey: true, comments: true, closeLoop: false },
    mapAvailable: true,
    ...overrides,
  };
}

async function importShell() {
  return (await import("@/components/engagement/public-map-shell")).PublicMapShell;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token-for-the-participant-map");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the collapsed bottom sheet", () => {
  /**
   * The whole no-JavaScript mechanism depends on one structural fact: the
   * toggle, the handle, the body and the door are SIBLINGS. `peer-checked:`
   * compiles to a sibling combinator, so a body moved back inside a wrapper
   * would silently stop responding to the checkbox — the sheet would be either
   * permanently open or permanently shut, with every test that only counts
   * elements still green.
   */
  it("keeps the toggle, the handle, the body and the door as siblings", async () => {
    const PublicMapShell = await importShell();
    render(<PublicMapShell {...shellProps()} />);

    const sheet = screen.getByTestId("portal-input-sheet");
    const children = [...sheet.children];

    const toggle = document.getElementById("portal-sheet-toggle");
    expect(toggle).not.toBeNull();
    expect(children).toContain(toggle);
    expect(children.some((el) => el.tagName === "LABEL")).toBe(true);
    expect(children).toContain(screen.getByTestId("portal-details-link"));

    // The body is a sibling too, and it is the one carrying the collapse.
    const body = children.find((el) => el.className.includes("overflow-y-auto"));
    expect(body, "the rail body is no longer a direct child of the sheet").toBeDefined();
  });

  /**
   * THE SLIVER. The body must be switched OFF while collapsed rather than
   * merely clipped: a clipped body is what produced a 51px scrolling window with
   * its own scrollbar onto the top of the language picker.
   */
  it("switches the rail body off while collapsed and back on when opened", async () => {
    const PublicMapShell = await importShell();
    render(<PublicMapShell {...shellProps()} />);

    const sheet = screen.getByTestId("portal-input-sheet");
    const body = [...sheet.children].find((el) => el.className.includes("overflow-y-auto"))!;

    expect(body.className).toContain("hidden");
    expect(body.className).toContain("peer-checked:block");
    // On a wide screen this is not a sheet at all — it is the rail, always open.
    expect(body.className).toContain("lg:block");
    // And the SECTION's own height keys off the checkbox through `has-`, because
    // a parent cannot be its own child's peer.
    expect(sheet.className).toContain("has-[#portal-sheet-toggle:checked]:max-h-[75dvh]");
  });

  it("leaves the one way onward visible while the sheet is shut", async () => {
    const PublicMapShell = await importShell();
    render(<PublicMapShell {...shellProps()} />);

    const door = screen.getByTestId("portal-details-link");
    expect(door.className).not.toContain("hidden");
    expect(door.getAttribute("href")).toBe("/engage/share-token-12345/about");
  });

  it("still opens without JavaScript: the handle is a label for the checkbox", async () => {
    const PublicMapShell = await importShell();
    render(<PublicMapShell {...shellProps()} />);

    const toggle = document.getElementById("portal-sheet-toggle") as HTMLInputElement;
    const handle = document.querySelector('label[for="portal-sheet-toggle"]');
    expect(handle).not.toBeNull();
    expect(toggle.type).toBe("checkbox");
    expect(toggle.checked).toBe(false);

    fireEvent.click(handle!);
    expect(toggle.checked).toBe(true);
  });
});

describe("the sentence that says where the map is looking", () => {
  it("is in the resident's language, not the English the server composed", async () => {
    const PublicMapShell = await importShell();
    render(<PublicMapShell {...shellProps({ messages: messagesFor("es") })} />);

    const framing = screen.getByTestId("portal-map-framing");
    expect(framing.textContent).toContain(
      "Nadie ha dicho de qué zona trata esta página, así que el mapa empieza muy abierto."
    );
    // The English prose the resolver still composes must not be on the page.
    expect(framing.textContent).not.toContain("study area");
    expect(framing.textContent).not.toContain("campaign");
  });

  it("names no object that exists only inside this software", async () => {
    const PublicMapShell = await importShell();
    render(<PublicMapShell {...shellProps()} />);

    const framing = screen.getByTestId("portal-map-framing").textContent ?? "";
    expect(framing).toBe(EN_PORTAL_MESSAGES["portal.mapFramingNoArea"]);
    for (const word of ["study area", "campaign", "workspace", "geometry"]) {
      expect(framing.toLowerCase(), `"${word}" is back in the resident's framing sentence`).not.toContain(
        word
      );
    }
  });

  /**
   * The two "nothing framed it" states are different facts and must not share a
   * sentence: "nobody set an area" is a claim about the world that is only ours
   * to make when every candidate was actually checked, and a lookup that FAILED
   * leaves us knowing less than that.
   */
  it("says less when a lookup failed than when nothing was ever set", async () => {
    const PublicMapShell = await importShell();

    const failed = resolvePortalMapFraming({
      campaignPlace: { state: "unreadable", label: null, bbox: null },
    });
    // Guard the fixture itself: if the resolver stops reporting a gap here, this
    // case would silently become a second copy of the one above.
    expect(failed.origin).toBe("none");
    expect(failed.unreadable.length).toBeGreaterThan(0);

    render(<PublicMapShell {...shellProps({ mapFraming: failed })} />);
    const framing = screen.getByTestId("portal-map-framing").textContent ?? "";
    expect(framing).toContain(EN_PORTAL_MESSAGES["portal.mapFramingUnknownArea"]);
    expect(framing).not.toContain(EN_PORTAL_MESSAGES["portal.mapFramingNoArea"]);
  });

  it("names the area, in the resident's language, when something did frame it", async () => {
    const PublicMapShell = await importShell();

    const framed = resolvePortalMapFraming({
      campaignPlace: {
        state: "set",
        label: "Nevada County",
        bbox: { minLon: -121.1, minLat: 39.1, maxLon: -121.0, maxLat: 39.3 },
      },
    });
    expect(framed.origin).toBe("campaign_place");

    render(<PublicMapShell {...shellProps({ mapFraming: framed, messages: messagesFor("es") })} />);
    const framing = screen.getByTestId("portal-map-framing").textContent ?? "";

    // The agency's own name for the place survives untranslated; the sentence
    // around it does not.
    expect(framing).toContain("Nevada County");
    expect(framing).toContain("la zona de la que trata esta página");
    expect(framing).not.toContain("This map opens on");
  });
});
