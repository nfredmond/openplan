/**
 * THE ONE DOOR, AND THE ONE WAY OUT — the two links on the map-first portal that
 * a resident either finds or does not.
 *
 * WHY THIS FILE EXISTS. The map-first surface deliberately offers exactly one
 * way onward, and behind it sit the survey, the comment feed, per-comment
 * translation, the close-the-loop record and the email sign-up. It was labelled
 * "About this project", which a resident who came from a postcard to answer a
 * survey reads as background and never taps — the whole of the rest of the
 * consultation, one accurate word away from being unreachable. And the
 * accessibility contact, the one route out for somebody who cannot use the map
 * at all, was rendered as a SIBLING BELOW a `h-dvh overflow-hidden` grid: a full
 * viewport down, under a map that swallows a drag, with nothing on screen
 * suggesting it was there.
 *
 * WHAT THIS FILE CANNOT PROVE. jsdom has no box model and does not run Mapbox
 * GL. It cannot show that anything is visible or reachable by scrolling. What it
 * proves is what the label SAYS for a given campaign, and that the contact is
 * inside the surface rather than after it — which is the half that regresses
 * silently.
 */
import type { ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle } from "@/lib/engagement/portal-i18n/messages";
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

const EN_LOCALE = resolvePortalLocale({ requested: "en", acceptLanguage: null });
const EN_MESSAGES = buildPortalMessageBundle(EN_LOCALE);
const EN_INDEX = emptyPortalTranslationIndex("en");

function operatorText(text: string) {
  return resolveOperatorText(EN_INDEX, { entity: "campaign", id: "campaign-1", field: "title" }, text);
}

type ShellProps = ComponentProps<typeof import("@/components/engagement/public-map-shell").PublicMapShell>;

function shellProps(overrides: Partial<ShellProps> = {}): ShellProps {
  return {
    shareToken: "share-token-12345",
    acceptingSubmissions: true,
    categories: [],
    items: [],
    readFailures: { comments: false, categories: false, closeLoop: false, project: false },
    mapFraming: resolvePortalMapFraming({}),
    messages: EN_MESSAGES,
    campaignTitle: operatorText("Downtown listening campaign"),
    campaignDescription: null,
    detailsHref: "/engage/share-token-12345/about",
    detailsContents: { survey: false, comments: false, closeLoop: false },
    mapAvailable: true,
    ...overrides,
  };
}

async function importShell() {
  return (await import("@/components/engagement/public-map-shell")).PublicMapShell;
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the one door names what is actually behind it", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token-for-the-participant-map");
  });

  /**
   * FOUR CAMPAIGNS, FOUR SENTENCES. The label is derived, not written, because
   * the two failures are symmetrical: a door that promises a survey to a
   * campaign with none costs a resident a wasted tap, and a door that says
   * "About this project" to a campaign that HAS one costs the survey.
   *
   * The expected strings come from the REAL catalog rather than being typed
   * here — a fixture that declared its own copy could assert a sentence the
   * product does not carry.
   */
  const cases: Array<[string, ShellProps["detailsContents"], string]> = [
    ["a survey and comments", { survey: true, comments: true, closeLoop: false }, "portal.openDetailsSurveyAndComments"],
    ["only a survey", { survey: true, comments: false, closeLoop: false }, "portal.openDetailsSurvey"],
    ["only comments", { survey: false, comments: true, closeLoop: false }, "portal.openDetailsComments"],
    ["neither", { survey: false, comments: false, closeLoop: false }, "portal.openDetails"],
  ];

  for (const [name, detailsContents, key] of cases) {
    it(`says the right thing for a campaign with ${name}`, async () => {
      const PublicMapShell = await importShell();
      render(<PublicMapShell {...shellProps({ detailsContents })} />);

      const expected = EN_MESSAGES.messages[key as keyof typeof EN_MESSAGES.messages];
      expect(expected).toBeTruthy();
      expect(screen.getByTestId("portal-details-link")).toHaveTextContent(expected);
    });
  }

  it("promises the record of what the team did only when there is one", async () => {
    const PublicMapShell = await importShell();
    const { rerender } = render(
      <PublicMapShell {...shellProps({ detailsContents: { survey: true, comments: true, closeLoop: false } })} />
    );
    const hint = EN_MESSAGES.messages["portal.openDetailsHint"];
    expect(screen.getByTestId("portal-details-link")).not.toHaveTextContent(hint);

    rerender(
      <PublicMapShell {...shellProps({ detailsContents: { survey: true, comments: true, closeLoop: true } })} />
    );
    expect(screen.getByTestId("portal-details-link")).toHaveTextContent(hint);
  });
});

describe("the way out for a resident who cannot use the map", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token-for-the-participant-map");
  });

  /**
   * INSIDE THE SHELL, and inside the RAIL — not after either. Asserted by
   * containment rather than by presence: the notice was present before this fix
   * too, as a sibling one full viewport below a screen-filling map.
   */
  it("renders the accessibility contact inside the scrolling rail, above the one door", async () => {
    const PublicMapShell = await importShell();
    render(
      <PublicMapShell
        {...shellProps({
          accessibilityNotice: <p data-testid="a11y-contact">Call the project team on 555-0100</p>,
        })}
      />
    );

    const contact = screen.getByTestId("a11y-contact");
    const shell = screen.getByTestId("portal-shell-map-first");
    const sheet = screen.getByTestId("portal-input-sheet");
    const door = screen.getByTestId("portal-details-link");

    expect(shell.contains(contact)).toBe(true);
    expect(sheet.contains(contact)).toBe(true);
    // Above the pinned link, so it is part of what a resident scrolls through
    // rather than something below the end of the rail.
    expect(contact.compareDocumentPosition(door) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /** The same on a deployment with no map key, where the rail IS the page. */
  it("renders it on the no-map surface too", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");
    vi.resetModules();

    const PublicMapShell = await importShell();
    render(
      <PublicMapShell
        {...shellProps({
          mapAvailable: false,
          accessibilityNotice: <p data-testid="a11y-contact">Call the project team on 555-0100</p>,
        })}
      />
    );

    expect(screen.getByTestId("portal-shell-no-map").contains(screen.getByTestId("a11y-contact"))).toBe(true);
  });
});
