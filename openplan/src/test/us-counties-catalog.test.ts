import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import catalogFixture from "./fixtures/tigerweb/county-catalog-edge-cases.json";
import populationFixture from "./fixtures/tigerweb/county-population-edge-cases.json";

const fetchJsonWithRetryMock = vi.fn();

vi.mock("@/lib/data-sources/http", () => ({
  fetchJsonWithRetry: (...args: unknown[]) => fetchJsonWithRetryMock(...args),
}));

import { __resetCountyCatalogForTests, searchUsCounties } from "@/lib/geographies/us-counties";

/**
 * County search reads TIGERweb's Counties layer (tigerWMS_Current, layer 82)
 * for the catalog and the 2020 Counties layer (tigerWMS_Census2020, layer 82)
 * for population, both without an API key. The fixtures are real responses
 * from those layers recorded on 2026-11-01 for 24 counties chosen for their
 * edge cases: five Washington Counties, Franklin OH and ID, Orleans Parish and
 * two Orleans Counties, four Alaska boroughs and census areas, Juneau WI,
 * Richmond city and Richmond County VA, Richmond County GA, San Juan Municipio
 * and San Juan County NM, DC, a Connecticut planning region, Guam, and Nevada
 * County CA. Each fixture carries its capture URL.
 */

type Attributes = Record<string, unknown>;

function route(url: string) {
  const parsed = new URL(url);
  return {
    service: url.includes("tigerWMS_Census2020") ? ("population" as const) : ("current" as const),
    layer: /\/MapServer\/(\d+)\/query/.exec(parsed.pathname)?.[1] ?? "",
    offset: Number(parsed.searchParams.get("resultOffset") ?? "0"),
    where: parsed.searchParams.get("where"),
    outFields: parsed.searchParams.get("outFields"),
    host: parsed.host,
  };
}

function page(rows: Attributes[], exceededTransferLimit = false) {
  return {
    features: rows.map((attributes) => ({ attributes })),
    ...(exceededTransferLimit ? { exceededTransferLimit: true } : {}),
  };
}

const CATALOG_ROWS = catalogFixture.response.features.map((feature) => feature.attributes as Attributes);
const POPULATION_ROWS = populationFixture.response.features.map((feature) => feature.attributes as Attributes);

/** Answer both layers from the recorded fixtures, one page each. */
function answerFromFixtures(
  overrides: { catalog?: unknown; population?: unknown } = {}
) {
  fetchJsonWithRetryMock.mockImplementation((url: string) => {
    const { service } = route(url);
    if (service === "current") {
      return Promise.resolve("catalog" in overrides ? overrides.catalog : page(CATALOG_ROWS));
    }
    return Promise.resolve("population" in overrides ? overrides.population : page(POPULATION_ROWS));
  });
}

async function ids(query: string, limit?: number) {
  const outcome = await searchUsCounties(query, limit);
  expect(outcome.availability).toBe("ok");
  return outcome.items.map((item) => item.geographyId);
}

async function labels(query: string, limit?: number) {
  return (await searchUsCounties(query, limit)).items.map((item) => item.geographyLabel);
}

