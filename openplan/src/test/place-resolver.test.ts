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
  buildPlacePopulationUrl,
  buildPlaceSearchUrl,
  extractCorridorFromGeojson,
  parsePlacePopulationResponse,
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
    const url = buildPlaceSearchUrl({ layerId: 28, sanitizedLike: "Davis", limit: 8, hasStateField: true });
    expect(url).toContain("/28/query?");
    expect(url).toContain("returnGeometry=false");
    expect(url).toContain("f=json");
    // URLSearchParams encodes spaces as "+"; normalize before matching.
    const decoded = decodeURIComponent(url).replace(/\+/g, " ");
    expect(decoded).toContain("UPPER(BASENAME) LIKE UPPER('Davis%')");
    expect(decoded).toContain("GEOID,NAME,BASENAME,STATE");
  });

  it("omits STATE for CBSA layers that lack the field", () => {
    const url = buildPlaceSearchUrl({ layerId: 93, sanitizedLike: "Reno", limit: 5, hasStateField: false });
    expect(decodeURIComponent(url)).toContain("GEOID,NAME,BASENAME");
    expect(decodeURIComponent(url)).not.toContain("BASENAME,STATE");
  });

  it("adds a server-side STATE filter when the query named a state", () => {
    const url = buildPlaceSearchUrl({
      layerId: 28,
      sanitizedLike: "Columbus",
      limit: 8,
      hasStateField: true,
      stateFips: "39",
    });
    const decoded = decodeURIComponent(url).replace(/\+/g, " ");
    expect(decoded).toContain("UPPER(BASENAME) LIKE UPPER('Columbus%') AND STATE='39'");
  });

  it("never filters a CBSA layer by state — a metro area legitimately spans states", () => {
    const url = buildPlaceSearchUrl({
      layerId: 93,
      sanitizedLike: "Columbus",
      limit: 8,
      hasStateField: false,
      stateFips: "39",
    });
    expect(decodeURIComponent(url)).not.toContain("STATE=");
  });

  it("refuses a non-FIPS state filter rather than interpolating it", () => {
    const url = buildPlaceSearchUrl({
      layerId: 28,
      sanitizedLike: "Columbus",
      limit: 8,
      hasStateField: true,
      stateFips: "39' OR '1'='1",
    });
    expect(decodeURIComponent(url)).not.toContain("OR '1'='1");
    expect(decodeURIComponent(url)).not.toContain("STATE=");
  });
});

describe("buildPlacePopulationUrl", () => {
  it("queries the 2020 vintage for GEOID and POP100 only, largest first", () => {
    const url = buildPlacePopulationUrl(26, "Springfield", 40);
    expect(url).toContain("tigerWMS_Census2020");
    expect(url).toContain("/26/query?");
    const decoded = decodeURIComponent(url).replace(/\+/g, " ");
    expect(decoded).toContain("UPPER(BASENAME) LIKE UPPER('Springfield%')");
    expect(decoded).toContain("GEOID,POP100");
    expect(decoded).toContain("POP100 DESC");
  });

  it("is a join table, not a source of truth: it never asks for geometry or names", () => {
    const decoded = decodeURIComponent(buildPlacePopulationUrl(26, "Springfield", 40));
    expect(decoded).toContain("returnGeometry=false");
    expect(decoded).not.toContain("BASENAME,");
  });
});

