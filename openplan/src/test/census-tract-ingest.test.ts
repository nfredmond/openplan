import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchCountyTractGeometry,
  ingestCensusTractsForCounty,
  toMultiPolygonGeoJson,
} from "@/lib/data-sources/census-tract-ingest";
import { __clearFetchJsonResponseCacheForTests } from "@/lib/data-sources/http";

describe("toMultiPolygonGeoJson", () => {
  it("wraps a Polygon so the MultiPolygon-typed column accepts it", () => {
    // The RPC casts to geometry(MultiPolygon,4326) and rejects a bare Polygon,
    // so a county of single-polygon tracts would otherwise fail to ingest.
    const polygon: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [[[-83, 39], [-82, 39], [-82, 40], [-83, 40], [-83, 39]]],
    };
    const result = toMultiPolygonGeoJson(polygon);
    expect(result).toEqual({ type: "MultiPolygon", coordinates: [polygon.coordinates] });
  });

  it("passes a MultiPolygon through unchanged", () => {
    const mp: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [[[[-83, 39], [-82, 39], [-82, 40], [-83, 39]]]],
    };
    expect(toMultiPolygonGeoJson(mp)).toBe(mp);
  });

  it("returns null for a geometry that is not an area", () => {
    expect(toMultiPolygonGeoJson({ type: "Point", coordinates: [-83, 39] })).toBeNull();
  });
});

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function tigerFeature(geoid: string) {
  return {
    properties: { GEOID: geoid, NAME: `Tract ${geoid}`, BASENAME: geoid },
    geometry: { type: "Polygon", coordinates: [[[-83, 39], [-82, 39], [-82, 40], [-83, 40], [-83, 39]]] },
  };
}

/** Census ACS returns a header row + data rows keyed by position. */
function acsRows(geoids: Array<{ state: string; county: string; tract: string }>) {
  const header = [
    "NAME",
    "B01003_001E",
    "B19013_001E",
    "B08301_001E",
    "B08301_010E",
    "B08301_019E",
    "B08301_018E",
    "B08301_021E",
    "B25044_001E",
    "B25044_003E",
    "B25044_010E",
    "B03002_001E",
    "B03002_003E",
    "B17001_001E",
    "B17001_002E",
    "state",
    "county",
    "tract",
  ];
  const rows = geoids.map((g) => [
    "Tract",
    "1000", // pop
    "60000", // income
    "500", // commuters
    "10", // transit
    "5", // walk
    "3", // bike
    "2", // wfh
    "400", // households
    "20", // zero-veh owner
    "10", // zero-veh renter
    "1000", // race total
    "700", // white non-hisp
    "900", // poverty total
    "180", // below poverty
    g.state,
    g.county,
    g.tract,
  ]);
  return [header, ...rows];
}

