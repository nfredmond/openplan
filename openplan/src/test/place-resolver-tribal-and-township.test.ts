/**
 * Tribal areas (AIANNH) and towns or townships (county subdivisions) through
 * the place resolver, against TIGERweb responses recorded from the live
 * tigerWMS_Current service on 2026-11-01. Each fixture carries its own capture
 * URL and what was trimmed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import navajoSearch from "./fixtures/tigerweb/aiannh-search-navajo.json";
import navajoBoundary from "./fixtures/tigerweb/aiannh-boundary-2430R.json";
import washingtonOhSearch from "./fixtures/tigerweb/cousub-search-washington-oh.json";
import washingtonOhCounties from "./fixtures/tigerweb/county-names-washington-oh.json";
import lexingtonMaBoundary from "./fixtures/tigerweb/cousub-boundary-2501735215.json";
import middlesexCounty from "./fixtures/tigerweb/county-names-25017.json";

const fetchJsonWithRetryMock = vi.fn();
const searchUsCountiesMock = vi.fn();

vi.mock("@/lib/data-sources/http", () => ({
  fetchJsonWithRetry: (...args: unknown[]) => fetchJsonWithRetryMock(...args),
}));

vi.mock("@/lib/geographies/us-counties", () => ({
  searchUsCounties: (...args: unknown[]) => searchUsCountiesMock(...args),
}));

import { aiannhStateFips, resolvePlaceBoundary, searchPlaces } from "@/lib/geographies/place-resolver";
import { normalizePlaceGeoid, placeBoundaryResponseSchema } from "@/lib/api/place-geographies";
import {
  homeGeographyFromPlaceBoundary,
  placeOfRecordFromHomeGeography,
  resolveJurisdiction,
  tigerwebCountyFipsFromHomeGeography,
} from "@/lib/workspaces/home-geography";
import { JURISDICTION_READINESS_JOBS, resolveJurisdictionReadiness } from "@/lib/jurisdiction-readiness/registry";
import { describeGrantProgramCoverage } from "@/lib/grants/programs/coverage";
import { describeBlockedCoverage, resolveCensusTractCoverageTarget } from "@/lib/geographies/census-tract-coverage";

const AIANNH_LAYER_IDS = ["36", "38", "40", "42", "44", "46", "48", "50", "52"];

function route(url: string): { service: "current" | "population"; layer: string; where: string } {
  const parsed = new URL(url);
  return {
    service: url.includes("tigerWMS_Census2020") ? "population" : "current",
    layer: /\/MapServer\/(\d+)\/query/.exec(parsed.pathname)?.[1] ?? "",
    where: parsed.searchParams.get("where") ?? "",
  };
}

const EMPTY_QUERY = { features: [] };
const EMPTY_GEOJSON = { type: "FeatureCollection", features: [] };

beforeEach(() => {
  vi.clearAllMocks();
  searchUsCountiesMock.mockResolvedValue({ items: [], availability: "ok", unavailableReason: null });
});

describe("tribal areas: search", () => {
  function answerNavajo(overrides: Record<string, unknown> = {}) {
    fetchJsonWithRetryMock.mockImplementation((url: string) => {
      const { service, layer } = route(url);
      if (service === "current" && layer in overrides) return Promise.resolve(overrides[layer]);
      if (service === "current" && (layer === "36" || layer === "38")) {
        return Promise.resolve(navajoSearch.layers[layer].response);
      }
      return Promise.resolve(EMPTY_QUERY);
    });
  }

  it("finds the Navajo Nation in both of its layers and names all three states", async () => {
    answerNavajo();
    const outcome = await searchPlaces("Navajo");

    const tribal = outcome.items.filter((item) => item.kind === "aiannh");
    // Equal name matches with unknown population fall back to label order.
    expect(tribal).toEqual([
      {
        kind: "aiannh",
        geoid: "2430T",
        label: "Navajo Nation Off-Reservation Trust Land, AZ-NM-UT",
        description: "Tribal area",
        stateFips: null,
      },
      {
        kind: "aiannh",
        geoid: "2430R",
        label: "Navajo Nation Reservation, AZ-NM-UT",
        description: "Tribal area",
        // Three states: none of them is "the" state.
        stateFips: null,
      },
    ]);
    expect(outcome.unavailableKinds).toEqual([]);

    // Every AIANNH layer was asked, by name prefix, for the state-list fields.
    const asked = fetchJsonWithRetryMock.mock.calls
      .map(([url]) => route(String(url)))
      .filter((call) => call.service === "current" && AIANNH_LAYER_IDS.includes(call.layer));
    expect(asked.map((call) => call.layer).sort()).toEqual([...AIANNH_LAYER_IDS].sort());
    for (const [url] of fetchJsonWithRetryMock.mock.calls) {
      const call = route(String(url));
      if (!AIANNH_LAYER_IDS.includes(call.layer) || call.service !== "current") continue;
      expect(new URL(String(url)).searchParams.get("outFields")).toBe(
        "GEOID,NAME,BASENAME,AIANNHFP1,AIANNHFP2,AIANNHFP3"
      );
      // These layers have no STATE field; a STATE clause would be rejected.
      expect(call.where).not.toContain("STATE=");
    }
  });

  it("matches a state-qualified search against any of the area's states, not only the first", async () => {
    answerNavajo();
    const inNewMexico = await searchPlaces("Navajo, NM");
    expect(inNewMexico.items.map((item) => item.geoid).sort()).toEqual(["2430R", "2430T"]);

    answerNavajo();
    const inCalifornia = await searchPlaces("Navajo, CA");
    expect(inCalifornia.items.filter((item) => item.kind === "aiannh")).toEqual([]);
  });

  it("reports tribal areas as incomplete when one AIANNH layer does not answer, and keeps what did", async () => {
    answerNavajo({ "44": null });
    const outcome = await searchPlaces("Navajo");
    expect(outcome.unavailableKinds).toEqual(["aiannh"]);
    expect(outcome.searchUnavailable).toBe(false);
    expect(outcome.items.map((item) => item.geoid)).toContain("2430R");
  });
});

describe("aiannhStateFips", () => {
  it("lists every state in Census order and keeps an unreadable list empty", () => {
    expect(aiannhStateFips({ AIANNHFP1: "04-48845", AIANNHFP2: "35-51580", AIANNHFP3: "49-53920" })).toEqual(["04", "35", "49"]);
    expect(aiannhStateFips({ AIANNHFP1: "06-16819", AIANNHFP2: null, AIANNHFP3: null })).toEqual(["06"]);
    // Malformed or unknown codes are dropped, never replaced with a guess.
    expect(aiannhStateFips({ AIANNHFP1: "04", AIANNHFP2: "99-12345", AIANNHFP3: "35-51580" })).toEqual(["35"]);
    expect(aiannhStateFips({})).toEqual([]);
    expect(aiannhStateFips(null)).toEqual([]);
  });
});

describe("tribal areas: boundary", () => {
  function answerBoundary(byLayer: Record<string, unknown>) {
    fetchJsonWithRetryMock.mockImplementation((url: string) => {
      const { layer } = route(url);
      return Promise.resolve(layer in byLayer ? byLayer[layer] : EMPTY_GEOJSON);
    });
  }

  it("asks every AIANNH layer for the GEOID and resolves the one that holds it", async () => {
    answerBoundary({ "36": navajoBoundary.response });
    const boundary = await resolvePlaceBoundary("aiannh", "2430R");

    expect(boundary).not.toBeNull();
    expect(boundary).toMatchObject({ kind: "aiannh", geoid: "2430R", label: "Navajo Nation Reservation, AZ-NM-UT" });
    expect(placeBoundaryResponseSchema.safeParse(boundary).success).toBe(true);
    const layers = fetchJsonWithRetryMock.mock.calls.map(([url]) => route(String(url)));
    expect(layers.map((call) => call.layer).sort()).toEqual([...AIANNH_LAYER_IDS].sort());
    expect(layers.every((call) => call.where === "GEOID='2430R'")).toBe(true);
  });

  it("refuses a GEOID found in two AIANNH layers instead of picking one", async () => {
    answerBoundary({ "36": navajoBoundary.response, "38": navajoBoundary.response });
    expect(await resolvePlaceBoundary("aiannh", "2430R")).toBeNull();
  });

  it("accepts the kind's own GEOID format and nothing looser, before any network call", async () => {
    for (const [kind, geoid] of [
      ["aiannh", "2430"],
      ["aiannh", "24300"],
      ["aiannh", "2430X"],
      ["cousub", "39125"],
      ["cousub", "3912581"],
      ["city", "2430R"],
      ["county", "3912581536"],
    ] as const) {
      expect(await resolvePlaceBoundary(kind, geoid)).toBeNull();
    }
    expect(fetchJsonWithRetryMock).not.toHaveBeenCalled();
    expect(normalizePlaceGeoid("aiannh", " 2430t ")).toBe("2430T");
    expect(normalizePlaceGeoid("county", "06-113")).toBeNull();
  });
});

/**
 * The consumer side. A tribal government that sets the Navajo Nation as its
 * home must not be filed under Arizona (its first listed state), or under any
 * one state, by the readiness registry, the grant catalog or tract loading.
 */