describe("searchUsCounties against recorded TIGERweb responses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    __resetCountyCatalogForTests();
    answerFromFixtures();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    __resetCountyCatalogForTests();
  });

  it("needs no Census API key: every request goes to TIGERweb's two Counties layers", async () => {
    vi.stubEnv("CENSUS_API_KEY", "");

    const outcome = await searchUsCounties("Orleans Parish");

    expect(outcome.availability).toBe("ok");
    expect(outcome.items.map((item) => item.geographyId)).toEqual(["22071"]);
    const calls = fetchJsonWithRetryMock.mock.calls.map(([url]) => route(String(url)));
    expect(calls.map((call) => `${call.host} ${call.service} ${call.layer}`).sort()).toEqual([
      "tigerweb.geo.census.gov current 82",
      "tigerweb.geo.census.gov population 82",
    ]);
    // The whole layer, with the fields the catalog reads.
    expect(calls.every((call) => call.where === "1=1")).toBe(true);
    expect(calls.find((call) => call.service === "current")?.outFields).toBe("GEOID,NAME,STATE");
    expect(calls.find((call) => call.service === "population")?.outFields).toBe("GEOID,POP100");
  });

  it("never attaches a configured Census key to a TIGERweb request", async () => {
    vi.stubEnv("CENSUS_API_KEY", "secret-test-key");
    await searchUsCounties("Orleans");
    for (const [url] of fetchJsonWithRetryMock.mock.calls) {
      expect(String(url)).not.toContain("secret-test-key");
      expect(String(url)).not.toContain("api.census.gov");
    }
  });

  it("labels each county with its full name, suffix and state", async () => {
    expect(await labels("Orleans Parish")).toEqual(["Orleans Parish, LA"]);
    expect(await labels("Bethel")).toEqual(["Bethel Census Area, AK"]);
    expect(await labels("North Slope")).toEqual(["North Slope Borough, AK"]);
    expect(await labels("Anchorage")).toEqual(["Anchorage Municipality, AK"]);
    expect(await labels("San Juan, PR")).toEqual(["San Juan Municipio, PR"]);
    expect(await labels("District of Columbia")).toEqual(["District of Columbia, DC"]);
    expect(await labels("Guam")).toEqual(["Guam, GU"]);
  });

  it("builds the run prefix and slug from the TIGERweb name", async () => {
    const [orleans] = (await searchUsCounties("Orleans Parish")).items;
    expect(orleans).toMatchObject({
      geographyId: "22071",
      countyPrefix: "ORLEANS",
      countySlug: "orleans-parish-22071",
      suggestedRunName: "orleans-parish-22071-runtime",
      population: 383997,
    });
  });

  it("matches partial names", async () => {
    // Orleans Parish (383,997) outranks Orleans County NY (40,343) and VT (27,393).
    expect(await ids("orle")).toEqual(["22071", "36073", "50019"]);
    expect(await ids("Nev")).toEqual(["06057"]);
  });

  it("ranks the five Washington Counties by population and narrows to a named state", async () => {
    expect(await ids("Washington")).toEqual(["41067", "05143", "42125", "24043", "39167"]);
    expect(await ids("Washington County, OH")).toEqual(["39167"]);
    expect(await ids("Washington County, Oregon")).toEqual(["41067"]);
    expect(await ids("Washington County, MD", 1)).toEqual(["24043"]);
  });

  it("tells a Virginia independent city from the county of the same name", async () => {
    // Richmond city VA (226,610), Richmond County GA (206,607), Richmond County VA (8,923).
    expect(await ids("Richmond")).toEqual(["51760", "13245", "51159"]);
    expect(await ids("Richmond city")).toEqual(["51760"]);
    expect(await labels("Richmond, VA")).toEqual(["Richmond city, VA", "Richmond County, VA"]);
  });

  it("finds Alaska's city and borough beside a same-named Wisconsin county", async () => {
    expect(await labels("Juneau")).toEqual(["Juneau City and Borough, AK", "Juneau County, WI"]);
  });

  it("finds Puerto Rico municipios and DC by name, state and code", async () => {
    expect(await ids("San Juan")).toEqual(["72127", "35045"]);
    expect(await ids("DC")).toEqual(["11001"]);
    expect(await ids("11001")).toEqual(["11001"]);
  });

  it("keeps a county the 2020 population layer does not know, ranked as unknown", async () => {
    const outcome = await searchUsCounties("Capitol");
    expect(outcome.items).toEqual([
      expect.objectContaining({ geographyId: "09110", geographyLabel: "Capitol Planning Region, CT", population: null }),
    ]);
  });

  it("reports a genuine non-match as available with no items", async () => {
    const outcome = await searchUsCounties("zzzznotacounty");
    expect(outcome).toEqual({ items: [], availability: "ok", unavailableReason: null });
  });

  it("does not consult TIGERweb for a query too short to search", async () => {
    const outcome = await searchUsCounties("f");
    expect(outcome.availability).toBe("ok");
    expect(outcome.items).toEqual([]);
    expect(fetchJsonWithRetryMock).not.toHaveBeenCalled();
  });
});

