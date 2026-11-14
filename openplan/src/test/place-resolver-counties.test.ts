/**
 * Counties through the whole place resolver, with no Census API key: search
 * (`searchPlaces` over the real `searchUsCounties`) and the server's
 * re-resolution of a picked county (`resolvePlaceBoundary`, which the
 * home-geography, project and engagement routes call). Responses are TIGERweb
 * captures recorded on 2026-11-01; each fixture carries its capture URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import catalogFixture from "./fixtures/tigerweb/county-catalog-edge-cases.json";
import populationFixture from "./fixtures/tigerweb/county-population-edge-cases.json";
import fallsChurchBoundary from "./fixtures/tigerweb/county-boundary-51610.json";

const fetchJsonWithRetryMock = vi.fn();

vi.mock("@/lib/data-sources/http", () => ({
  fetchJsonWithRetry: (...args: unknown[]) => fetchJsonWithRetryMock(...args),
}));

import { resolvePlaceBoundary, searchPlaces } from "@/lib/geographies/place-resolver";
import { __resetCountyCatalogForTests } from "@/lib/geographies/us-counties";
import { placeBoundaryResponseSchema } from "@/lib/api/place-geographies";
import { homeGeographyFromPlaceBoundary, tigerwebCountyFipsFromHomeGeography } from "@/lib/workspaces/home-geography";

function route(url: string) {
  const parsed = new URL(url);
  return {
    service: url.includes("tigerWMS_Census2020") ? ("population" as const) : ("current" as const),
    layer: /\/MapServer\/(\d+)\/query/.exec(parsed.pathname)?.[1] ?? "",
    where: parsed.searchParams.get("where") ?? "",
    format: parsed.searchParams.get("f"),
  };
}

const EMPTY_QUERY = { features: [] };
const EMPTY_GEOJSON = { type: "FeatureCollection", features: [] };

/**
 * The whole-layer county requests get the recorded catalog and population;
 * every other layer (cities, CDPs, CBSAs, towns, tribal areas) matches nothing.
 */
function answerCountiesOnly() {
  fetchJsonWithRetryMock.mockImplementation((url: string) => {
    const { service, layer, where, format } = route(url);
    if (format === "geojson") {
      return Promise.resolve(layer === "82" && where === "GEOID='51610'" ? fallsChurchBoundary.response : EMPTY_GEOJSON);
    }
    if (layer === "82" && where === "1=1") {
      return Promise.resolve(service === "current" ? catalogFixture.response : populationFixture.response);
    }
    return Promise.resolve(EMPTY_QUERY);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CENSUS_API_KEY", "");
  __resetCountyCatalogForTests();
  answerCountiesOnly();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetCountyCatalogForTests();
});

describe("county search through searchPlaces without a Census key", () => {
  it("answers every kind, counties included, and never calls the Census API", async () => {
    const outcome = await searchPlaces("Orleans Parish");

    expect(outcome.unavailableKinds).toEqual([]);
    expect(outcome.searchUnavailable).toBe(false);
    expect(outcome.unavailableReason).toBeNull();
    expect(outcome.items).toEqual([
      { kind: "county", geoid: "22071", label: "Orleans Parish, LA", description: "County", stateFips: "22" },
    ]);
    for (const [url] of fetchJsonWithRetryMock.mock.calls) {
      expect(new URL(String(url)).host).toBe("tigerweb.geo.census.gov");
    }
  });

  it("narrows a state-qualified county search to that state", async () => {
    const outcome = await searchPlaces("Washington County, PA");
    expect(outcome.items.map((item) => [item.kind, item.geoid, item.label])).toEqual([
      ["county", "42125", "Washington County, PA"],
    ]);
  });

  it("ranks same-named counties by population inside the merged results", async () => {
    const outcome = await searchPlaces("Richmond");
    expect(outcome.items.map((item) => item.label)).toEqual([
      "Richmond city, VA",
      "Richmond County, GA",
      "Richmond County, VA",
    ]);
  });

  it("reports counties unavailable, by name, when the county layer does not answer", async () => {
    fetchJsonWithRetryMock.mockImplementation((url: string) => {
      const { layer, where } = route(url);
      return Promise.resolve(layer === "82" && where === "1=1" ? null : EMPTY_QUERY);
    });

    const outcome = await searchPlaces("Orleans Parish");

    expect(outcome.unavailableKinds).toEqual(["county"]);
    expect(outcome.searchUnavailable).toBe(false);
    expect(outcome.unavailableReason).toMatch(/TIGERweb county layer did not respond/);
    expect(outcome.unavailableReason).not.toMatch(/API key/i);
  });
});

describe("re-resolving a picked county on the server", () => {
  it("fetches the boundary from the Current Counties layer by GEOID and labels it as search does", async () => {
    const boundary = await resolvePlaceBoundary("county", "51610");

    expect(boundary).toMatchObject({ kind: "county", geoid: "51610", label: "Falls Church city, VA" });
    expect(placeBoundaryResponseSchema.safeParse(boundary).success).toBe(true);
    expect(boundary?.bbox.minLon).toBeLessThan(boundary?.bbox.maxLon ?? 0);
    const [call] = fetchJsonWithRetryMock.mock.calls.map(([url]) => route(String(url)));
    expect(call).toMatchObject({ service: "current", layer: "82", where: "GEOID='51610'", format: "geojson" });
    expect(fetchJsonWithRetryMock).toHaveBeenCalledTimes(1);
  });

  it("stores a Virginia independent city as a county-equivalent home geography", async () => {
    const boundary = await resolvePlaceBoundary("county", "51610");
    if (!boundary) throw new Error("fixture did not resolve");
    const row = homeGeographyFromPlaceBoundary(boundary, { setAt: new Date("2026-11-01T00:00:00Z") });

    expect(row).toMatchObject({
      home_geography_kind: "county",
      home_geography_ref: "51610",
      home_geography_label: "Falls Church city, VA",
      home_country_code: "US",
      home_subdivision_code: "VA",
    });
    expect(tigerwebCountyFipsFromHomeGeography(row)).toEqual({ stateFips: "51", countyFips: "610" });
  });

  it("refuses a county GEOID TIGERweb does not hold", async () => {
    expect(await resolvePlaceBoundary("county", "51999")).toBeNull();
  });
});