describe("parsePlacePopulationResponse", () => {
  it("maps GEOID to population", () => {
    const populations = parsePlacePopulationResponse({
      features: [
        { attributes: { GEOID: "2970000", POP100: 169176 } },
        { attributes: { GEOID: "2567000", POP100: 155929 } },
      ],
    });
    expect(populations.get("2970000")).toBe(169176);
    expect(populations.get("2567000")).toBe(155929);
  });

  it("omits unknown populations instead of recording them as zero", () => {
    const populations = parsePlacePopulationResponse({
      features: [
        { attributes: { GEOID: "1", POP100: null } },
        { attributes: { GEOID: "2", POP100: -666666666 } },
        { attributes: { GEOID: "3" } },
        { attributes: { POP100: 500 } },
      ],
    });
    expect(populations.size).toBe(0);
  });

  it("tolerates a null payload — a missing companion layer is not a failure", () => {
    expect(parsePlacePopulationResponse(null).size).toBe(0);
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
      {
        kind: "city",
        geoid: "0618100",
        label: "Davis, CA",
        description: "City / town",
        stateFips: "06",
        sortKey: "davis",
        population: null,
      },
    ]);
  });

  it("joins population in by GEOID when the companion layer supplied it", () => {
    const results = parsePlaceSearchResponse(
      { features: [{ attributes: { GEOID: "0618100", NAME: "Davis city", BASENAME: "Davis", STATE: "06" } }] },
      "city",
      new Map([["0618100", 66850]]),
    );
    expect(results[0].population).toBe(66850);
  });

  it("leaves population null for a GEOID the 2020 vintage never knew about", () => {
    const results = parsePlaceSearchResponse(
      { features: [{ attributes: { GEOID: "9999999", NAME: "Newtown city", BASENAME: "Newtown", STATE: "06" } }] },
      "city",
      new Map([["0618100", 66850]]),
    );
    expect(results[0].population).toBeNull();
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
  population: 216403,
};

/**
 * Route a mocked TIGERweb request by service AND layer. The two services reuse
 * layer numbers — `/28/` is incorporated places on Current and CDPs on
 * Census2020 — so matching on the layer alone silently crosses the wires.
 */
function tigerRoute(url: string): { service: "current" | "population"; layer: string } {
  const service = url.includes("tigerWMS_Census2020") ? "population" : "current";
  const layer = /\/MapServer\/(\d+)\/query/.exec(url)?.[1] ?? "";
  return { service, layer };
}

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
      const { service, layer } = tigerRoute(url);
      if (service === "current" && layer === "28") {
        return Promise.resolve({ features: [{ attributes: { GEOID: "0618100", NAME: "Davis city", BASENAME: "Davis", STATE: "06" } }] });
      }
      if (service === "current" && layer === "93") {
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
    fetchJsonWithRetryMock.mockImplementation((url: string) => {
      const { service, layer } = tigerRoute(url);
      return service === "current" && layer === "28"
        ? Promise.resolve({ features: [{ attributes: { GEOID: "0618100", NAME: "Davis city", BASENAME: "Davis", STATE: "06" } }] })
        : Promise.resolve({ features: [] });
    });

    const outcome = await searchPlaces("davis");

    expect(outcome.searchUnavailable).toBe(false);
    expect(outcome.unavailableKinds).toEqual(["county"]);
    expect(outcome.items.map((item) => item.kind)).toContain("city");
  });
});

/**
 * The reported defect, at the layer where it is now fixed for everything that
 * is not a county: several places share a name, they all match equally well,
 * and the alphabetically-first one is not the one anybody meant.
 */
