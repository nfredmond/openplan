/**
 * WHICH LIBRARY DRAWS A MAP, AND WHAT HAPPENS WHEN IT CANNOT START.
 *
 * The order is the public engagement map's, now shared by the staff maps:
 * a public Mapbox key, else the operator's MapLibre style, else no map and a
 * notice. MapLibre is replaced by the lifecycle fake, so nothing here proves
 * MapLibre renders a style; it proves the choice and the fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MapEngine, MapLibrary } from "@/lib/maps/map-engine";
import { FakeMapboxMap, resetFakeMaps } from "@/test/helpers/mapbox-gl-fake";

const protocols = vi.hoisted(() => ({ added: [] as string[] }));
const fakeMapLibre = vi.hoisted(() => async () => {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  const fake = createMapboxGlModuleFake();
  const api = { ...fake.default, addProtocol: (name: string) => protocols.added.push(name), setWorkerUrl: () => undefined };
  return { default: api, ...api };
});
vi.mock("maplibre-gl", fakeMapLibre);
vi.mock("pmtiles", () => ({ Protocol: class { tile = () => undefined; } }));

const STYLE = "https://tiles.example.org/styles/liberty";

async function engineModule() {
  return import("@/lib/maps/map-engine");
}

async function fakeMapbox(): Promise<MapLibrary> {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  return createMapboxGlModuleFake().default as unknown as MapLibrary;
}

beforeEach(() => {
  vi.resetModules();
  resetFakeMaps();
  protocols.added = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.doMock("maplibre-gl", fakeMapLibre);
  vi.restoreAllMocks();
});

describe("chooseMapEngine", () => {
  it("uses Mapbox when a public pk. token is set, even with a style", async () => {
    const { chooseMapEngine } = await engineModule();
    expect(chooseMapEngine({ mapboxAccessToken: " pk.abc ", openStyleUrl: STYLE })).toEqual({ kind: "mapbox", token: "pk.abc" });
    // The older variable name still counts.
    expect(chooseMapEngine({ legacyMapboxToken: "pk.legacy" })).toEqual({ kind: "mapbox", token: "pk.legacy" });
  });

  it("refuses a secret sk. token and falls through to the style", async () => {
    const { chooseMapEngine } = await engineModule();
    expect(chooseMapEngine({ mapboxAccessToken: "sk.secret", openStyleUrl: STYLE })).toEqual({ kind: "maplibre", styleUrl: STYLE });
  });

  it("uses MapLibre with the operator's style when there is no key", async () => {
    const { chooseMapEngine } = await engineModule();
    expect(chooseMapEngine({ openStyleUrl: "/maps/style.json" })).toEqual({ kind: "maplibre", styleUrl: "/maps/style.json" });
    // A value a browser cannot load is not a style.
    expect(chooseMapEngine({ openStyleUrl: "javascript:alert(1)" }).kind).toBe("none");
  });

  it("chooses no engine with neither, and says when a token was set but unusable", async () => {
    const { chooseMapEngine } = await engineModule();
    expect(chooseMapEngine({})).toEqual({ kind: "none", unusableToken: false });
    expect(chooseMapEngine({ mapboxAccessToken: "sk.secret" })).toEqual({ kind: "none", unusableToken: true });
  });

  it("reads this build's settings from the environment", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL", STYLE);
    const { deploymentMapEngine } = await engineModule();
    expect(deploymentMapEngine()).toEqual({ kind: "maplibre", styleUrl: STYLE });
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "pk.legacy");
    expect(deploymentMapEngine()).toEqual({ kind: "mapbox", token: "pk.legacy" });
  });

  it("hands MapLibre the operator's style, never a mapbox:// one", async () => {
    const { styleForEngine } = await engineModule();
    const mapbox: MapEngine = { kind: "mapbox", token: "pk.abc" };
    const libre: MapEngine = { kind: "maplibre", styleUrl: STYLE };
    expect(styleForEngine(mapbox, "mapbox://styles/mapbox/light-v11")).toBe("mapbox://styles/mapbox/light-v11");
    expect(styleForEngine(libre, "mapbox://styles/mapbox/light-v11")).toBe(STYLE);
    expect(styleForEngine({ kind: "none", unusableToken: false }, "mapbox://styles/mapbox/light-v11")).toBeNull();
  });
});

describe("startMap", () => {
  it("builds with Mapbox at once and sets the token", async () => {
    const { startMap } = await engineModule();
    const mapbox = await fakeMapbox();
    const build = vi.fn((gl: MapLibrary) => {
      new gl.Map({ container: document.createElement("div") });
      return () => undefined;
    });
    startMap({ kind: "mapbox", token: "pk.abc" }, mapbox, build, vi.fn());
    expect(build).toHaveBeenCalledWith(mapbox);
    expect(mapbox.accessToken).toBe("pk.abc");
    expect(protocols.added).toEqual([]);
  });

  it("loads MapLibre, registers pmtiles, then builds", async () => {
    const { startMap } = await engineModule();
    const mapbox = await fakeMapbox();
    const build = vi.fn((_gl: MapLibrary) => () => undefined);
    startMap({ kind: "maplibre", styleUrl: STYLE }, mapbox, build, vi.fn());
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(1));
    expect(build.mock.calls[0][0]).not.toBe(mapbox);
    expect(protocols.added).toEqual(["pmtiles"]);
  });

  it("does nothing with no engine", async () => {
    const { startMap } = await engineModule();
    const build = vi.fn(() => () => undefined);
    const onCannotStart = vi.fn();
    startMap({ kind: "none", unusableToken: false }, await fakeMapbox(), build, onCannotStart);
    expect(build).not.toHaveBeenCalled();
    expect(onCannotStart).not.toHaveBeenCalled();
  });

  it("reports a MapLibre construction failure instead of throwing (no WebGL2)", async () => {
    const { startMap } = await engineModule();
    const { failNextFakeMapConstruction } = await import("@/test/helpers/mapbox-gl-fake");
    const onCannotStart = vi.fn();
    failNextFakeMapConstruction("Failed to initialize WebGL");
    startMap(
      { kind: "maplibre", styleUrl: STYLE },
      await fakeMapbox(),
      (gl) => {
        new gl.Map({ container: document.createElement("div") });
        return () => undefined;
      },
      onCannotStart,
    );
    await vi.waitFor(() => expect(onCannotStart).toHaveBeenCalledTimes(1));
    expect(String(onCannotStart.mock.calls[0][0])).toContain("WebGL");
  });

  it("reports a MapLibre chunk that never arrives", async () => {
    vi.doMock("maplibre-gl", () => {
      throw new Error("chunk failed to load");
    });
    const { startMap } = await engineModule();
    const build = vi.fn(() => () => undefined);
    const onCannotStart = vi.fn();
    startMap({ kind: "maplibre", styleUrl: STYLE }, await fakeMapbox(), build, onCannotStart);
    await vi.waitFor(() => expect(onCannotStart).toHaveBeenCalledTimes(1));
    expect(build).not.toHaveBeenCalled();
  });

  it("builds nothing when the effect is torn down before MapLibre arrives", async () => {
    const { startMap } = await engineModule();
    const build = vi.fn(() => () => undefined);
    const stop = startMap({ kind: "maplibre", styleUrl: STYLE }, await fakeMapbox(), build, vi.fn());
    stop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(build).not.toHaveBeenCalled();
  });
});

describe("labelFontsFor", () => {
  it("uses Mapbox's fonts, the style's own fonts, or none for a style without glyphs", async () => {
    const { labelFontsFor } = await engineModule();
    const map = new FakeMapboxMap({});
    expect(labelFontsFor({ kind: "mapbox", token: "pk.a" }, map as never, ["DIN Pro Medium"])).toEqual(["DIN Pro Medium"]);
    const libre: MapEngine = { kind: "maplibre", styleUrl: STYLE };
    map.getStyle = () => ({ glyphs: "https://x/{fontstack}/{range}.pbf", layers: [{ id: "a", layout: { "text-font": ["Noto Sans Bold"] } }] }) as never;
    expect(labelFontsFor(libre, map as never, ["DIN Pro Medium"])).toEqual(["Noto Sans Bold"]);
    map.getStyle = () => ({ layers: [] }) as never;
    expect(labelFontsFor(libre, map as never, ["DIN Pro Medium"])).toBeNull();
  });
});
