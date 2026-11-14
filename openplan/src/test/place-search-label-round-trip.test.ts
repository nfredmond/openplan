/**
 * KI-2026-11-14-230: the label place search shows must find its place again.
 *
 * Lane 26's rehearsal typed "Pyramid Lake Paiute Reservation, NV", the label
 * the search had just shown, and got "No matching places": the search matched
 * only the start of the Census BASENAME, which for that reservation is
 * "Pyramid Lake Paiute".
 *
 * These tests run the real resolver and the real county catalog against
 * `answerTigerQuery`, which applies each built request to TIGERweb rows
 * recorded on 2026-11-14 (fixture `place-label-round-trip.json`, one capture
 * URL per layer). A request that does not match a place cannot find it here,
 * whatever text it contains.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/tigerweb/place-label-round-trip.json";
import { answerTigerQuery, type TigerRow } from "@/test/helpers/tigerweb-query-fake";

const fetchJsonWithRetryMock = vi.fn();

vi.mock("@/lib/data-sources/http", () => ({
  fetchJsonWithRetry: (...args: unknown[]) => fetchJsonWithRetryMock(...args),
}));

import { buildPlaceSearchUrl, sanitizeLikeQuery, searchPlaces } from "@/lib/geographies/place-resolver";
import { __resetCountyCatalogForTests } from "@/lib/geographies/us-counties";
import { placeKindSchema, type PlaceKind } from "@/lib/api/place-geographies";

const CURRENT_ROWS: Record<string, TigerRow[]> = Object.fromEntries(
  Object.entries(recorded.layers).map(([layer, capture]) => [
    layer,
    capture.response.features.map((feature) => feature.attributes as TigerRow),
  ])
);

let fakeErrors: string[] = [];
let requests: string[] = [];

/** Serve Current from `current`, and Census2020 (population only) from `population`. */
function serve(current: Record<string, TigerRow[]>, population: Record<string, TigerRow[]> = {}) {
  fetchJsonWithRetryMock.mockImplementation((url: string) => {
    requests.push(url);
    const rows = url.includes("tigerWMS_Census2020") ? population : current;
    return Promise.resolve(answerTigerQuery(url, rows, (message, where) => fakeErrors.push(`${message}: ${where}`)));
  });
}

function whereClauses(): string[] {
  return requests.map((url) => new URL(url).searchParams.get("where") ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetCountyCatalogForTests();
  fakeErrors = [];
  requests = [];
  serve(CURRENT_ROWS);
});

afterEach(() => {
  __resetCountyCatalogForTests();
});

/**
 * One place of every kind the search offers, with the query that first finds
 * it. Accents, a slash, a multi-state area, a metro area whose BASENAME
 * carries its states, and towns and townships that need their county.
 */
const CASES: Array<{ kind: PlaceKind; geoid: string; seed: string }> = [
  { kind: "county", geoid: "06091", seed: "Sierra" },
  { kind: "county", geoid: "32017", seed: "Lincoln, NV" },
  { kind: "city", geoid: "0618100", seed: "Davis" },
  { kind: "city", geoid: "3525170", seed: "Española" },
  { kind: "cdp", geoid: "0671778", seed: "Sierra City" },
  { kind: "metro", geoid: "17980", seed: "Columbus" },
  { kind: "micro", geoid: "46020", seed: "Truckee" },
  { kind: "aiannh", geoid: "3010R", seed: "Pyramid Lake" },
  { kind: "aiannh", geoid: "2430R", seed: "Navajo" },
  { kind: "aiannh", geoid: "2430T", seed: "Navajo" },
  { kind: "aiannh", geoid: "5915R", seed: "Creek" },
  { kind: "cousub", geoid: "3914981620", seed: "Washington, OH" },
  { kind: "cousub", geoid: "2501735215", seed: "Lexington" },
  { kind: "cousub", geoid: "7201170534", seed: "Río Cañas" },
];

