/**
 * A RESIDENT GETS A MAP ON A DEPLOYMENT WITH NO MAPBOX KEY (2026-10-11).
 *
 * Before this, no key meant a words-only form. Now an operator may name a
 * MapLibre style (`NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL`): a local `.pmtiles`
 * extract served by the deployment, or a keyless public style. A key, when
 * set, still wins.
 *
 * MapLibre is replaced here by the same lifecycle fake as Mapbox, so nothing
 * proves MapLibre renders the style. That was checked in a browser on the day
 * against OpenFreeMap and against a local extract; see the review note.
 */
import type { ComponentProps } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_MAP_STYLE_ENV, openMapStyleOrigin, resolveOpenMapStyleUrl } from "@/lib/cartographic/open-map-style";
import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle } from "@/lib/engagement/portal-i18n/messages";
import { emptyPortalTranslationIndex, resolveOperatorText } from "@/lib/engagement/portal-i18n/operator-text";
import { resolvePortalMapFraming, type PublicPortalBundle } from "@/lib/engagement/public-portal-data";
import { buildPortalMapShellProps } from "@/lib/engagement/portal-surface-props";
import { resolvePublicBasemapConfig } from "@/lib/cartographic/basemaps";
import { failNextFakeMapConstruction, fakeMaps, lastFakeMap, resetFakeMaps } from "@/test/helpers/mapbox-gl-fake";

const protocols = vi.hoisted(() => ({ added: [] as string[] }));

vi.mock("mapbox-gl", async () => {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  return createMapboxGlModuleFake();
});
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
const fakeMapLibre = vi.hoisted(() => async () => {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  const fake = createMapboxGlModuleFake();
  const api = { ...fake.default, addProtocol: (name: string) => protocols.added.push(name), setWorkerUrl: () => undefined };
  return { default: api, ...api };
});
vi.mock("maplibre-gl", fakeMapLibre);
vi.mock("pmtiles", () => ({
  Protocol: class {
    tile = () => undefined;
  },
}));

const STYLE = "https://tiles.example.org/styles/liberty";
const EN_MESSAGES = buildPortalMessageBundle(resolvePortalLocale({ requested: "en", acceptLanguage: null }));
/** What a deployment gets: no Mapbox key means no Mapbox backgrounds. */
const NO_KEY_BASEMAPS = resolvePublicBasemapConfig({ mapboxToken: "", env: {} });
const KEY_BASEMAPS = resolvePublicBasemapConfig({ mapboxToken: "pk.test", env: {} });

function text(value: string) {
  return resolveOperatorText(emptyPortalTranslationIndex("en"), { entity: "campaign", id: "c", field: "title" }, value);
}

type ShellProps = ComponentProps<typeof import("@/components/engagement/public-map-shell").PublicMapShell>;

function shellProps(basemaps = NO_KEY_BASEMAPS): ShellProps {
  return {
    shareToken: "share-token-12345",
    acceptingSubmissions: true,
    categories: [],
    items: [
      {
        id: "item-crossing",
        latitude: 39.2,
        longitude: -121.05,
        title: "Crossing",
        body: "Hard to cross here.",
        votesCount: 0,
        categoryId: null,
        color: "#0072b2",
        createdAt: "2026-07-27T12:00:00Z",
        parentItemId: null,
      },
    ],
    readFailures: { comments: false, categories: false, closeLoop: false, project: false },
    mapFraming: resolvePortalMapFraming({}),
    messages: EN_MESSAGES,
    campaignTitle: text("Downtown listening"),
    campaignDescription: null,
    detailsHref: "/engage/share-token-12345/about",
    detailsContents: { survey: false, comments: true, closeLoop: false },
    mapAvailable: true,
    basemapChoices: basemaps.choices,
    defaultBasemapId: basemaps.defaultId,
  } as ShellProps;
}

/** Renders the shell and waits for the asynchronously loaded library to build its map. */
async function renderShell(basemaps = NO_KEY_BASEMAPS) {
  const { PublicMapShell } = await import("@/components/engagement/public-map-shell");
  return render(<PublicMapShell {...shellProps(basemaps)} />);
}

beforeEach(() => {
  vi.resetModules();
  resetFakeMaps();
  protocols.added = [];
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "");
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");
  vi.stubEnv(OPEN_MAP_STYLE_ENV, STYLE);
});

afterEach(() => {
  cleanup();
  vi.doMock("maplibre-gl", fakeMapLibre);
  vi.unstubAllEnvs();
});