describe("searchPlaces — ranking same-named places", () => {
  const SPRINGFIELDS = [
    { GEOID: "1772000", NAME: "Springfield city", BASENAME: "Springfield", STATE: "17" }, // IL
    { GEOID: "2567000", NAME: "Springfield city", BASENAME: "Springfield", STATE: "25" }, // MA
    { GEOID: "2970000", NAME: "Springfield city", BASENAME: "Springfield", STATE: "29" }, // MO
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    searchUsCountiesMock.mockResolvedValue({ items: [], availability: "ok", unavailableReason: null });
  });

  it("puts the largest same-named place first instead of the alphabetically-first state", async () => {
    fetchJsonWithRetryMock.mockImplementation((url: string) => {
      const { service, layer } = tigerRoute(url);
      if (service === "current" && layer === "28") {
        return Promise.resolve({ features: SPRINGFIELDS.map((attributes) => ({ attributes })) });
      }
      if (service === "population" && layer === "26") {
        return Promise.resolve({
          features: [
            { attributes: { GEOID: "2970000", POP100: 169176 } },
            { attributes: { GEOID: "2567000", POP100: 155929 } },
            { attributes: { GEOID: "1772000", POP100: 114394 } },
          ],
        });
      }
      return Promise.resolve({ features: [] });
    });

    const outcome = await searchPlaces("Springfield");

    // Alphabetically this order would be IL, MA, MO — the old behavior.
    expect(outcome.items.map((item) => item.label)).toEqual([
      "Springfield, MO",
      "Springfield, MA",
      "Springfield, IL",
    ]);
  });

  it("falls back to alphabetical when the population layer answers nothing", async () => {
    fetchJsonWithRetryMock.mockImplementation((url: string) => {
      const { service, layer } = tigerRoute(url);
      if (service === "current" && layer === "28") {
        return Promise.resolve({ features: SPRINGFIELDS.map((attributes) => ({ attributes })) });
      }
      return Promise.resolve(service === "population" ? null : { features: [] });
    });

    const outcome = await searchPlaces("Springfield");

    // Degraded ORDER, not degraded RESULTS: all three are still returned, and
    // the search is not reported as unavailable.
    expect(outcome.items.map((item) => item.label)).toEqual([
      "Springfield, IL",
      "Springfield, MA",
      "Springfield, MO",
    ]);
    // And the population outage is invisible in the coverage report, by design:
    // population is a ranking refinement, so losing it must never make the
    // search claim a place kind could not be searched.
    expect(outcome.unavailableKinds).toEqual([]);
    expect(outcome.searchUnavailable).toBe(false);
  });

  it("never lets population promote a weaker name match over a stronger one", async () => {
    fetchJsonWithRetryMock.mockImplementation((url: string) => {
      const { service, layer } = tigerRoute(url);
      if (service === "current" && layer === "28") {
        return Promise.resolve({
          features: [
            // A huge place that merely starts with the query...
            { attributes: { GEOID: "1111111", NAME: "Springfield Gardens", BASENAME: "Springfield Gardens", STATE: "36" } },
            // ...and a tiny one that matches it exactly.
            { attributes: { GEOID: "2222222", NAME: "Springfield village", BASENAME: "Springfield", STATE: "50" } },
          ],
        });
      }
      if (service === "population" && layer === "26") {
        return Promise.resolve({
          features: [
            { attributes: { GEOID: "1111111", POP100: 900000 } },
            { attributes: { GEOID: "2222222", POP100: 500 } },
          ],
        });
      }
      return Promise.resolve({ features: [] });
    });

    const outcome = await searchPlaces("Springfield");
    expect(outcome.items[0].geoid).toBe("2222222");
  });

  it("narrows to the named state and unbreaks the metro form that matched nothing", async () => {
    fetchJsonWithRetryMock.mockImplementation((url: string) => {
      const { service, layer } = tigerRoute(url);
      const decoded = decodeURIComponent(url).replace(/\+/g, " ");
      if (service === "current" && layer === "28") {
        // The route only answers if the state filter was actually applied.
        return Promise.resolve(
          decoded.includes("STATE='39'")
            ? { features: [{ attributes: { GEOID: "3918000", NAME: "Columbus city", BASENAME: "Columbus", STATE: "39" } }] }
            : { features: [] },
        );
      }
      if (service === "current" && layer === "93") {
        // TIGERweb CBSA BASENAMEs carry the state: "Columbus, OH". The old code
        // rewrote the comma to a space and searched `LIKE 'COLUMBUS OH%'`,
        // which matched nothing at all.
        return Promise.resolve(
          decoded.includes("UPPER('Columbus%')")
            ? { features: [{ attributes: { GEOID: "18140", NAME: "Columbus, OH Metro Area", BASENAME: "Columbus, OH" } }] }
            : { features: [] },
        );
      }
      return Promise.resolve({ features: [] });
    });

    const outcome = await searchPlaces("Columbus, OH");
    const labels = outcome.items.map((item) => item.label);

    // The metro area is the one that returned nothing at all before this fix.
    expect(labels).toContain("Columbus, OH Metro Area");
    // The city of Columbus, Ohio is what someone typing "Columbus, OH" means,
    // and it leads: both score an exact match against the form that matches
    // their own label convention, and the tie breaks on the shorter label.
    expect(labels[0]).toBe("Columbus, OH");
  });

  it("leaves a trailing fragment alone when it names no state", async () => {
    fetchJsonWithRetryMock.mockImplementation((url: string) => {
      const decoded = decodeURIComponent(url).replace(/\+/g, " ");
      // "Lake, Charles" must keep searching for that whole text, not silently
      // become a search for "Lake".
      expect(decoded).not.toContain("UPPER('Lake%')");
      expect(decoded).not.toContain("STATE=");
      return Promise.resolve({ features: [] });
    });

    await searchPlaces("Lake, Charles");
    expect(fetchJsonWithRetryMock).toHaveBeenCalled();
  });
});

/**
 * The comma-less form, which is how people actually type a place.
 *
 * Found by driving the study-area picker as a first-time planner: "Reno NV",
 * "Austin TX" and "Columbus OH" each returned an empty list, because
 * `splitStateQualifier` reads only ", XX" and the query reached TIGERweb as
 * `LIKE 'RENO NV%'`. The picker rendered that as "no matching places" for
 * cities that plainly exist — the study-area front door denying a real US
 * geography, which is the failure this product forbids above all others.
 *
 * The retry is deliberately narrow, and the second test is the load-bearing
 * one: a space is not a separator, so this may only fire when the literal
 * query found NOTHING.
 */
