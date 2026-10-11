/**
 * "Find a street or place" on the resident's map, added 2026-10-10.
 *
 * The geocoder is Mapbox's; `fetch` is replaced here, so nothing proves Mapbox
 * still answers in this shape. That was checked live in a browser on the day:
 * "125 Mill Street" returned Grass Valley first, in English and Spanish.
 */
import type { ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPlaceSearchUrl,
  parsePlaceSearchResults,
  placeSearchEnabled,
  PLACE_SEARCH_ENV,
} from "@/lib/engagement/place-search";
import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle } from "@/lib/engagement/portal-i18n/messages";
import { resolvePortalMapFraming } from "@/lib/engagement/public-portal-data";
import { emptyPortalTranslationIndex, resolveOperatorText } from "@/lib/engagement/portal-i18n/operator-text";
import { resolvePublicBasemapConfig } from "@/lib/cartographic/basemaps";
import { lastFakeMap, resetFakeMaps } from "@/test/helpers/mapbox-gl-fake";
import { buildPortalMapShellProps } from "@/lib/engagement/portal-surface-props";
import type { PublicPortalBundle } from "@/lib/engagement/public-portal-data";

vi.mock("mapbox-gl", async () => {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  return createMapboxGlModuleFake();
});
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

const EN_MESSAGES = buildPortalMessageBundle(resolvePortalLocale({ requested: "en", acceptLanguage: null }));
const ES_MESSAGES = buildPortalMessageBundle(resolvePortalLocale({ requested: "es", acceptLanguage: null }));

/** Two results in Mapbox geocoding v6's shape: one address, one place with an extent. */
const GEOCODER_REPLY = {
  type: "FeatureCollection",
  features: [
    {
      id: "address.1",
      geometry: { type: "Point", coordinates: [-121.0611, 39.2187] },
      properties: { name: "125 Mill Street", place_formatted: "Grass Valley, California 95945, United States" },
    },
    {
      id: "place.2",
      geometry: { type: "Point", coordinates: [-121.0161, 39.2616] },
      properties: { name: "Nevada City", place_formatted: "California, United States", bbox: [-121.05, 39.24, -120.99, 39.28] },
    },
    // No usable position: dropped rather than flown to [0, 0].
    { id: "bad.3", geometry: { type: "Point", coordinates: [null, 1] }, properties: { name: "Nowhere" } },
  ],
};

describe("the geocoder request and reply", () => {
  it("asks for streets and places near the map, in the resident's language", () => {
    const url = new URL(
      buildPlaceSearchUrl("  125 Mill Street ", { token: "pk.abc", language: "es-MX", proximity: [-121.06, 39.22] })
    );
    expect(url.origin + url.pathname).toBe("https://api.mapbox.com/search/geocode/v6/forward");
    expect(url.searchParams.get("q")).toBe("125 Mill Street");
    expect(url.searchParams.get("language")).toBe("es");
    expect(url.searchParams.get("proximity")).toBe("-121.06000,39.22000");
    expect(url.searchParams.get("types")).not.toContain("country");
  });

  it("keeps results with a position and a name, and reads an extent when there is one", () => {
    const results = parsePlaceSearchResults(GEOCODER_REPLY);
    expect(results.map((result) => result.name)).toEqual(["125 Mill Street", "Nevada City"]);
    expect(results[0]).toMatchObject({ center: [-121.0611, 39.2187], bbox: null });
    expect(results[1].bbox).toEqual([-121.05, 39.24, -120.99, 39.28]);
    expect(parsePlaceSearchResults({ message: "Not Authorized" })).toEqual([]);
  });

  it("is on unless the operator switches it off", () => {
    expect(placeSearchEnabled({})).toBe(true);
    expect(placeSearchEnabled({ [PLACE_SEARCH_ENV]: "OFF " })).toBe(false);
  });

  it("reaches the map from the deployment's setting, and never without a map key", () => {
    const bundle = {
      acceptingSubmissions: true,
      messages: EN_MESSAGES,
      campaignText: { title: text("Downtown listening"), summary: null, publicDescription: null },
      portalProps: {
        shareToken: "share-token-12345",
        configurationVersionId: null,
        categories: [],
        approvedItems: [],
        surveyQuestions: [],
        closeLoopEntries: [],
        readFailures: { comments: false, categories: false, closeLoop: false, project: false },
        demographicsEnabled: false,
        mapFraming: resolvePortalMapFraming({}),
        contextLayers: null,
      },
    } as unknown as PublicPortalBundle;
    const token = { NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: "pk.test-token" };

    expect(buildPortalMapShellProps(bundle, { env: token }).placeSearchAvailable).toBe(true);
    expect(buildPortalMapShellProps(bundle, { env: { ...token, [PLACE_SEARCH_ENV]: "off" } }).placeSearchAvailable).toBe(false);
    expect(buildPortalMapShellProps(bundle, { env: {} }).placeSearchAvailable).toBe(false);
  });
});

type ShellProps = ComponentProps<typeof import("@/components/engagement/public-map-shell").PublicMapShell>;

