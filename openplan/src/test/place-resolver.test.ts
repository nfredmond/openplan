import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonWithRetryMock = vi.fn();
const searchUsCountiesMock = vi.fn();

vi.mock("@/lib/data-sources/http", () => ({
  fetchJsonWithRetry: (...args: unknown[]) => fetchJsonWithRetryMock(...args),
}));

vi.mock("@/lib/geographies/us-counties", () => ({
  searchUsCounties: (...args: unknown[]) => searchUsCountiesMock(...args),
}));

import {
  buildPlaceBoundaryUrl,
  buildPlaceSearchUrl,
  extractCorridorFromGeojson,
  parsePlaceSearchResponse,
  resolvePlaceBoundary,
  sanitizeLikeQuery,
  scorePlaceMatch,
  searchPlaces,
} from "@/lib/geographies/place-resolver";

const DAVIS_POLYGON = {
  type: "Polygon",
  coordinates: [
    [
      [-121.8, 38.5],
      [-121.8, 38.6],
      [-121.7, 38.6],
      [-121.7, 38.5],
      [-121.8, 38.5],
    ],
  ],
};

describe("sanitizeLikeQuery", () => {
  it("escapes single quotes by doubling them (safe for O'Fallon)", () => {
    expect(sanitizeLikeQuery("O'Fallon")).toBe("O''Fallon");
  });

  it("strips LIKE wildcards and SQL-punctuation so injection is impossible", () => {
    expect(sanitizeLikeQuery("a%b_c")).toBe("a b c");
    expect(sanitizeLikeQuery("Reno; SELECT")).toBe("Reno SELECT");
  });

  it("collapses whitespace and caps length at 40 chars", () => {
    expect(sanitizeLikeQuery("  many   spaces  ")).toBe("many spaces");
    expect(sanitizeLikeQuery("x".repeat(60))).toHaveLength(40);
  });
});

describe("buildPlaceSearchUrl", () => {
  it("targets the layer, requests attributes only, and includes STATE when present", () => {
    const url = buildPlaceSearchUrl(28, "Davis", 8, true);
    expect(url).toContain("/28/query?");
    expect(url).toContain("returnGeometry=false");
    expect(url).toContain("f=json");
    // URLSearchParams encodes spaces as "+"; normalize before matching.
    const decoded = decodeURIComponent(url).replace(/\+/g, " ");
    expect(decoded).toContain("UPPER(BASENAME) LIKE UPPER('Davis%')");
    expect(decoded).toContain("GEOID,NAME,BASENAME,STATE");
  });

  it("omits STATE for CBSA layers that lack the field", () => {
    const url = buildPlaceSearchUrl(93, "Reno", 5, false);
    expect(decodeURIComponent(url)).toContain("GEOID,NAME,BASENAME");
    expect(decodeURIComponent(url)).not.toContain("BASENAME,STATE");
  });
});

describe("buildPlaceBoundaryUrl", () => {
  it("requests generalized WGS84 GeoJSON geometry for one GEOID", () => {
    const url = buildPlaceBoundaryUrl(82, "06113");
    expect(url).toContain("/82/query?");
    expect(url).toContain("f=geojson");
    expect(url).toContain("outSR=4326");
    expect(url).toContain("geometryPrecision=4");
    expect(url).toContain("returnGeometry=true");
    expect(decodeURIComponent(url)).toContain("GEOID='06113'");
  });
});

describe("parsePlaceSearchResponse", () => {
  it("labels an incorporated place with its state postal code", () => {
    const results = parsePlaceSearchResponse(
      { features: [{ attributes: { GEOID: "0618100", NAME: "Davis city", BASENAME: "Davis", STATE: "06" } }] },
      "city",
    );
    expect(results).toEqual([
      { kind: "city", geoid: "0618100", label: "Davis, CA", description: "City / town", stateFips: "06", sortKey: "davis" },
    ]);
  });

  it("uses the fully-formed NAME for a CBSA and no state", () => {
    const results = parsePlaceSearchResponse(
      { features: [{ attributes: { GEOID: "39900", NAME: "Reno, NV Metro Area", BASENAME: "Reno, NV" } }] },
      "metro",
    );
    expect(results[0]).toMatchObject({ kind: "metro", geoid: "39900", label: "Reno, NV Metro Area", stateFips: null });
  });

  it("drops features missing a GEOID or a name, and tolerates a null payload", () => {
    expect(parsePlaceSearchResponse({ features: [{ attributes: { NAME: "x" } }] }, "city")).toEqual([]);
    expect(parsePlaceSearchResponse(null, "city")).toEqual([]);
  });
});