describe("searchPlaces — a state written without a comma", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchUsCountiesMock.mockResolvedValue({ items: [], availability: "ok" as const, unavailableReason: null });
  });

  /** Answers the incorporated-place layer only when scoped to `stateFips`. */
  function onlyWhenScopedTo(stateFips: string, feature: Record<string, unknown>) {
    return (url: string) => {
      const { service, layer } = tigerRoute(url);
      const decoded = decodeURIComponent(url).replace(/\+/g, " ");
      if (service === "current" && layer === "28" && decoded.includes(`STATE='${stateFips}'`)) {
        return Promise.resolve({ features: [{ attributes: feature }] });
      }
      return Promise.resolve({ features: [] });
    };
  }

  it("finds the city when the state is written with a space instead of a comma", async () => {
    fetchJsonWithRetryMock.mockImplementation(
      onlyWhenScopedTo("32", { GEOID: "3260600", NAME: "Reno city", BASENAME: "Reno", STATE: "32" }),
    );

    const outcome = await searchPlaces("Reno NV");

    expect(outcome.items.map((item) => item.label)).toContain("Reno, NV");
  });

  it("reads a spelled-out multi-word state", async () => {
    fetchJsonWithRetryMock.mockImplementation(
      onlyWhenScopedTo("35", { GEOID: "3517050", NAME: "Columbus village", BASENAME: "Columbus", STATE: "35" }),
    );

    const outcome = await searchPlaces("Columbus New Mexico");

    expect(outcome.items.map((item) => item.label)).toContain("Columbus, NM");
  });

  /**
   * The discriminating case for trying LONGER tails first, and the reason the
   * loop counts down. "West Virginia" ends in "Virginia", which is itself a
   * state: a shortest-tail-first reading sends someone looking for the capital
   * of West Virginia (FIPS 54) to Virginia (FIPS 51) instead — a wrong answer
   * that looks entirely plausible on screen.
   *
   * A "New Mexico" fixture cannot prove this, because "Mexico" is not a state
   * and both orderings therefore agree. Only a tail whose own last word is a
   * different state can tell the two apart.
   */
  it("prefers the longest state name when its last word is also a state", async () => {
    fetchJsonWithRetryMock.mockImplementation(
      onlyWhenScopedTo("54", { GEOID: "5414600", NAME: "Charleston city", BASENAME: "Charleston", STATE: "54" }),
    );

    const outcome = await searchPlaces("Charleston West Virginia");

    // Scoped to West Virginia (54). Had it read "Virginia" (51), the mock would
    // have answered nothing and this would be an empty list.
    expect(outcome.items.map((item) => item.label)).toEqual(["Charleston, WV"]);
  });

  /**
   * THE GUARD THAT MATTERS. "New Washington" is a real town in Indiana, Ohio
   * and Pennsylvania whose own last word is a state name. If the split were
   * applied eagerly rather than as a zero-result fallback, this query would be
   * rewritten into a search for "New" restricted to Washington State and would
   * return someone else's geography for a search that works correctly today.
   */
  it("never re-reads a query that already found something", async () => {
    const scopedCalls: string[] = [];
    fetchJsonWithRetryMock.mockImplementation((url: string) => {
      const { service, layer } = tigerRoute(url);
      const decoded = decodeURIComponent(url).replace(/\+/g, " ");
      if (decoded.includes("STATE=")) scopedCalls.push(decoded);
      if (service === "current" && layer === "28") {
        return Promise.resolve({
          features: [{ attributes: { GEOID: "1854180", NAME: "New Washington town", BASENAME: "New Washington", STATE: "18" } }],
        });
      }
      return Promise.resolve({ features: [] });
    });

    const outcome = await searchPlaces("New Washington");

    expect(outcome.items.map((item) => item.label)).toEqual(["New Washington, IN"]);
    // No state-scoped retry happened at all: the first search answered.
    expect(scopedCalls).toEqual([]);
  });

  it("still reports a real empty result as empty rather than inventing a state", async () => {
    fetchJsonWithRetryMock.mockResolvedValue({ features: [] });

    const outcome = await searchPlaces("Nowhereville XZ");

    expect(outcome.items).toEqual([]);
    expect(outcome.searchUnavailable).toBe(false);
  });
});