describe("the operator's style setting", () => {
  it("takes a web address or a path on the deployment, and nothing else", () => {
    expect(resolveOpenMapStyleUrl(` ${STYLE} `)).toBe(STYLE);
    expect(resolveOpenMapStyleUrl("/maps/style.json")).toBe("/maps/style.json");
    for (const bad of ["", "   ", "//evil.example/style.json", "javascript:alert(1)", "file:///etc/style.json", "style.json"]) {
      expect(resolveOpenMapStyleUrl(bad), bad).toBeNull();
    }
    expect(resolveOpenMapStyleUrl(undefined)).toBeNull();
  });

  it("names the origin the browser must be allowed to reach, or none for a local style", () => {
    expect(openMapStyleOrigin(STYLE)).toBe("https://tiles.example.org");
    expect(openMapStyleOrigin("/maps/style.json")).toBeNull();
    expect(openMapStyleOrigin("not a url")).toBeNull();
  });

  it("turns the map on for a page that has no Mapbox key", () => {
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
    expect(buildPortalMapShellProps(bundle, { env: { [OPEN_MAP_STYLE_ENV]: STYLE } }).mapAvailable).toBe(true);
    expect(buildPortalMapShellProps(bundle, { env: { [OPEN_MAP_STYLE_ENV]: "javascript:x" } }).mapAvailable).toBe(false);
    expect(buildPortalMapShellProps(bundle, { env: {} }).mapAvailable).toBe(false);
    // Place search is Mapbox's geocoder, so it stays off without a key.
    expect(buildPortalMapShellProps(bundle, { env: { [OPEN_MAP_STYLE_ENV]: STYLE } }).placeSearchAvailable).toBe(false);
  });
});