describe("a multi-state reservation as a home geography", () => {
  async function navajoHome() {
    fetchJsonWithRetryMock.mockImplementation((url: string) =>
      Promise.resolve(route(url).layer === "36" ? navajoBoundary.response : EMPTY_GEOJSON)
    );
    const boundary = await resolvePlaceBoundary("aiannh", "2430R");
    if (!boundary) throw new Error("fixture did not resolve");
    return homeGeographyFromPlaceBoundary(boundary, { setAt: new Date("2026-11-01T00:00:00Z") });
  }

  it("records the country and no state", async () => {
    const row = await navajoHome();
    expect(row).toMatchObject({
      home_geography_kind: "aiannh",
      home_geography_ref: "2430R",
      home_geography_label: "Navajo Nation Reservation, AZ-NM-UT",
      home_country_code: "US",
      home_subdivision_code: null,
    });
    expect(resolveJurisdiction(row)).toEqual({ country: "US", subdivision: null });
  });

  it("leaves readiness unassessed rather than answering for Arizona", async () => {
    const row = await navajoHome();
    const report = resolveJurisdictionReadiness(
      { countryCode: row.home_country_code, subdivisionCode: row.home_subdivision_code, label: row.home_geography_label },
      JURISDICTION_READINESS_JOBS[0].id
    );
    expect(report?.status).toBe("unassessed");
    expect(report?.jurisdiction.subdivision).toBeNull();
    expect(report?.applicability).toMatch(/does not identify one subdivision/);
  });

  it("tells the grant catalog the state is not established", async () => {
    const row = await navajoHome();
    const coverage = describeGrantProgramCoverage(resolveJurisdiction(row));
    expect(coverage.workspaceJurisdictionLabel).toBe("US");
    expect(coverage.disclosure?.reason).toBe("no_workspace_subdivision");
    expect(coverage.bundles.some((bundle) => bundle.scope === "jurisdiction_match")).toBe(false);
  });

  it("loads no county's tracts and says why", async () => {
    const row = await navajoHome();
    expect(tigerwebCountyFipsFromHomeGeography(row)).toBeNull();
    const target = resolveCensusTractCoverageTarget(placeOfRecordFromHomeGeography(row));
    expect(target).toMatchObject({ kind: "blocked", reason: "kind_unsupported" });
    if (target.kind !== "blocked") throw new Error("expected blocked");
    expect(describeBlockedCoverage(target, { origin: "workspace_home_geography" }).join(" ")).toContain("tribal area");
  });
});

