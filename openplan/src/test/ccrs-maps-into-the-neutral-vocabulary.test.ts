import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCcrsCrashes } from "@/lib/safety/sources/ccrs";
import {
  CCRS_VOCABULARY,
  CCRS_DIMENSION_SUPPORT,
  isCcrsMotorcycleVehicle,
} from "@/lib/safety/sources/ccrs-vocabulary";
import {
  deriveCcrsPartyRole,
  deriveCcrsPersonInjury,
  fetchCcrsParties,
} from "@/lib/safety/sources/ccrs-parties";
import { findDescriptorVocabularyViolations, mapCrashDimension } from "@/lib/safety/vocabulary";
import { __clearFetchJsonResponseCacheForTests } from "@/lib/data-sources/http";

/**
 * The California descriptor, checked against the shapes its source actually
 * ships.
 *
 * Every value asserted here was read off the live feed on 2026-08-11, including
 * the source's own misspelling of "pedestrian" in its collision-type field. That
 * typo is the single most important line in this file: correcting it in the
 * mapping table would mean the mapping matches nothing at all, silently, and
 * every pedestrian collision would drop into `other`. A test that used the
 * CORRECT spelling would pass a broken mapping.
 */

const NEVADA_COUNTY_BBOX = { minLon: -121.3, minLat: 39.1, maxLon: -120.0, maxLat: 39.6 };