describe("the map with no Mapbox key", () => {
  it("is drawn by MapLibre with the operator's style, pins and all", async () => {
    await renderShell();
    await waitFor(() => expect(fakeMaps()).toHaveLength(1));
    const map = lastFakeMap();
    expect(map.options.style).toBe(STYLE);
    // Registered so a style may point at a local `.pmtiles` file.
    expect(protocols.added).toEqual(["pmtiles"]);
    act(() => map.loadStyle());
    await waitFor(() => expect(map.sourceIds()).toContain("engagement-points"));
    const data = map.sourceData("engagement-points") as { features: { properties: { itemId: string } }[] };
    expect(data.features.map((feature) => feature.properties.itemId)).toEqual(["item-crossing"]);
  });

  it("offers none of Mapbox's backgrounds, and no Mapbox place search", async () => {
    // Even handed the list a keyed deployment would offer.
    await renderShell(KEY_BASEMAPS);
    await waitFor(() => expect(fakeMaps()).toHaveLength(1));
    act(() => lastFakeMap().loadStyle());
    expect(screen.queryByTestId("public-basemap-picker")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("labels a group of pins in the style's own font, or not at all when the style has no fonts", async () => {
    await renderShell();
    await waitFor(() => expect(fakeMaps()).toHaveLength(1));
    const map = lastFakeMap();
    const style = { glyphs: "https://tiles.example.org/fonts/{fontstack}/{range}.pbf", layers: [{ id: "road-label", type: "symbol", layout: { "text-font": ["Noto Sans Bold"] } }] };
    map.getStyle = () => style as never;
    act(() => map.loadStyle());
    await waitFor(() => expect(map.layer("engagement-cluster-count")).toBeDefined());
    expect((map.layer("engagement-cluster-count")?.spec.layout as Record<string, unknown>)["text-font"]).toEqual(["Noto Sans Bold"]);

    cleanup();
    resetFakeMaps();
    await renderShell();
    await waitFor(() => expect(fakeMaps()).toHaveLength(1));
    const bare = lastFakeMap();
    act(() => bare.loadStyle());
    await waitFor(() => expect(bare.sourceIds()).toContain("engagement-points"));
    expect(bare.layer("engagement-cluster-count")).toBeUndefined();
    expect(bare.layer("engagement-clusters")).toBeDefined();
  });

  it("opens a group of pins when MapLibre answers the zoom with a promise", async () => {
    await renderShell();
    await waitFor(() => expect(fakeMaps()).toHaveLength(1));
    const map = lastFakeMap();
    act(() => map.loadStyle());
    await waitFor(() => expect(map.sourceIds()).toContain("engagement-points"));
    const source = map.getSource("engagement-points") as { getClusterExpansionZoom: unknown };
    source.getClusterExpansionZoom = (_id: number) => Promise.resolve(16);
    map.renderedFeatures = [
      { layer: { id: "engagement-clusters" }, properties: { cluster_id: 7 }, geometry: { type: "Point", coordinates: [-121.05, 39.2] } },
    ];
    act(() => map.tap());
    await waitFor(() => expect(map.easeToCalls).toContainEqual({ center: [-121.05, 39.2], zoom: 16 }));
  });

  it("raises the open style's buildings in 3D, under the comments even when the style has no labels", async () => {
    await renderShell();
    await waitFor(() => expect(fakeMaps()).toHaveLength(1));
    const map = lastFakeMap();
    act(() => map.loadStyle());
    await waitFor(() => expect(map.sourceIds()).toContain("engagement-points"));
    // OpenMapTiles schema, as OpenFreeMap serves it; a style with no symbol layers.
    map.addSource("openmaptiles", {});
    const control = map.controls.find(
      (entry): entry is { button: HTMLButtonElement } => typeof entry === "object" && entry !== null && "button" in entry
    );
    act(() => control?.button.click());
    const buildings = map.layer("engagement-3d-buildings");
    expect(buildings?.spec).toMatchObject({ source: "openmaptiles", "source-layer": "building" });
    expect((buildings?.spec.paint as Record<string, unknown>)["fill-extrusion-height"]).toEqual(["coalesce", ["get", "render_height"], 0]);
    // Inserted before a comment layer, so no building can cover a pin. (The fake
    // records where a layer was asked to go; it does not reorder.)
    expect(buildings?.beforeId).toMatch(/^engagement-(?!3d)/);
  });

  it("says the map could not load when MapLibre itself fails to arrive", async () => {
    // A mocked module's factory is cached across `resetModules`, so the failing one is swapped in here.
    vi.doMock("maplibre-gl", () => {
      throw new Error("chunk failed to load");
    });
    await renderShell();
    await waitFor(() => expect(screen.getByTestId("portal-map-stage-unavailable")).toBeInTheDocument());
    expect(screen.getByTestId("portal-map-stage-unavailable").textContent).toContain(EN_MESSAGES.messages["portal.mapMissingTitle"]);
    // The operator is pointed at their style setting, not at a Mapbox key they never had.
    expect(screen.getByTestId("portal-map-stage-unavailable").textContent).toContain("NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL");
    expect(screen.getByTestId("portal-map-stage-unavailable").textContent).not.toContain("Mapbox");
    expect(fakeMaps()).toHaveLength(0);
  });

  it("says the map could not load when MapLibre cannot build a map (no WebGL2)", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    failNextFakeMapConstruction("Failed to initialize WebGL");
    await renderShell();
    await waitFor(() => expect(screen.getByTestId("portal-map-stage-unavailable")).toBeInTheDocument());
    expect(screen.getByTestId("portal-map-stage-unavailable").textContent).toContain("WebGL2");
    expect(fakeMaps()).toHaveLength(0);
    quiet.mockRestore();
  });
});

describe("a Mapbox key still wins", () => {
  it("draws with Mapbox and never loads MapLibre", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token-for-the-participant-map");
    await renderShell(KEY_BASEMAPS);
    const map = lastFakeMap();
    expect(String(map.options.style)).toMatch(/^mapbox:\/\//);
    // The same list the MapLibre case is handed does appear here.
    expect(screen.getByTestId("public-basemap-picker")).toBeInTheDocument();
    expect(protocols.added).toEqual([]);
  });

  it("and with neither, the page offers no map", async () => {
    vi.stubEnv(OPEN_MAP_STYLE_ENV, "");
    const stage = await import("@/components/engagement/public-map-stage");
    expect(stage.PARTICIPANT_MAP_CAN_DRAW).toBe(false);
  });
});

describe("the browser is allowed to fetch the style", () => {
  async function csp() {
    const config = (await import("../../next.config")).default;
    const headers = (await config.headers?.()) ?? [];
    return headers.flatMap((block) => block.headers).find((header) => header.key === "Content-Security-Policy")?.value ?? "";
  }
  const directive = (policy: string, name: string) => policy.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) ?? "";

  it("from the style's host and any extra hosts the operator lists, for tiles and images", async () => {
    vi.stubEnv("OPENPLAN_MAP_EXTRA_ORIGINS", " https://fonts.example.net/glyphs , not a url,");
    const policy = await csp();
    for (const name of ["connect-src", "img-src"]) {
      expect(directive(policy, name)).toContain("https://tiles.example.org");
      expect(directive(policy, name)).toContain("https://fonts.example.net");
    }
    expect(policy).not.toContain("not a url");
  });

  it("and opens nothing new for a style served by the deployment itself", async () => {
    // Compared with no style at all, so whatever else the environment holds
    // (another test's Supabase URL, say) is on both sides.
    vi.stubEnv(OPEN_MAP_STYLE_ENV, "");
    const without = await csp();
    vi.resetModules();
    vi.stubEnv(OPEN_MAP_STYLE_ENV, "/maps/style.json");
    const local = await csp();
    expect(local).toBe(without);
    expect(directive(local, "connect-src")).not.toContain("tiles.example.org");
  });
});