describe("scorePlaceMatch", () => {
  it("ranks exact > prefix > substring > server-only match, and zero for empty query", () => {
    expect(scorePlaceMatch("davis", "davis")).toBe(1000);
    expect(scorePlaceMatch("davisville", "davis")).toBe(800);
    expect(scorePlaceMatch("north davis", "davis")).toBe(400);
    expect(scorePlaceMatch("somethingelse", "davis")).toBe(100);
    expect(scorePlaceMatch("davis", "")).toBe(0);
  });
});

describe("extractCorridorFromGeojson", () => {
  it("returns a valid polygon geometry from the first feature", () => {
    expect(
      extractCorridorFromGeojson({ type: "FeatureCollection", features: [{ type: "Feature", geometry: DAVIS_POLYGON }] }),
    ).toEqual(DAVIS_POLYGON);
  });

  it("returns null for non-polygon or empty geometry", () => {
    expect(
      extractCorridorFromGeojson({ features: [{ geometry: { type: "Point", coordinates: [0, 0] } }] }),
    ).toBeNull();
    expect(extractCorridorFromGeojson({ features: [] })).toBeNull();
    expect(extractCorridorFromGeojson(null)).toBeNull();
  });
});

describe("resolvePlaceBoundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the boundary by GEOID and returns geometry plus a bbox", async () => {
    fetchJsonWithRetryMock.mockResolvedValue({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: DAVIS_POLYGON, properties: { GEOID: "0618100", BASENAME: "Davis" } }],
    });

    const resolved = await resolvePlaceBoundary("city", "0618100");
    expect(fetchJsonWithRetryMock).toHaveBeenCalledOnce();
    expect(String(fetchJsonWithRetryMock.mock.calls[0][0])).toContain("/28/query");
    expect(resolved?.geojson).toEqual(DAVIS_POLYGON);
    expect(resolved?.bbox).toEqual({ minLon: -121.8, minLat: 38.5, maxLon: -121.7, maxLat: 38.6 });
  });

  it("rejects a GEOID whose length is wrong for its kind without any network call", async () => {
    const resolved = await resolvePlaceBoundary("city", "06057"); // 5 digits, but a place needs 7
    expect(resolved).toBeNull();
    expect(fetchJsonWithRetryMock).not.toHaveBeenCalled();
  });

  it("returns null when the boundary lookup finds nothing", async () => {
    fetchJsonWithRetryMock.mockResolvedValue({ type: "FeatureCollection", features: [] });
    expect(await resolvePlaceBoundary("county", "06113")).toBeNull();
  });
});

const YOLO_COUNTY = {
  geographyId: "06113",
  geographyLabel: "Yolo County, CA",
  countyPrefix: "YOLO",
  countySlug: "yolo-06113",
  suggestedRunName: "yolo-06113-runtime",
};

/** An available county catalog that matched the query. */
function countiesAnswered(items: Array<typeof YOLO_COUNTY> = [YOLO_COUNTY]) {
  return { items, availability: "ok" as const, unavailableReason: null };
}

