/**
 * THE MAP-FIRST PARTICIPANT SURFACE — what it renders, and what it must never
 * stop rendering when the map cannot be drawn.
 *
 * ============================================================================
 * WHAT THIS FILE CANNOT PROVE, STATED FIRST SO NOBODY READS IT AS MORE
 * ============================================================================
 *
 * jsdom applies NO stylesheet, has NO box model, and does not run Mapbox GL at
 * all (the `mapboxgl` module is mocked below, and even unmocked it needs WebGL).
 * Therefore NOTHING here is evidence that:
 *
 *   - the map fills the viewport, or is even visible;
 *   - the bottom sheet peeks above the fold on a phone, or opens when tapped;
 *   - the rail scrolls independently of the map;
 *   - a tap target is 44 pixels.
 *
 * Every one of those is a browser fact and has to be checked by opening the
 * page. What CAN be proved here is structural, and it is the part that silently
 * regresses: which elements exist, which do not, what the one link points at,
 * and — the case this surface is most likely to break — that a resident on a
 * deployment with no map key can still send their input.
 *
 * ============================================================================
 * THE TOKEN IS READ AT MODULE SCOPE
 * ============================================================================
 *
 * `public-map-stage.tsx` resolves `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` once when
 * the module is first evaluated, so every case here resets the module registry
 * and imports fresh under the environment it wants. A single import shared
 * between the two cases would test one branch twice.
 */
import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { PortalLanguagePicker } from "@/components/engagement/portal-language-picker";
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

/**
 * The participant's language, resolved the way a request resolves it, and the
 * catalog built by the real builder. Never a hand-written message map — a
 * fixture that declared its own strings could assert copy the catalog does not
 * carry, which is the one thing a copy test exists to catch.
 */
const EN_LOCALE = resolvePortalLocale({ requested: "en", acceptLanguage: null });
const EN_MESSAGES = buildPortalMessageBundle(EN_LOCALE);
const EN_INDEX = emptyPortalTranslationIndex("en");

/** Operator text through the REAL resolver, so its provenance is one the resolver produces. */
function operatorText(text: string) {
  return resolveOperatorText(EN_INDEX, { entity: "campaign", id: "campaign-1", field: "title" }, text);
}

/** A campaign nothing framed, built by the real resolver rather than described. */
const UNFRAMED = resolvePortalMapFraming({});

const ITEMS = [
  {
    id: "item-1",
    latitude: 39.2,
    longitude: -121.05,
    title: "Crossing is dangerous",
    body: "Cars turn without looking.",
    geometry: null,
    votesCount: 3,
    parentItemId: null,
  },
];

type ShellProps = ComponentProps<typeof import("@/components/engagement/public-map-shell").PublicMapShell>;

function shellProps(overrides: Partial<ShellProps> = {}): ShellProps {
  return {
    shareToken: "share-token-12345",
    acceptingSubmissions: true,
    categories: [],
    items: ITEMS,
    readFailures: { comments: false, categories: false, closeLoop: false, project: false },
    demographicsEnabled: false,
    mapFraming: UNFRAMED,
    contextLayers: null,
    messages: EN_MESSAGES,
    campaignTitle: operatorText("Downtown listening campaign"),
    campaignDescription: null,
    detailsHref: "/engage/share-token-12345/about?lang=es",
    detailsContents: { survey: true, comments: true, closeLoop: true },
    mapAvailable: true,
    ...overrides,
  };
}