describe("towns and townships", () => {
  function answerWashington(countyNames: unknown = washingtonOhCounties.response) {
    fetchJsonWithRetryMock.mockImplementation((url: string) => {
      const { service, layer, where } = route(url);
      if (service === "current" && layer === "22") return Promise.resolve(washingtonOhSearch.response);
      if (service === "current" && layer === "82" && where.startsWith("GEOID IN")) return Promise.resolve(countyNames);
      return Promise.resolve(EMPTY_QUERY);
    });
  }

  it("names the county so same-named townships can be told apart", async () => {
    answerWashington();
    const outcome = await searchPlaces("Washington, OH");
    const townships = outcome.items.filter((item) => item.kind === "cousub");

    expect(townships.map((item) => item.label).sort()).toEqual([
      "Washington township, Columbiana County, OH",
      "Washington township, Paulding County, OH",
      "Washington township, Sandusky County, OH",
      "Washington township, Shelby County, OH",
    ]);
    expect(new Set(townships.map((item) => item.label)).size).toBe(townships.length);
    expect(townships.every((item) => item.description === "Town or township" && item.stateFips === "39")).toBe(true);

    const search = fetchJsonWithRetryMock.mock.calls
      .map(([url]) => route(String(url)))
      .find((call) => call.service === "current" && call.layer === "22");
    // State filter from the query, plus the code-owned exclusions.
    expect(search?.where).toContain("STATE='39'");
    expect(search?.where).toContain("FUNCSTAT NOT IN ('S','F') AND LSADC<>'25'");
  });

  it("keeps every township when the county names do not arrive, and names no county", async () => {
    answerWashington(null);
    const outcome = await searchPlaces("Washington, OH");
    const labels = outcome.items.filter((item) => item.kind === "cousub").map((item) => item.label);
    expect(labels).toHaveLength(4);
    expect(labels.every((label) => label === "Washington township, OH")).toBe(true);
    expect(outcome.unavailableKinds).toEqual([]);
  });

  it("resolves a New England town with its county and records its state", async () => {
    fetchJsonWithRetryMock.mockImplementation((url: string) => {
      const { layer, where } = route(url);
      if (layer === "22" && where === "GEOID='2501735215'") return Promise.resolve(lexingtonMaBoundary.response);
      if (layer === "82") return Promise.resolve(middlesexCounty.response);
      return Promise.resolve(EMPTY_GEOJSON);
    });

    const boundary = await resolvePlaceBoundary("cousub", "2501735215");
    expect(boundary).toMatchObject({
      kind: "cousub",
      geoid: "2501735215",
      label: "Lexington town, Middlesex County, MA",
    });
    if (!boundary) throw new Error("fixture did not resolve");
    const row = homeGeographyFromPlaceBoundary(boundary);
    expect(row.home_subdivision_code).toBe("MA");
    // A town is not a county, so no county's tracts are loaded for it.
    expect(tigerwebCountyFipsFromHomeGeography(row)).toBeNull();
  });
});