describe("the CCRS descriptor", () => {
  it("maps only onto values the neutral vocabulary declares", () => {
    expect(findDescriptorVocabularyViolations(CCRS_VOCABULARY)).toEqual([]);
  });

  it("matches the source's own misspelling literally", () => {
    // `VEHICLE/PEDESTRAIN` is what the field contains. The typo IS the data.
    expect(mapCrashDimension(CCRS_VOCABULARY, "collision_type", "VEHICLE/PEDESTRAIN")?.value).toBe(
      "vehicle_pedestrian"
    );
    // And the corrected spelling, which does NOT appear in the feed, must not be
    // silently accepted — otherwise a future "cleanup" of the mapping table would
    // look correct here while breaking in production.
    expect(mapCrashDimension(CCRS_VOCABULARY, "collision_type", "VEHICLE/PEDESTRIAN")).toEqual({
      value: "other",
      raw: "VEHICLE/PEDESTRIAN",
      unmapped: true,
    });
  });

  it("maps the whole probed collision-type vocabulary", () => {
    const expected: Array<[string, string]> = [
      ["REAR END", "rear_end"],
      ["SIDE SWIPE", "sideswipe"],
      ["HEAD-ON", "head_on"],
      ["BROADSIDE", "angle"],
      ["HIT OBJECT", "hit_object"],
      ["OVERTURNED", "overturn"],
      ["VEHICLE/PEDESTRAIN", "vehicle_pedestrian"],
      ["OTHER", "other"],
    ];
    for (const [raw, neutral] of expected) {
      expect(mapCrashDimension(CCRS_VOCABULARY, "collision_type", raw)?.value, raw).toBe(neutral);
    }
    // Null is the ninth observed state — 953 rows in 2025 — and it is ABSENT,
    // not a ninth manner of collision.
    expect(mapCrashDimension(CCRS_VOCABULARY, "collision_type", null)).toEqual({
      value: "unknown",
      raw: null,
      unmapped: false,
    });
  });

  it("separates the three kinds of darkness, because they fund different work", () => {
    expect(mapCrashDimension(CCRS_VOCABULARY, "lighting", "DAYLIGHT")?.value).toBe("daylight");
    expect(mapCrashDimension(CCRS_VOCABULARY, "lighting", "DUSK-DAWN")?.value).toBe("dawn_dusk");
    expect(mapCrashDimension(CCRS_VOCABULARY, "lighting", "DARK-STREET LIGHTS")?.value).toBe("dark_lighted");
    // The countermeasure trigger: dark, no lighting present at all.
    expect(mapCrashDimension(CCRS_VOCABULARY, "lighting", "DARK-NO STREET LIGHTS")?.value).toBe(
      "dark_unlighted"
    );
    // A maintenance ticket, not a capital project — and it must not collapse
    // into `dark_unlighted`, which would send a planner to design lighting that
    // is already installed.
    expect(
      mapCrashDimension(CCRS_VOCABULARY, "lighting", "DARK-STREET LIGHTS NOT FUNCTIONING")?.value
    ).toBe("dark_lighting_inoperative");
  });

  it("refuses to guess at the weather field's free-text tail", () => {
    for (const [raw, neutral] of [
      ["CLEAR", "clear"],
      ["CLOUDY", "cloudy"],
      ["RAINING", "rain"],
      ["SNOWING", "snow"],
      ["FOG/VISIBILITY", "fog"],
      ["WIND", "wind"],
    ] as const) {
      expect(mapCrashDimension(CCRS_VOCABULARY, "weather", raw)?.value, raw).toBe(neutral);
    }

    // Real values from the 2025 tail. Every one is a genuine observation and
    // none of them is a weather CATEGORY, so each lands on `other` with its raw
    // text kept — and is COUNTED, which is how the ingest can say how dirty the
    // facet is instead of pretending it is clean.
    for (const raw of ["INDOOR CAR WASH", "SMOKE (GIFFORD FIRE)", "inside parking", "BLOWING DUST-500' VIS"]) {
      const mapped = mapCrashDimension(CCRS_VOCABULARY, "weather", raw);
      expect(mapped, raw).toEqual({ value: "other", raw: raw.trim(), unmapped: true });
    }

    // The two temptations. Neither may be resolved by inference.
    expect(mapCrashDimension(CCRS_VOCABULARY, "weather", "MISTY")?.value).toBe("other");
    expect(mapCrashDimension(CCRS_VOCABULARY, "weather", "LIGHT DRIZZLE")?.value).toBe("other");

    // A positively-stated UNKNOWN is declared, so it does not inflate the
    // unmapped tally that measures how dirty the field is.
    expect(mapCrashDimension(CCRS_VOCABULARY, "weather", "UNKNOWN")).toEqual({
      value: "unknown",
      raw: "UNKNOWN",
      unmapped: false,
    });
  });

  it("keeps both the current and the retired spellings of a serious injury", () => {
    // Dropping the retired code would undercount the numerator of the KSI
    // measure in older years — silently, because nothing would error.
    expect(deriveCcrsPersonInjury("SuspectSerious").injury).toBe("suspected_serious");
    expect(deriveCcrsPersonInjury("SevereInactive").injury).toBe("suspected_serious");
    expect(deriveCcrsPersonInjury("OtherVisibleInactive").injury).toBe("suspected_minor");
    expect(deriveCcrsPersonInjury("ComplaintOfPainInactive").injury).toBe("possible");
    expect(deriveCcrsPersonInjury("Fatal").injury).toBe("fatal");
    expect(deriveCcrsPersonInjury("PossibleInjury").injury).toBe("possible");
  });

  it("reads a missing injury code as unknown, never as 'no apparent injury'", () => {
    // 244,788 rows in 2025 carry no code. They are overwhelmingly witnesses and
    // uninjured passengers, AND they are every row whose outcome was never
    // filled in, and the data does not separate the two. Calling them
    // `no_apparent_injury` would turn a quarter of a million unanswered
    // questions into a quarter of a million findings.
    expect(deriveCcrsPersonInjury(null).injury).toBe("unknown");
    expect(deriveCcrsPersonInjury("").injury).toBe("unknown");
  });

  it("derives a motorcyclist from the vehicle column, which the party type cannot express", () => {
    expect(isCcrsMotorcycleVehicle("Motorcycle")).toBe(true);
    expect(isCcrsMotorcycleVehicle("  MOTORCYCLE ")).toBe(true);
    expect(isCcrsMotorcycleVehicle("Passenger Car")).toBe(false);
    expect(isCcrsMotorcycleVehicle(null)).toBe(false);

    expect(deriveCcrsPartyRole("Driver", "Motorcycle").role).toBe("motorcyclist");
    expect(deriveCcrsPartyRole("Driver", "Passenger Car").role).toBe("driver");
    // The derivation applies to DRIVERS only — a pedestrian struck by a
    // motorcycle is still a pedestrian.
    expect(deriveCcrsPartyRole("Pedestrian", "Motorcycle").role).toBe("pedestrian");
  });

  it("keeps an autonomous vehicle's operator in the driver counts", () => {
    // `other` would drop 283 parties out of the driver totals over a year. The
    // value is a statement about the vehicle's automation, not about a different
    // kind of road user.
    expect(deriveCcrsPartyRole("AutonomousVehicle", null).role).toBe("driver");
    expect(deriveCcrsPartyRole("ParkedVehicle", null).role).toBe("parked_vehicle");
    expect(deriveCcrsPartyRole("Bicyclist", null).role).toBe("bicyclist");
    expect(deriveCcrsPartyRole(null, null).role).toBe("unknown");
  });

  it("declares severity as PARTIAL, because the crash table cannot reach KABCO A", () => {
    // `supplied` here would promise a serious-injury band the crash table has no
    // column for, and a "0 serious injuries" reading would follow.
    expect(CCRS_DIMENSION_SUPPORT.severity).toBe("partial");
    expect(CCRS_DIMENSION_SUPPORT.lighting).toBe("supplied");
  });
});