describe("searchPlaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("short-circuits queries under two characters without any lookup", async () => {
    const outcome = await searchPlaces("d");
    expect(outcome.items).toEqual([]);
    expect(outcome.searchUnavailable).toBe(false);
    expect(fetchJsonWithRetryMock).not.toHaveBeenCalled();
    expect(searchUsCountiesMock).not.toHaveBeenCalled();
  });

  it("merges counties, places, and metros into one ranked, de-duplicated list", async () => {
    searchUsCountiesMock.mockResolvedValue(countiesAnswered());
    fetchJsonWithRetryMock.mockImplementation((url: string) => {
      if (url.includes("/28/")) {
        return Promise.resolve({ features: [{ attributes: { GEOID: "0618100", NAME: "Davis city", BASENAME: "Davis", STATE: "06" } }] });
      }
      if (url.includes("/93/")) {
        return Promise.resolve({ features: [{ attributes: { GEOID: "40900", NAME: "Sacramento, CA Metro Area", BASENAME: "Sacramento, CA" } }] });
      }
      return Promise.resolve({ features: [] });
    });

    const outcome = await searchPlaces("davis");
    // Exact base-name match ("davis") ranks first.
    expect(outcome.items[0]).toMatchObject({ kind: "city", geoid: "0618100", label: "Davis, CA" });
    const labels = outcome.items.map((r) => r.label);
    expect(labels).toContain("Yolo County, CA");
    expect(labels).toContain("Sacramento, CA Metro Area");
    // Everything answered, so an empty result would genuinely mean "no match".
    expect(outcome.unavailableKinds).toEqual([]);
    expect(outcome.searchUnavailable).toBe(false);
    expect(outcome.unavailableReason).toBeNull();
  });

  /**
   * The defect this contract exists to prevent: every lookup failing produced
   * an empty list, which the picker rendered as "No matching places. Try a
   * different spelling" — telling a planner their own county does not exist.
   */
  it("reports a total lookup failure as unavailable, never as an empty result", async () => {
    searchUsCountiesMock.mockResolvedValue({
      items: [],
      availability: "unavailable",
      unavailableReason: "County search needs a US Census API key, which this deployment has not configured.",
    });
    // fetchJsonWithRetry answers null for a timeout, a non-OK status, or a body
    // that would not parse — it does not throw, which is how this stayed hidden.
    fetchJsonWithRetryMock.mockResolvedValue(null);

    const outcome = await searchPlaces("franklin");

    expect(outcome.items).toEqual([]);
    expect(outcome.searchUnavailable).toBe(true);
    expect(outcome.unavailableKinds).toEqual(expect.arrayContaining(["county", "city", "cdp", "metro", "micro"]));
    // The knowable, actionable cause wins over a generic outage message.
    expect(outcome.unavailableReason).toMatch(/Census API key/i);
  });

  it("treats a 200 that carries no features array as an unanswered layer", async () => {
    searchUsCountiesMock.mockResolvedValue(countiesAnswered());
    // ArcGIS reports a rejected query with a 200 and an `error` object.
    fetchJsonWithRetryMock.mockResolvedValue({ error: { code: 400, message: "Invalid query" } });

    const outcome = await searchPlaces("davis");

    expect(outcome.searchUnavailable).toBe(false);
    expect(outcome.unavailableKinds).toEqual(["city", "cdp", "metro", "micro"]);
    expect(outcome.unavailableReason).not.toBeNull();
    // The county layer still answered, so its result is still returned.
    expect(outcome.items.map((item) => item.label)).toContain("Yolo County, CA");
  });

  it("marks only the county layer unavailable when the catalog is the thing that failed", async () => {
    searchUsCountiesMock.mockResolvedValue({
      items: [],
      availability: "unavailable",
      unavailableReason: "The US Census county catalog did not respond, so county names could not be searched.",
    });
    fetchJsonWithRetryMock.mockImplementation((url: string) =>
      url.includes("/28/")
        ? Promise.resolve({ features: [{ attributes: { GEOID: "0618100", NAME: "Davis city", BASENAME: "Davis", STATE: "06" } }] })
        : Promise.resolve({ features: [] }),
    );

    const outcome = await searchPlaces("davis");

    expect(outcome.searchUnavailable).toBe(false);
    expect(outcome.unavailableKinds).toEqual(["county"]);
    expect(outcome.items.map((item) => item.kind)).toContain("city");
  });
});