describe("fetchCountyTractGeometry", () => {
  beforeEach(() => __clearFetchJsonResponseCacheForTests());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    __clearFetchJsonResponseCacheForTests();
  });

  it("queries TIGERweb by the county's own STATE/COUNTY, not a bbox", async () => {
    const fetchMock = vi.fn(async (_url: unknown) =>
      jsonResponse({ features: [tigerFeature("39049001100")], exceededTransferLimit: false })
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const tracts = await fetchCountyTractGeometry({ stateFips: "39", countyFips: "049" });
    expect(tracts).toHaveLength(1);
    expect(tracts[0].geoid).toBe("39049001100");

    // URLSearchParams encodes spaces as "+"; normalize before asserting.
    const url = decodeURIComponent(String(fetchMock.mock.calls[0]![0])).replace(/\+/g, " ");
    expect(url).toContain("STATE='39' AND COUNTY='049'");
    expect(url).not.toContain("esriGeometryEnvelope");
  });

  it("pages until the transfer limit is not exceeded", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => tigerFeature(`39049${String(i).padStart(6, "0")}`));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ features: page, exceededTransferLimit: true }))
      .mockResolvedValueOnce(jsonResponse({ features: [tigerFeature("39049999999")], exceededTransferLimit: false }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const tracts = await fetchCountyTractGeometry({ stateFips: "39", countyFips: "049" });
    expect(tracts).toHaveLength(1001);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("ingestCensusTractsForCounty", () => {
  beforeEach(() => __clearFetchJsonResponseCacheForTests());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    __clearFetchJsonResponseCacheForTests();
  });

  function fakeService(
    rpc: ReturnType<typeof vi.fn> = vi.fn(
      async (_name: string, _params: Record<string, unknown>) => ({ error: null })
    )
  ) {
    return { rpc } as unknown as Parameters<typeof ingestCensusTractsForCounty>[0] & { rpc: typeof rpc };
  }

  function stubFetch(tiger: unknown, acs: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        return url.includes("tigerweb") ? jsonResponse(tiger) : jsonResponse(acs);
      }) as unknown as typeof fetch
    );
  }

  it("rejects a malformed county reference without any fetch", async () => {
    const service = fakeService();
    const result = await ingestCensusTractsForCounty(service, { stateFips: "6", countyFips: "57" });
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/Invalid county/i);
    expect(service.rpc).not.toHaveBeenCalled();
  });

  it("joins geometry to ACS and upserts each tract with raw counts", async () => {
    stubFetch(
      { features: [tigerFeature("39049001100")], exceededTransferLimit: false },
      acsRows([{ state: "39", county: "049", tract: "001100" }])
    );
    const service = fakeService();

    const result = await ingestCensusTractsForCounty(service, { stateFips: "39", countyFips: "049" });

    expect(result.status).toBe("ingested");
    expect(result.tractsUpserted).toBe(1);
    const args = service.rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.p_geoid).toBe("39049001100");
    // Raw counts, not percentages — the table stores counts.
    expect(args.p_pop_white).toBe(700);
    expect(args.p_pop_below_poverty).toBe(180);
    expect((args.p_geometry_geojson as { type: string }).type).toBe("MultiPolygon");
  });

  it("reports no_tracts distinctly from no_demographics", async () => {
    stubFetch({ features: [], exceededTransferLimit: false }, acsRows([]));
    expect((await ingestCensusTractsForCounty(fakeService(), { stateFips: "39", countyFips: "049" })).status).toBe(
      "no_tracts"
    );

    // Clear the shared response cache so the second phase's geometry/ACS are
    // fetched fresh rather than returning the first phase's cached responses.
    __clearFetchJsonResponseCacheForTests();
    stubFetch({ features: [tigerFeature("39049001100")], exceededTransferLimit: false }, [["NAME", "state", "county", "tract"]]);
    expect((await ingestCensusTractsForCounty(fakeService(), { stateFips: "39", countyFips: "049" })).status).toBe(
      "no_demographics"
    );
  });

  it("counts unmatched tracts instead of writing them half-formed", async () => {
    // Geometry for a tract with no ACS row must not be stored with null demographics.
    stubFetch(
      { features: [tigerFeature("39049001100"), tigerFeature("39049999999")], exceededTransferLimit: false },
      acsRows([{ state: "39", county: "049", tract: "001100" }])
    );
    const service = fakeService();
    const result = await ingestCensusTractsForCounty(service, { stateFips: "39", countyFips: "049" });
    expect(result.tractsUpserted).toBe(1);
    expect(result.unmatched).toBe(1);
    expect(service.rpc).toHaveBeenCalledTimes(1);
  });

  it("surfaces an upsert failure rather than reporting success", async () => {
    stubFetch(
      { features: [tigerFeature("39049001100")], exceededTransferLimit: false },
      acsRows([{ state: "39", county: "049", tract: "001100" }])
    );
    const service = fakeService(vi.fn(async () => ({ error: { message: "geom invalid" } })));
    const result = await ingestCensusTractsForCounty(service, { stateFips: "39", countyFips: "049" });
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/geom invalid/);
  });
});