describe("searchUsCounties when TIGERweb does not answer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetCountyCatalogForTests();
  });

  afterEach(() => {
    __resetCountyCatalogForTests();
  });

  it.each([
    ["no response (timeout, non-OK status or unparseable body)", null],
    ["an ArcGIS error object", { error: { code: 400, message: "Unable to complete operation." } }],
    ["an answer for every county that names none", { features: [] }],
    ["rows with no usable GEOID or name", page([{ GEOID: "123", NAME: "Bad" }, { GEOID: "22071", NAME: "" }])],
  ])("reports %s as unavailable, not as an empty country", async (_label, catalog) => {
    answerFromFixtures({ catalog });

    const outcome = await searchUsCounties("Orleans");

    expect(outcome.availability).toBe("unavailable");
    expect(outcome.items).toEqual([]);
    expect(outcome.unavailableReason).toMatch(/TIGERweb county layer did not respond/);
    expect(outcome.unavailableReason).not.toMatch(/API key/i);
  });

  it("does not memoize a failure: the next search retries", async () => {
    let catalogCalls = 0;
    fetchJsonWithRetryMock.mockImplementation((url: string) => {
      if (route(url).service === "population") return Promise.resolve(page(POPULATION_ROWS));
      catalogCalls += 1;
      return Promise.resolve(catalogCalls === 1 ? null : page(CATALOG_ROWS));
    });

    expect((await searchUsCounties("Orleans Parish")).availability).toBe("unavailable");
    const second = await searchUsCounties("Orleans Parish");
    expect(second.availability).toBe("ok");
    expect(second.items.map((item) => item.geographyId)).toEqual(["22071"]);
    expect(catalogCalls).toBe(2);
  });

  it("memoizes a success: a second search fetches neither layer again", async () => {
    answerFromFixtures();
    await searchUsCounties("Orleans");
    await searchUsCounties("Washington");
    expect(fetchJsonWithRetryMock).toHaveBeenCalledTimes(2);
  });

  it("still searches without population, ordering ties alphabetically", async () => {
    answerFromFixtures({ population: null });

    const outcome = await searchUsCounties("Washington");

    expect(outcome.availability).toBe("ok");
    expect(outcome.items.map((item) => item.geographyLabel)).toEqual([
      "Washington County, AR",
      "Washington County, MD",
      "Washington County, OH",
      "Washington County, OR",
      "Washington County, PA",
    ]);
    expect(outcome.items.every((item) => item.population === null)).toBe(true);
  });

  it("asks for population again on the next search after the population layer failed", async () => {
    let populationCalls = 0;
    fetchJsonWithRetryMock.mockImplementation((url: string) => {
      if (route(url).service === "current") return Promise.resolve(page(CATALOG_ROWS));
      populationCalls += 1;
      return Promise.resolve(populationCalls === 1 ? null : page(POPULATION_ROWS));
    });

    expect((await searchUsCounties("Orleans Parish")).items[0].population).toBeNull();
    expect((await searchUsCounties("Orleans Parish")).items[0].population).toBe(383997);
    expect(populationCalls).toBe(2);
  });

  it("treats a null, blank or negative population as unknown, not as zero", async () => {
    answerFromFixtures({
      population: page([
        { GEOID: "05143", POP100: null },
        { GEOID: "24043", POP100: -1 },
        { GEOID: "39167", POP100: "" },
        { GEOID: "41067", POP100: 600372 },
      ]),
    });

    const outcome = await searchUsCounties("Washington");

    expect(outcome.items[0]).toMatchObject({ geographyId: "41067", population: 600372 });
    // Unknown sorts after known, then alphabetically.
    expect(outcome.items.slice(1).map((item) => [item.geographyId, item.population])).toEqual([
      ["05143", null],
      ["24043", null],
      ["39167", null],
      ["42125", null],
    ]);
  });
});

describe("searchUsCounties paging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetCountyCatalogForTests();
  });

  it("follows exceededTransferLimit with the next offset until the layer is complete", async () => {
    const firstHalf = CATALOG_ROWS.slice(0, 12);
    const secondHalf = CATALOG_ROWS.slice(12);
    fetchJsonWithRetryMock.mockImplementation((url: string) => {
      const { service, offset } = route(url);
      if (service === "population") return Promise.resolve(page(POPULATION_ROWS));
      if (offset === 0) return Promise.resolve(page(firstHalf, true));
      if (offset === 12) return Promise.resolve(page(secondHalf));
      return Promise.resolve(null);
    });

    // Anchorage is on the first page, Guam and San Juan Municipio on the second.
    expect(await ids("Anchorage")).toEqual(["02020"]);
    expect(await ids("Guam")).toEqual(["66010"]);
    expect(await ids("San Juan")).toEqual(["72127", "35045"]);
    const offsets = fetchJsonWithRetryMock.mock.calls
      .map(([url]) => route(String(url)))
      .filter((call) => call.service === "current")
      .map((call) => call.offset);
    expect(offsets).toEqual([0, 12]);
  });

  it("refuses a catalog whose later page did not answer, rather than serving part of the country", async () => {
    fetchJsonWithRetryMock.mockImplementation((url: string) => {
      const { service, offset } = route(url);
      if (service === "population") return Promise.resolve(page(POPULATION_ROWS));
      return Promise.resolve(offset === 0 ? page(CATALOG_ROWS.slice(0, 12), true) : null);
    });

    expect((await searchUsCounties("Anchorage")).availability).toBe("unavailable");
  });

  it("refuses a layer that keeps saying more rows exist", async () => {
    fetchJsonWithRetryMock.mockImplementation((url: string) => {
      const { service, offset } = route(url);
      if (service === "population") return Promise.resolve(page(POPULATION_ROWS));
      return Promise.resolve(page([{ GEOID: String(10000 + offset), NAME: `Row ${offset} County`, STATE: "01" }], true));
    });

    expect((await searchUsCounties("Row")).availability).toBe("unavailable");
  });

  it("refuses a page that says more rows exist but carries none", async () => {
    fetchJsonWithRetryMock.mockImplementation((url: string) =>
      Promise.resolve(route(url).service === "population" ? page(POPULATION_ROWS) : page([], true))
    );

    expect((await searchUsCounties("Orleans")).availability).toBe("unavailable");
  });
});