describe("the CCRS fetch maps dimensions off the live rows", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => __clearFetchJsonResponseCacheForTests());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
    __clearFetchJsonResponseCacheForTests();
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

  const PACKAGE_BODY = {
    result: {
      resources: [
        { id: "res-2025", name: "Crashes_2025" },
        { id: "party-2025", name: "Parties_2025" },
        { id: "ivp-2025", name: "InjuredWitnessPassengers_2025" },
      ],
    },
  };

  function stubCrashRows(rows: Array<Record<string, unknown>>) {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("package_show")) return jsonResponse(PACKAGE_BODY);
      if (url.includes("count%28")) return jsonResponse({ result: { records: [{ n: String(rows.length) }] } });
      if (decodeURIComponent(url).includes("count(*)")) {
        return jsonResponse({ result: { records: [{ n: String(rows.length) }] } });
      }
      return jsonResponse({ result: { records: rows } });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    return fetchMock;
  }

  it("requests the dimension columns and maps them onto the record", async () => {
    const fetchMock = stubCrashRows([
      {
        "Collision Id": 4540442,
        "Crash Date Time": "2025-01-12T16:00:00",
        Latitude: "39.215961",
        Longitude: "-121.061591",
        NumberKilled: "0",
        NumberInjured: 2,
        MotorVehicleInvolvedWithDesc: "BICYCLE",
        "Collision Type Description": "BROADSIDE",
        LightingDescription: "DARK-NO STREET LIGHTS",
        "Weather 1": "RAINING",
      },
    ]);

    const result = await fetchCcrsCrashes({ bbox: NEVADA_COUNTY_BBOX, years: [2025] });

    expect(result.records[0]).toMatchObject({
      severity: "injury",
      collisionType: "angle",
      lighting: "dark_unlighted",
      weather: "rain",
      bicyclistInvolved: true,
      motorcyclistInvolved: false,
      sourceAttributes: {},
    });

    // The columns must actually be in the projection — a mapping over a column
    // nobody asked for reads every row as absent, and every facet as empty.
    const dataQueries = fetchMock.mock.calls
      .map((call) => decodeURIComponent(String(call[0])))
      .filter((u) => u.includes("datastore_search_sql") && !u.includes("count(*)"));
    expect(dataQueries.length).toBeGreaterThan(0);
    for (const column of ["Collision Type Description", "LightingDescription", "Weather 1"]) {
      expect(dataQueries.some((q) => q.includes(`"${column}"`)), column).toBe(true);
    }
  });

  it("stores a missing casualty count as an unclassified crash, not as property damage", async () => {
    stubCrashRows([
      {
        "Collision Id": 1,
        "Crash Date Time": "2025-03-01T00:00:00",
        Latitude: "39.3",
        Longitude: "-121.0",
        // Exactly the 18,967 statewide rows probed on 2026-08-11.
        NumberKilled: null,
        NumberInjured: null,
        "Collision Type Description": "REAR END",
      },
    ]);

    const result = await fetchCcrsCrashes({ bbox: NEVADA_COUNTY_BBOX, years: [2025] });
    expect(result.records[0]).toMatchObject({
      severity: "unknown",
      killedCount: null,
      injuredCount: null,
    });
  });

  it("preserves an unmapped value and counts it instead of dropping it", async () => {
    stubCrashRows([
      {
        "Collision Id": 2,
        "Crash Date Time": "2025-03-02T00:00:00",
        Latitude: "39.3",
        Longitude: "-121.0",
        NumberKilled: "0",
        NumberInjured: 1,
        "Weather 1": "SMOKE (GIFFORD FIRE)",
      },
    ]);

    const result = await fetchCcrsCrashes({ bbox: NEVADA_COUNTY_BBOX, years: [2025] });
    expect(result.records[0].weather).toBe("other");
    // The raw string survives, so a later descriptor can pick it up without a
    // re-ingest being the only way to learn what was lost…
    expect(result.records[0].sourceAttributes).toEqual({ "Weather 1": "SMOKE (GIFFORD FIRE)" });
    // …and the tally travels with the fetch, so the ingest can disclose it.
    expect(result.unmappedByDimension?.weather).toBe(1);
  });
});