async function importShell() {
  const shellModule = await import("@/components/engagement/public-map-shell");
  return shellModule.PublicMapShell;
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("the map-first participant surface, with a map key", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token-for-the-participant-map");
  });

  it("puts the map on the page as its own element, not inside a form field", async () => {
    const PublicMapShell = await importShell();
    render(<PublicMapShell {...shellProps()} />);

    // The stage exists and the shell is in its two-part layout. Neither says
    // anything about SIZE — see the header.
    expect(screen.getByTestId("portal-map-stage")).toBeInTheDocument();
    expect(screen.getByTestId("portal-shell-map-first")).toBeInTheDocument();
    expect(screen.queryByTestId("portal-shell-no-map")).not.toBeInTheDocument();
    // And the "we cannot draw this" notice is NOT shown, because we can.
    expect(screen.queryByTestId("engagement-map-unavailable")).not.toBeInTheDocument();
  });

  it("walks the resident through giving input one step at a time", async () => {
    const PublicMapShell = await importShell();
    const { container } = render(<PublicMapShell {...shellProps()} />);

    // Five named steps, and only the first one's fields are on screen.
    const stepList = screen.getByTestId("portal-step-list");
    expect(stepList.querySelectorAll("li")).toHaveLength(5);
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
    expect(screen.getByTestId("portal-step-where")).toBeInTheDocument();
    // The one required field is NOT on screen yet. Queried by id rather than by
    // label: the sheet's own toggle is called "Tell us what you think", and a label
    // regex loose enough to catch it would pass whatever the step showed.
    expect(container.querySelector("#portal-body")).toBeNull();

    // Next reaches the one required field.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("portal-step-what")).toBeInTheDocument();
    expect(container.querySelector("#portal-body")).toBeInstanceOf(HTMLTextAreaElement);
  });

  it("says where the map opens, and only where there is a map to open", async () => {
    const PublicMapShell = await importShell();
    render(<PublicMapShell {...shellProps()} />);
    expect(screen.getByTestId("portal-map-framing")).toBeInTheDocument();
  });

  it("offers exactly one way onward, as a real link that works before hydration", async () => {
    const PublicMapShell = await importShell();
    /*
      RENDERED WITH THE LANGUAGE CHROME THE ROUTE ACTUALLY PASSES — the real
      picker, one `<a href="?lang=xx">` per locale this portal serves. This test
      used to pass NO chrome at all and then assert the whole shell contained
      exactly one anchor, which made its own headline claim untestable: with the
      picker absent there was nothing for "excluding the language picker" to
      exclude, and production renders twenty-odd more anchors than the number it
      asserted. The invariant is "one way ONWARD", so the picker's links are
      excluded by WHERE THEY ARE rather than by not existing.
    */
    const { container } = render(
      <PublicMapShell
        {...shellProps({
          languageChrome: (
            <div data-testid="test-language-chrome">
              <PortalLanguagePicker
                locale={EN_LOCALE}
                messages={EN_MESSAGES}
                pathname="/engage/share-token-12345"
                search="lang=es"
              />
            </div>
          ),
        })}
      />
    );

    const onward = screen.getByTestId("portal-details-link");
    expect(onward.tagName).toBe("A");
    expect(onward).toHaveAttribute("href", "/engage/share-token-12345/about?lang=es");
    expect(onward).toHaveTextContent("See the survey and what other people said");

    // The picker really did render links, or the exclusion below would be
    // excluding nothing — the exact hole this test had.
    const chrome = screen.getByTestId("test-language-chrome");
    expect(chrome.querySelectorAll("a").length).toBeGreaterThan(1);

    /*
      ONE. Nathaniel's requirement was a single way out of the map, not a nav
      bar, and the failure mode is additive: somebody adds a "Survey" link, then
      a "Comments" link, and the surface is a menu again.
    */
    const onwardLinks = [...container.querySelectorAll("a")].filter(
      (anchor) => !chrome.contains(anchor)
    );
    expect(onwardLinks).toHaveLength(1);
    expect(onwardLinks[0]).toBe(onward);
  });

  it("keeps the sheet openable without JavaScript", async () => {
    const PublicMapShell = await importShell();
    const { container } = render(<PublicMapShell {...shellProps()} />);

    // A checkbox and a <label> for it — not a button, which would need a
    // hydrated handler. jsdom cannot prove the CSS that reads `:checked`
    // actually moves the sheet; it can prove the mechanism is not a click
    // handler.
    const toggle = container.querySelector("#portal-sheet-toggle");
    expect(toggle).toBeInstanceOf(HTMLInputElement);
    expect((toggle as HTMLInputElement).type).toBe("checkbox");
    expect(container.querySelector('label[for="portal-sheet-toggle"]')).toBeInTheDocument();
  });
});

describe("the map-first participant surface, with NO map key", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");
  });

  it("gives the resident the whole surface instead of an empty map", async () => {
    const PublicMapShell = await importShell();
    render(<PublicMapShell {...shellProps()} />);

    expect(screen.queryByTestId("portal-map-stage")).not.toBeInTheDocument();
    expect(screen.getByTestId("portal-shell-no-map")).toBeInTheDocument();
    expect(screen.getByTestId("engagement-map-unavailable")).toBeInTheDocument();
    expect(screen.getByText("The map cannot be shown here")).toBeInTheDocument();
  });

  /**
   * THE ONE THAT MATTERS MOST. A map-first shell makes this easy to break: with
   * the map as the page, a deployment with no map key is one careless render
   * away from a page a resident cannot use at all.
   */
  it("still accepts input, and still asks where", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const PublicMapShell = await importShell();
    render(<PublicMapShell {...shellProps()} />);

    // "Where" survives the missing map — as a question in words, because there
    // is no map to point at.
    const where = screen.getByLabelText(/Where is this/i);
    fireEvent.change(where, { target: { value: "Corner of Main and 4th" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(document.querySelector("#portal-body") as HTMLTextAreaElement, {
      target: { value: "The signal is too short to cross." },
    });

    // Walk the rest of the way rather than jumping: this is the path a resident
    // takes, and a jump would skip the optional steps whose absence is the point.
    while (!screen.queryByTestId("portal-step-send")) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    fireEvent.click(screen.getByRole("button", { name: /Send what I wrote/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/engage/share-token-12345/submit");
    const payload = JSON.parse(String(init.body)) as { body: string; website: string };
    expect(payload.body).toContain("The signal is too short to cross.");
    /*
      THE TYPED PLACE REACHES THE AGENCY. There is no column for it, so it is
      folded into the comment under a labelled line in the resident's own
      language. Without this, a resident with no map has no way to say WHERE at
      all — a hole the old portal hid behind the map being incidental.
    */
    expect(payload.body).toContain("Where: Corner of Main and 4th");
    // The honeypot still travels. A second form that forgot it would switch spam
    // protection off for everyone who used that form.
    expect(payload).toHaveProperty("website");

    await screen.findByTestId("portal-sidebar-received");
  });

  it("does not describe a map that is not there", async () => {
    const framed = resolvePortalMapFraming({
      campaignPlace: { state: "set", label: "Jefferson Street", bbox: { minLon: -121.1, minLat: 39.1, maxLon: -121.0, maxLat: 39.3 } },
      submissionGeofenceEnabled: true,
    });
    const PublicMapShell = await importShell();
    render(<PublicMapShell {...shellProps({ mapFraming: framed })} />);

    /*
      Both sentences `resolvePortalMapFraming` builds name "this map" — where it
      opens, and what it will accept. The old portal printed them unconditionally,
      directly above the box saying the map was unavailable. Suppressed here
      rather than carried forward.
    */
    expect(screen.queryByTestId("portal-map-framing")).not.toBeInTheDocument();
    expect(screen.queryByText(/Jefferson Street/)).not.toBeInTheDocument();
  });
});