describe("the label search shows finds the same place again", () => {
  it("covers every kind of place the search offers", () => {
    expect(new Set(CASES.map((entry) => entry.kind))).toEqual(new Set(placeKindSchema.options));
  });

  it.each(CASES)("$kind $geoid, first found by \"$seed\"", async ({ kind, geoid, seed }) => {
    const first = await searchPlaces(seed, 20);
    const shown = first.items.find((item) => item.kind === kind && item.geoid === geoid);
    expect(shown, `"${seed}" did not find ${kind} ${geoid}`).toBeDefined();
    const label = shown!.label;

    const again = await searchPlaces(label);

    // Typed back exactly, the label leads the list.
    expect(again.items[0], `"${label}" did not find ${kind} ${geoid} first`).toMatchObject({ kind, geoid, label });
    expect(again.unavailableKinds).toEqual([]);
    expect(fakeErrors).toEqual([]);
  });

  it("finds the reservation by the full name a planner types, with or without the state", async () => {
    for (const query of ["Pyramid Lake Paiute Reservation", "Pyramid Lake Paiute Reservation, NV", "pyramid lake paiute reservation, Nevada"]) {
      const outcome = await searchPlaces(query);
      expect(outcome.items[0], query).toMatchObject({
        kind: "aiannh",
        geoid: "3010R",
        label: "Pyramid Lake Paiute Reservation, NV",
      });
    }
    // Named for the wrong state, it is not offered.
    expect((await searchPlaces("Pyramid Lake Paiute Reservation, CA")).items).toEqual([]);
    expect(fakeErrors).toEqual([]);
  });

  it("matches a multi-state label against every state it lists", async () => {
    const navajo = await searchPlaces("Navajo Nation Reservation, AZ-NM-UT");
    expect(navajo.items.map((item) => item.geoid)).toEqual(["2430R"]);
    // Every listed state must be one the area lies in.
    expect((await searchPlaces("Navajo Nation Reservation, AZ-CA")).items).toEqual([]);
  });

  it("narrows a township label to its county with the COUNTY field", async () => {
    await searchPlaces("Washington township, Shelby County, OH");
    const township = whereClauses().find((where) => where.includes("COUNTY="));
    expect(township).toContain("STATE='39' AND COUNTY='149'");
  });

  it("keeps a fragment that is not a county's full name as part of the name", async () => {
    // "Shelby" alone is not the county's name ("Shelby County"), so the whole
    // text is searched and nothing is dropped.
    await searchPlaces("Washington township, Shelby, OH");
    expect(whereClauses().some((where) => where.includes("COUNTY="))).toBe(false);
    expect(whereClauses().some((where) => where.includes("UPPER('Washington township, Shelby%')"))).toBe(true);
  });

  it("still ranks an exact base-name match above a match on the full name", async () => {
    // "Navajo Nation" is the BASENAME of both Navajo areas; NAME adds nothing.
    const outcome = await searchPlaces("Navajo Nation");
    expect(outcome.items.map((item) => item.geoid).sort()).toEqual(["2430R", "2430T"]);
  });
});

describe("the LIKE sanitizer covers both clauses", () => {
  it("puts the same escaped literal in the BASENAME and the NAME clause", () => {
    const like = sanitizeLikeQuery("50%_off'\\ \"x\"");
    expect(like).toBe("50 off'' x");
    const where = new URL(buildPlaceSearchUrl({ layerId: 36, sanitizedLike: like, limit: 40, hasStateField: false }))
      .searchParams.get("where");
    expect(where).toBe("(UPPER(BASENAME) LIKE UPPER('50 off'' x%') OR UPPER(NAME) LIKE UPPER('50 off'' x%'))");
  });

  it.each([
    // A leaked % or _ would match Creek/Seminole and Davis on either clause.
    ["%Seminole"],
    ["%seminole joint-use"],
    ["_avis"],
    ["_avis city"],
    // A quote or backslash must stay inside the literal.
    ["Pyramid Lake' OR '1'='1"],
    ["Davis\\' OR UPPER(NAME) LIKE '%"],
    ["\\%Seminole"],
  ])("%j neither widens the match nor breaks the request", async (query) => {
    const outcome = await searchPlaces(query);
    expect(outcome.items).toEqual([]);
    expect(outcome.searchUnavailable).toBe(false);
    expect(outcome.unavailableKinds).toEqual([]);
    expect(fakeErrors).toEqual([]);
  });
});

describe("a full page that holds a name-only match", () => {
  // Synthetic rows shaped to the case, not recorded: 40 places whose BASENAME
  // is the query, and two whose BASENAME is shorter but whose NAME starts with
  // it. The shorter BASENAMEs sort first, so a 40-row page of the widened query
  // drops the last two BASENAME matches.
  const basenameRows: TigerRow[] = Array.from({ length: 40 }, (_, index) => ({
    GEOID: String(1000000 + index),
    NAME: "Lake City city",
    BASENAME: "Lake City",
    STATE: "12",
  }));
  const wanted = basenameRows[39];
  const nameOnlyRows: TigerRow[] = [
    { GEOID: "2000000", NAME: "Lake City Heights village", BASENAME: "Lake", STATE: "12" },
    { GEOID: "2000001", NAME: "Lake City Shores village", BASENAME: "Lake", STATE: "12" },
  ];

  it("asks again for BASENAME alone and keeps the place the old search found", async () => {
    serve(
      { "28": [...basenameRows, ...nameOnlyRows] },
      // The wanted place is the largest, so it leads among equal matches.
      { "26": [{ ...wanted, POP100: 90000 }, ...basenameRows.slice(0, 39).map((row) => ({ ...row, POP100: 100 }))] }
    );

    const outcome = await searchPlaces("Lake City");

    expect(outcome.items[0]).toMatchObject({ kind: "city", geoid: wanted.GEOID });
    const placeQueries = requests
      .filter((url) => !url.includes("tigerWMS_Census2020") && /\/MapServer\/28\/query/.test(url))
      .map((url) => new URL(url).searchParams.get("where"));
    expect(placeQueries).toEqual([
      "(UPPER(BASENAME) LIKE UPPER('Lake City%') OR UPPER(NAME) LIKE UPPER('Lake City%'))",
      "UPPER(BASENAME) LIKE UPPER('Lake City%')",
    ]);
    expect(fakeErrors).toEqual([]);
  });

  it("asks once when the page is not full", async () => {
    serve({ "28": [...basenameRows.slice(0, 30), ...nameOnlyRows] });
    await searchPlaces("Lake City");
    expect(requests.filter((url) => !url.includes("tigerWMS_Census2020") && /\/MapServer\/28\/query/.test(url))).toHaveLength(1);
  });
});