function text(value: string) {
  return resolveOperatorText(emptyPortalTranslationIndex("en"), { entity: "campaign", id: "c", field: "title" }, value);
}

async function renderShell(overrides: Partial<ShellProps> = {}) {
  const { PublicMapShell } = await import("@/components/engagement/public-map-shell");
  const basemaps = resolvePublicBasemapConfig({ mapboxToken: "pk.test", env: {} });
  render(
    <PublicMapShell
      shareToken="share-token-12345"
      acceptingSubmissions
      categories={[]}
      items={[]}
      readFailures={{ comments: false, categories: false, closeLoop: false, project: false }}
      mapFraming={resolvePortalMapFraming({})}
      messages={EN_MESSAGES}
      campaignTitle={text("Downtown listening")}
      campaignDescription={null}
      detailsHref="/engage/share-token-12345/about"
      detailsContents={{ survey: false, comments: false, closeLoop: false }}
      mapAvailable
      placeSearchAvailable
      basemapChoices={basemaps.choices}
      defaultBasemapId={basemaps.defaultId}
      {...overrides}
    />
  );
  const map = lastFakeMap();
  act(() => map.loadStyle());
  return map;
}

describe("the search box on the map", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    resetFakeMaps();
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token-for-the-participant-map");
    fetchMock = vi.fn(async () => new Response(JSON.stringify(GEOCODER_REPLY), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetFakeMaps();
  });

  it("is not offered when the operator switched it off", async () => {
    await renderShell({ placeSearchAvailable: false });
    expect(screen.queryByRole("combobox", { name: "Find a street or place" })).not.toBeInTheDocument();
  });

  it("does not ask the geocoder about fewer than three letters", async () => {
    await renderShell();
    fireEvent.change(screen.getByRole("combobox", { name: "Find a street or place" }), { target: { value: "12" } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("moves the map to the chosen place, hands it focus, and marks nothing", async () => {
    const map = await renderShell();
    const box = screen.getByRole("combobox", { name: "Find a street or place" });
    fireEvent.change(box, { target: { value: "125 Mill" } });

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("q=125+Mill");

    fireEvent.keyDown(box, { key: "Enter" });

    expect(map.easeToCalls.at(-1)).toMatchObject({ center: [-121.0611, 39.2187] });
    expect(document.activeElement?.getAttribute("role")).toBe("application");
    expect(screen.getAllByRole("status").some((region) => region.textContent?.includes("125 Mill Street"))).toBe(true);
    const draft = map.sourceData("engagement-draw") as { features: unknown[] };
    expect(draft.features).toHaveLength(0);
  });

  it("does not search again, or reopen the list, for the name it just chose", async () => {
    await renderShell();
    const box = screen.getByRole("combobox", { name: "Find a street or place" });
    fireEvent.change(box, { target: { value: "125 Mill" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    fireEvent.keyDown(box, { key: "Enter" });

    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("cannot choose a stale result with Enter while the next search is pending", async () => {
    const map = await renderShell();
    const box = screen.getByRole("combobox", { name: "Find a street or place" });
    fireEvent.change(box, { target: { value: "125 Mill" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    const movesBefore = map.easeToCalls.length;

    fireEvent.change(box, { target: { value: "125 Mill Street, Reno" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(map.easeToCalls.length).toBe(movesBefore);
  });

  it("announces what the search found, and does not promise marking on a closed map", async () => {
    const map = await renderShell({ acceptingSubmissions: false });
    const box = screen.getByRole("combobox", { name: "Find a street or place" });
    fireEvent.change(box, { target: { value: "125 Mill" } });
    await waitFor(() =>
      expect(screen.getByTestId("portal-place-search-status")).toHaveTextContent(
        EN_MESSAGES.messages["portal.placeSearchCount"].replace("{count}", "2")
      )
    );
    fireEvent.keyDown(box, { key: "Enter" });
    expect(map.easeToCalls.length).toBeGreaterThan(0);
    const said = screen.getAllByRole("status").map((region) => region.textContent ?? "").join(" ");
    expect(said).toContain("Map moved to 125 Mill Street.");
    expect(said).not.toContain("Press Enter");
  });

  it("frames a place with an extent instead of zooming to a point", async () => {
    const map = await renderShell();
    const box = screen.getByRole("combobox", { name: "Find a street or place" });
    fireEvent.change(box, { target: { value: "Nevada" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));

    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(map.fitBoundsCalls.at(-1)?.bounds).toEqual([
      [-121.05, 39.24],
      [-120.99, 39.28],
    ]);
  });

  it("says plainly when the geocoder fails, in the resident's language", async () => {
    fetchMock.mockImplementation(async () => new Response("{}", { status: 401 }));
    await renderShell({ messages: ES_MESSAGES });
    fireEvent.change(screen.getByRole("combobox", { name: "Buscar una calle o un lugar" }), {
      target: { value: "Calle Mill" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("portal-place-search-status")).toHaveTextContent(
        ES_MESSAGES.messages["portal.placeSearchFailed"]
      )
    );
  });
});
