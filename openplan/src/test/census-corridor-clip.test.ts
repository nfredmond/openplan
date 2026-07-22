import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonWithRetryMock = vi.fn();

vi.mock("@/lib/data-sources/http", () => ({
  fetchJsonWithRetry: (...args: unknown[]) => fetchJsonWithRetryMock(...args),
}));

import { fetchCensusForCorridor } from "@/lib/data-sources/census";

// A right triangle: its bbox is the enclosing square, so a point can sit inside
// the bbox but OUTSIDE the polygon — that's what exercises the corridor clip
// (vs a mere bbox filter).
const TRIANGLE = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-121.8, 38.53],
      [-121.68, 38.53],
      [-121.8, 38.58],
      [-121.8, 38.53],
    ],
  ],
};

// TIGERweb layer-8 features (12-digit block-group GEOIDs → truncate to 11).
// A + B centroids are inside the triangle; D is inside the bbox but outside it.
const TIGER_FEATURES = {
  features: [
    { attributes: { GEOID: "061130001001", CENTLAT: "+38.54", CENTLON: "-121.78" } }, // A inside
    { attributes: { GEOID: "061130002001", CENTLAT: "+38.56", CENTLON: "-121.79" } }, // B inside
    { attributes: { GEOID: "061130003001", CENTLAT: "+38.57", CENTLON: "-121.70" } }, // D outside triangle
  ],
};

// ACS county fetch returns all three tracts (A, B, D).
const ACS_ROWS = [
  ["NAME", "B01003_001E", "state", "county", "tract"],
  ["Tract A", "1000", "06", "113", "000100"],
  ["Tract B", "2000", "06", "113", "000200"],
  ["Tract D", "3000", "06", "113", "000300"],
];

function routeFetch(tigerResponse: unknown) {
  fetchJsonWithRetryMock.mockImplementation((url: string) => {
    if (url.includes("geo.fcc.gov")) return Promise.resolve({ Block: { FIPS: "061130001001000" } });
    if (url.includes("tigerweb.geo.census.gov")) return Promise.resolve(tigerResponse);
    if (url.includes("api.census.gov")) return Promise.resolve(ACS_ROWS);
    return Promise.resolve(null);
  });
}

describe("fetchCensusForCorridor — corridor clip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps only tracts whose centroid falls inside the drawn corridor", async () => {
    routeFetch(TIGER_FEATURES);
    const summary = await fetchCensusForCorridor(TRIANGLE);

    // D (in-bbox but outside the triangle) is dropped; A + B remain.
    const geoids = summary.tracts.map((t) => t.geoid).sort();
    expect(geoids).toEqual(["06113000100", "06113000200"]);
    // Population denominator is corridor-scale (1000 + 2000), not county-scale (6000).
    expect(summary.totalPopulation).toBe(3000);
  });

  it("falls back to the unclipped county set when TIGERweb fails (never errors a run)", async () => {
    routeFetch({ error: { message: "TIGERweb down" } });
    const summary = await fetchCensusForCorridor(TRIANGLE);

    expect(summary.tracts).toHaveLength(3);
    expect(summary.totalPopulation).toBe(6000);
  });

  it("falls back to the unclipped set when the clip matches no tract (sub-tract corridor)", async () => {
    // All centroids far outside the corridor → empty clip.
    routeFetch({
      features: [
        { attributes: { GEOID: "061130001001", CENTLAT: "+39.90", CENTLON: "-120.00" } },
        { attributes: { GEOID: "061130002001", CENTLAT: "+39.91", CENTLON: "-120.01" } },
      ],
    });
    const summary = await fetchCensusForCorridor(TRIANGLE);

    expect(summary.tracts).toHaveLength(3);
    expect(summary.totalPopulation).toBe(6000);
  });
});