describe("the CCRS party fetch", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => __clearFetchJsonResponseCacheForTests());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
    __clearFetchJsonResponseCacheForTests();
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

  it("joins role and injury on the compound key and bands the age", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = decodeURIComponent(String(input));
      if (url.includes("package_show")) {
        return jsonResponse({
          result: {
            resources: [
              { id: "party-2025", name: "Parties_2025" },
              { id: "ivp-2025", name: "InjuredWitnessPassengers_2025" },
            ],
          },
        });
      }
      if (url.includes("party-2025")) {
        return jsonResponse({
          result: {
            records: [
              { CollisionId: "c1", PartyNumber: 1, PartyType: "Driver", StatedAge: 34, Vehicle1TypeDesc: "Motorcycle" },
              { CollisionId: "c1", PartyNumber: 2, PartyType: "Pedestrian", StatedAge: 71, Vehicle1TypeDesc: null },
            ],
          },
        });
      }
      return jsonResponse({
        result: {
          records: [
            // Attaches to the pedestrian party above.
            {
              CollisionId: "c1",
              PartyNumber: 2,
              InjuredPersonType: "Pedestrian",
              StatedAge: 71,
              ExtentOfInjuryCode: "SuspectSerious",
              IsWitnessOnly: "False",
            },
            // A passenger, who is not a party at all — the party is the driver.
            {
              CollisionId: "c1",
              PartyNumber: 3,
              InjuredPersonType: "Passenger",
              StatedAge: 12,
              ExtentOfInjuryCode: "Fatal",
              IsWitnessOnly: "False",
            },
            // A witness is not a casualty and must not become a person row.
            {
              CollisionId: "c1",
              PartyNumber: 4,
              InjuredPersonType: "Other",
              StatedAge: 40,
              ExtentOfInjuryCode: null,
              IsWitnessOnly: "True",
            },
          ],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const parties = await fetchCcrsParties({ crashes: [{ externalId: "c1", collisionYear: 2025 }] });
    const byId = new Map(parties.map((p) => [p.externalPartyId, p]));

    expect(parties).toHaveLength(3);
    expect(byId.get("c1-1")).toMatchObject({ role: "motorcyclist", ageBand: "25_44", injury: "unknown" });
    expect(byId.get("c1-2")).toMatchObject({ role: "pedestrian", ageBand: "65_plus", injury: "suspected_serious" });
    expect(byId.get("c1-3")).toMatchObject({ role: "passenger", ageBand: "under_15", injury: "fatal" });
    expect(byId.has("c1-4")).toBe(false);

    // The exact age never leaves the adapter — not on the record, not anywhere.
    for (const party of parties) {
      expect(JSON.stringify(party)).not.toContain("71");
      expect(JSON.stringify(party)).not.toContain("StatedAge");
    }
  });

  it("throws rather than reporting a collision nobody was in, when the source is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 403,
        headers: new Headers(),
        json: async () => ({}),
        text: async () => "",
      })) as unknown as typeof fetch
    );

    await expect(
      fetchCcrsParties({ crashes: [{ externalId: "c1", collisionYear: 2025 }] })
    ).rejects.toThrow();
  });

  it("skips a crash with no year rather than guessing which year's table to ask", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ result: { resources: [] } }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const parties = await fetchCcrsParties({ crashes: [{ externalId: "c1", collisionYear: null }] });
    expect(parties).toEqual([]);
    // Nothing was even asked: a wrong year's table would answer "nobody".
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
