import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonWithRetryMock = vi.fn();

vi.mock("@/lib/data-sources/http", () => ({
  fetchJsonWithRetry: (...args: unknown[]) => fetchJsonWithRetryMock(...args),
}));

import {
  ACS_YEAR,
  ACS_RETRIEVAL_URL,
  censusReportedFigures,
  censusUniverseUnavailableNote,
  fetchAcsForCounties,
  summarizeCensusTracts,
  type CensusTractData,
} from "@/lib/data-sources/census";
import {
  EQUITY_PROXY_THRESHOLDS,
  evaluateProxyDisadvantage,
  screenEquity,
} from "@/lib/data-sources/equity";

/**
 * THE NUMBERS A TITLE VI FINDING IS MADE OF.
 *
 * ============================================================== WHY THIS EXISTS
 *
 * On 2026-08-06 the equity surface was mutation-audited for the first time,
 * ahead of building Title VI service equity on top of it. 44 mutations were run
 * across the demographics join, the equity screens and the federal designation
 * lookup. 23 SURVIVED — and every one of the 23 was then re-run against the
 * WHOLE 7,471-test suite and survived that too. So these were not gaps in one
 * file; nothing anywhere in the repository was checking them.
 *
 * Of the ten mutations aimed at `screenEquity` — the function whose output is
 * rendered under a literal "Title VI / Environmental Justice Considerations"
 * heading in `/api/report` and narrated as "Title VI considerations: …" in
 * `/api/analysis` — NINE survived. Every threshold could be moved to a value
 * that switches its flag off permanently, the minority flag could stop being
 * emitted at all, and the disadvantaged rule's AND could become an OR, with the
 * suite green throughout.
 *
 * Worse, in `census.ts` the corridor MINORITY SHARE could be replaced by its own
 * complement — a corridor that is 80% minority reporting as 20% — and 7,471
 * tests passed. That is the single number a Title VI analysis turns on.
 *
 * ============================================================ WHAT IT ASSERTS
 *
 * Two rules, and the second is the one that makes this more than a pile of
 * magic numbers:
 *
 *   1. Every threshold that can flip a Title VI flag is PINNED to a value, and
 *      every flag is exercised on BOTH sides of its boundary. A threshold that
 *      is only tested from one side can be moved outward without failing.
 *   2. Every published share is checked as ARITHMETIC on known inputs, not as a
 *      shape. `toBeGreaterThan(0)` cannot tell a minority share from its
 *      complement; `toBe(41.2)` can.
 *
 * ========================================================== WHAT IT IS NOT FOR
 *
 * These thresholds are OpenPlan's own screening proxy. They are deliberately NOT
 * the FTA C 4702.1B thresholds, which are policy an agency adopts rather than a
 * constant OpenPlan picks — that record is per-workspace and is the Title VI
 * service-equity work, not this. Pinning them here says "this number may not
 * move by accident", never "this number is the federal standard".
 */

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — built by field so one universe can be emptied while the rest stand
// ─────────────────────────────────────────────────────────────────────────────

function tract(over: Partial<CensusTractData> = {}): CensusTractData {
  return {
    geoid: "06113000100",
    state: "06",
    county: "113",
    tract: "000100",
    population: 1000,
    medianIncome: 60000,
    totalCommuters: 500,
    transitCommuters: 50,
    walkCommuters: 10,
    bikeCommuters: 5,
    wfhCommuters: 35,
    zeroVehicleHouseholds: 40,
    totalHouseholds: 400,
    pctMinority: 30,
    pctBelowPoverty: 10,
    popWhiteNonHispanic: 700,
    popBelowPoverty: 100,
    povertyUniverse: 1000,
    raceUniverse: 1000,
    ...over,
  };
}

/** The shape `screenEquity` takes, defaulted to a corridor that trips nothing. */
function corridor(over: Partial<Parameters<typeof screenEquity>[0]> = {}) {
  return {
    pctMinority: 10,
    pctBelowPoverty: 5,
    pctZeroVehicle: 2,
    pctTransit: 3,
    medianIncomeWeighted: 90000,
    tracts: [],
    ...over,
  };
}

function proxyTract(over: Partial<Parameters<typeof evaluateProxyDisadvantage>[0]> = {}) {
  return {
    pctMinority: 10,
    pctBelowPoverty: 5,
    medianIncome: 90000,
    zeroVehicleHouseholds: 4,
    totalHouseholds: 400,
    transitCommuters: 10,
    totalCommuters: 500,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("the corridor shares a Title VI finding cites are computed, not shaped", () => {
  it("reports the MINORITY share, not its complement", () => {
    // 1,000 people, 700 of them white non-Hispanic → 30% minority. The inverted
    // form (white / universe) would report 70%, and nothing in the repository
    // could tell the two apart before this assertion existed.
    const summary = summarizeCensusTracts([
      tract({ raceUniverse: 1000, popWhiteNonHispanic: 700 }),
    ]);
    expect(summary.pctMinority).toBe(30);
    expect(summary.pctMinority).not.toBe(70);
  });

  it("sums minority counts across tracts rather than averaging tract percentages", () => {
    // A large mostly-white tract and a small mostly-minority one. Averaging the
    // two tract percentages unweighted gives 50%; the true share is 10.9%.
    const summary = summarizeCensusTracts([
      tract({ geoid: "1", population: 9000, raceUniverse: 9000, popWhiteNonHispanic: 8100 }),
      tract({ geoid: "2", population: 1000, raceUniverse: 1000, popWhiteNonHispanic: 100 }),
    ]);
    // (10000 - 8200) / 10000 = 18%
    expect(summary.pctMinority).toBe(18);
  });

  it("divides poverty by the poverty universe, and counts zero-poverty tracts in it", () => {
    // THE LIVE DEFECT THIS PINS. The denominator used to exclude every tract
    // reporting 0% poverty while the numerator kept summing over all of them, so
    // one poor tract among nine affluent ones reported 30% instead of 3% — a 10x
    // overstatement on a number that trips the >= 20% Title VI poverty flag.
    const summary = summarizeCensusTracts([
      tract({ geoid: "poor", population: 1000, povertyUniverse: 1000, popBelowPoverty: 300 }),
      ...Array.from({ length: 9 }, (_, i) =>
        tract({ geoid: `rich${i}`, population: 1000, povertyUniverse: 1000, popBelowPoverty: 0 })
      ),
    ]);
    expect(summary.pctBelowPoverty).toBe(3);
    expect(summary.pctBelowPoverty).not.toBe(30);
  });

  it("a tract whose poverty universe was suppressed contributes to NEITHER side", () => {
    // The distinction the old discriminator could not make: `povertyUniverse: 0`
    // is "ACS published nothing here", which must not dilute the rate, while
    // `popBelowPoverty: 0` over a real universe is a measurement that must.
    const suppressed = summarizeCensusTracts([
      tract({ geoid: "a", povertyUniverse: 1000, popBelowPoverty: 200 }),
      tract({ geoid: "b", povertyUniverse: 0, popBelowPoverty: 0 }),
    ]);
    expect(suppressed.pctBelowPoverty).toBe(20);

    const measuredZero = summarizeCensusTracts([
      tract({ geoid: "a", povertyUniverse: 1000, popBelowPoverty: 200 }),
      tract({ geoid: "b", povertyUniverse: 1000, popBelowPoverty: 0 }),
    ]);
    expect(measuredZero.pctBelowPoverty).toBe(10);
  });
});

describe("a share is withheld on its OWN universe, never on a neighbouring one", () => {
  it("withholds the minority share when the race universe is empty but people exist", () => {
    const summary = summarizeCensusTracts([
      tract({ population: 1000, raceUniverse: 0, popWhiteNonHispanic: 0 }),
    ]);
    expect(summary.measured.population).toBe(true);
    expect(summary.measured.race).toBe(false);
    // 0% minority would be a finding. Absence is the truth.
    expect(censusReportedFigures(summary).pctMinority).toBeNull();
    expect(censusReportedFigures(summary).totalPopulation).toBe(1000);
  });

  it("withholds the poverty share when the poverty universe is empty but people exist", () => {
    const summary = summarizeCensusTracts([
      tract({ population: 1000, povertyUniverse: 0, popBelowPoverty: 0 }),
    ]);
    expect(summary.measured.population).toBe(true);
    expect(summary.measured.poverty).toBe(false);
    expect(censusReportedFigures(summary).pctBelowPoverty).toBeNull();
  });

  it("withholds zero-vehicle share only when no household universe existed", () => {
    const none = summarizeCensusTracts([tract({ totalHouseholds: 0, zeroVehicleHouseholds: 0 })]);
    expect(none.measured.vehicleAccess).toBe(false);
    expect(censusReportedFigures(none).pctZeroVehicle).toBeNull();

    // A real denominator with a zero numerator IS a measurement and stays one.
    const measured = summarizeCensusTracts([
      tract({ totalHouseholds: 400, zeroVehicleHouseholds: 0 }),
    ]);
    expect(measured.measured.vehicleAccess).toBe(true);
    expect(censusReportedFigures(measured).pctZeroVehicle).toBe(0);
  });

  it("stops weighting by population when the tracts that answered hold no people", () => {
    // Distinct from the empty-tract-list path, which has its own constant. Rows
    // came back, so the count of 0 IS a reading and `totalPopulation` stays 0 —
    // an industrial or park tract really does have no residents. What must NOT
    // survive is `measured.population`, because there is no weight to apply.
    const summary = summarizeCensusTracts([tract({ population: 0 })]);
    expect(summary.measured.tracts).toBe(true);
    expect(summary.measured.population).toBe(false);
    expect(censusReportedFigures(summary).totalPopulation).toBe(0);
  });

  it("withholds median income when no tract reported one", () => {
    const none = summarizeCensusTracts([tract({ medianIncome: null })]);
    expect(none.measured.income).toBe(false);
    expect(censusReportedFigures(none).medianIncome).toBeNull();

    const some = summarizeCensusTracts([tract({ medianIncome: 61000 })]);
    expect(some.measured.income).toBe(true);
    expect(censusReportedFigures(some).medianIncome).toBe(61000);
  });

  it("explains an unmeasured universe and stays silent about a measured one", () => {
    // Inverting this condition would leave every absent figure unexplained while
    // annotating the ones that are fine — and the suite would not have noticed.
    const summary = summarizeCensusTracts([tract({ raceUniverse: 0, popWhiteNonHispanic: 0 })]);
    expect(censusUniverseUnavailableNote(summary, "race")).toMatch(/race and ethnicity/i);
    expect(censusUniverseUnavailableNote(summary, "population")).toBeNull();
    expect(censusUniverseUnavailableNote(summary, "vehicleAccess")).toBeNull();
  });
});

describe("the ACS read clamps what it cannot trust", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clamps ACS suppression sentinels to zero instead of carrying them as counts", async () => {
    // ACS publishes -666666666 for a suppressed estimate. Carried through, it
    // would make a population, a commuter count or a household count wildly
    // negative and every share derived from it meaningless.
    fetchJsonWithRetryMock.mockResolvedValue([
      ["NAME", "B01003_001E", "B17001_001E", "B17001_002E", "state", "county", "tract"],
      ["Tract A", "-666666666", "-666666666", "-666666666", "06", "113", "000100"],
    ]);
    const [row] = await fetchAcsForCounties([{ state: "06", county: "113" }]);
    expect(row.population).toBe(0);
    expect(row.povertyUniverse).toBe(0);
    expect(row.popBelowPoverty).toBe(0);
  });

  it("derives each tract's minority share as non-white over the race universe", () => {
    // THE ASSERTION THAT NEARLY DID NOT EXIST. The corridor-level share is
    // computed from raw counts and so is immune to this — but `pctMinority` on
    // the TRACT is what shades the equity choropleth, what
    // `evaluateProxyDisadvantage` compares to the 50% high-minority threshold,
    // and what the representativeness lane reads. Inverting it here (white over
    // universe) left the whole suite green even after the corridor-level guard
    // above was written, because that guard exercises a different code path.
    fetchJsonWithRetryMock.mockResolvedValue([
      ["NAME", "B03002_001E", "B03002_003E", "B17001_001E", "B17001_002E", "state", "county", "tract"],
      ["Tract A", "1000", "250", "1000", "150", "06", "113", "000100"],
    ]);
    return fetchAcsForCounties([{ state: "06", county: "113" }]).then(([row]) => {
      // 1,000 in the race universe, 250 white non-Hispanic → 75% minority.
      expect(row.pctMinority).toBe(75);
      expect(row.pctMinority).not.toBe(25);
      expect(row.raceUniverse).toBe(1000);
      expect(row.popWhiteNonHispanic).toBe(250);
      // And poverty on its own universe: 150 of 1,000 → 15%.
      expect(row.pctBelowPoverty).toBe(15);
      expect(row.povertyUniverse).toBe(1000);
    });
  });

  it("reports a tract with no race universe as 0% rather than dividing by zero", () => {
    fetchJsonWithRetryMock.mockResolvedValue([
      ["NAME", "B03002_001E", "B03002_003E", "state", "county", "tract"],
      ["Tract A", "0", "0", "06", "113", "000100"],
    ]);
    return fetchAcsForCounties([{ state: "06", county: "113" }]).then(([row]) => {
      expect(row.pctMinority).toBe(0);
      expect(row.raceUniverse).toBe(0);
      // The 0 is disowned upstream: summarize marks the race universe unmeasured.
      expect(summarizeCensusTracts([row]).measured.race).toBe(false);
    });
  });

  it("stamps provenance from the vintage it actually queried", () => {
    // The retrieval URL is DERIVED from ACS_YEAR rather than restated, so a
    // vintage bump cannot leave the published provenance naming a survey the
    // figures did not come from.
    expect(ACS_RETRIEVAL_URL).toContain(`/${ACS_YEAR}/`);
    expect(ACS_YEAR).toMatch(/^\d{4}$/);
    // Pinned so moving the vintage is a deliberate two-line edit rather than
    // something that happens during unrelated work. Equity figures already
    // published carry the vintage they were read at; a silent change would make
    // an old finding and a new one differ with no recorded reason. Bumping to a
    // newer 5-year release means changing this line and the constant together.
    expect(ACS_YEAR).toBe("2023");
  });
});

describe("every proxy threshold is pinned, and every flag tested on both sides", () => {
  it("pins the threshold table itself", () => {
    // Each of these was moved in the audit to a value that switches its flag off
    // permanently, and the whole suite stayed green.
    expect(EQUITY_PROXY_THRESHOLDS).toEqual({
      lowIncomeMedian: 50000,
      highPovertyPct: 30,
      highMinorityPct: 50,
      lowVehicleAccessPct: 10,
      transitDependencyPct: 15,
    });
  });

  it("flags a tract low-income strictly below the median threshold", () => {
    expect(evaluateProxyDisadvantage(proxyTract({ medianIncome: 49999 })).lowIncome).toBe(true);
    expect(evaluateProxyDisadvantage(proxyTract({ medianIncome: 50000 })).lowIncome).toBe(false);
    // A tract that reported no income is not low-income by default.
    expect(evaluateProxyDisadvantage(proxyTract({ medianIncome: null })).lowIncome).toBe(false);
  });

  it("flags high poverty at or above 30%", () => {
    expect(evaluateProxyDisadvantage(proxyTract({ pctBelowPoverty: 30 })).highPoverty).toBe(true);
    expect(evaluateProxyDisadvantage(proxyTract({ pctBelowPoverty: 29.9 })).highPoverty).toBe(false);
  });

  it("flags high minority at or above 50%", () => {
    expect(evaluateProxyDisadvantage(proxyTract({ pctMinority: 50 })).highMinority).toBe(true);
    expect(evaluateProxyDisadvantage(proxyTract({ pctMinority: 49.9 })).highMinority).toBe(false);
  });

  it("flags low vehicle access at or above 10% of households", () => {
    const at = proxyTract({ zeroVehicleHouseholds: 40, totalHouseholds: 400 });
    const below = proxyTract({ zeroVehicleHouseholds: 39, totalHouseholds: 400 });
    expect(evaluateProxyDisadvantage(at).lowVehicleAccess).toBe(true);
    expect(evaluateProxyDisadvantage(below).lowVehicleAccess).toBe(false);
  });

  it("flags transit dependency at or above 15% of commuters", () => {
    const at = proxyTract({ transitCommuters: 75, totalCommuters: 500 });
    const below = proxyTract({ transitCommuters: 74, totalCommuters: 500 });
    expect(evaluateProxyDisadvantage(at).transitDependency).toBe(true);
    expect(evaluateProxyDisadvantage(below).transitDependency).toBe(false);
  });

  it("requires low income AND a burden — never either one alone", () => {
    // The audit turned this AND into an OR and nothing failed. An OR would mark
    // an affluent tract with a 50% minority share "disadvantaged", which both
    // overstates the count and, being a proxy, misrepresents what was screened.
    const burdenOnly = proxyTract({ medianIncome: 90000, pctMinority: 80 });
    expect(evaluateProxyDisadvantage(burdenOnly).highMinority).toBe(true);
    expect(evaluateProxyDisadvantage(burdenOnly).disadvantaged).toBe(false);

    const incomeOnly = proxyTract({ medianIncome: 30000 });
    expect(evaluateProxyDisadvantage(incomeOnly).lowIncome).toBe(true);
    expect(evaluateProxyDisadvantage(incomeOnly).disadvantaged).toBe(false);

    const both = proxyTract({ medianIncome: 30000, pctMinority: 80 });
    expect(evaluateProxyDisadvantage(both).disadvantaged).toBe(true);
  });

  it("reads an absent denominator as zero, never as a maximal burden", () => {
    // `pct(n, 0)` returning 100 would make every tract with no household or
    // commuter universe trip both burden flags at once.
    const noUniverses = proxyTract({
      zeroVehicleHouseholds: 0,
      totalHouseholds: 0,
      transitCommuters: undefined,
      totalCommuters: undefined,
    });
    const result = evaluateProxyDisadvantage(noUniverses);
    expect(result.zeroVehiclePct).toBe(0);
    expect(result.transitCommutePct).toBe(0);
    expect(result.lowVehicleAccess).toBe(false);
    expect(result.transitDependency).toBe(false);
  });
});

describe("every Title VI flag is emitted by the condition it names", () => {
  // Each flag is asserted present when its indicator trips and ABSENT when it
  // does not. The audit deleted the minority flag's push entirely and the suite
  // stayed green, so presence alone is not enough — absence must be checked too.
  const cases: Array<{
    name: string;
    trips: Parameters<typeof screenEquity>[0];
    quiet: Parameters<typeof screenEquity>[0];
    fragment: RegExp;
  }> = [
    {
      name: "minority share at or above 40%",
      trips: corridor({ pctMinority: 40 }),
      quiet: corridor({ pctMinority: 39.9 }),
      fragment: /high proportion of minority residents/i,
    },
    {
      name: "median income below the low-income threshold",
      trips: corridor({ medianIncomeWeighted: 49999 }),
      quiet: corridor({ medianIncomeWeighted: 50000 }),
      fragment: /median household income is below/i,
    },
    {
      name: "poverty rate at or above 20%",
      trips: corridor({ pctBelowPoverty: 20 }),
      quiet: corridor({ pctBelowPoverty: 19.9 }),
      fragment: /poverty rate indicates concentrated economic burden/i,
    },
    {
      name: "zero-vehicle share at or above 10%",
      trips: corridor({ pctZeroVehicle: 10 }),
      quiet: corridor({ pctZeroVehicle: 9.9 }),
      fragment: /lacks vehicle access/i,
    },
    {
      name: "transit commute share at or above 12%",
      trips: corridor({ pctTransit: 12 }),
      quiet: corridor({ pctTransit: 11.9 }),
      fragment: /Transit-dependent households/i,
    },
  ];

  for (const testCase of cases) {
    it(`raises and withholds the flag for ${testCase.name}`, () => {
      const raised = screenEquity(testCase.trips).title6Flags;
      expect(raised.some((flag) => testCase.fragment.test(flag))).toBe(true);

      const withheld = screenEquity(testCase.quiet).title6Flags;
      expect(withheld.some((flag) => testCase.fragment.test(flag))).toBe(false);
    });
  }

  it("says nothing at all about a corridor that trips no indicator", () => {
    expect(screenEquity(corridor()).title6Flags).toEqual([]);
  });

  it("does not claim a proxy-disadvantaged finding for a study area with no tracts", () => {
    const screening = screenEquity(corridor({ tracts: [] }));
    expect(screening.totalTracts).toBe(0);
    expect(screening.disadvantagedTracts).toBe(0);
    // `disadvantagedTracts >= 0` is always true — the audit made exactly that
    // change and nothing failed, so an empty study area would have reported a
    // proxy finding about tracts it never read.
    expect(screening.proxyDisadvantagedFlag).toBe(false);
  });

  it("counts each tract flag from the shared evaluator", () => {
    const screening = screenEquity(
      corridor({
        tracts: [
          // low income + high minority → disadvantaged
          {
            geoid: "1",
            pctMinority: 60,
            pctBelowPoverty: 5,
            medianIncome: 40000,
            zeroVehicleHouseholds: 4,
            totalHouseholds: 400,
          },
          // high minority alone → burdened but NOT disadvantaged
          {
            geoid: "2",
            pctMinority: 60,
            pctBelowPoverty: 5,
            medianIncome: 90000,
            zeroVehicleHouseholds: 4,
            totalHouseholds: 400,
          },
        ],
      })
    );
    expect(screening.totalTracts).toBe(2);
    expect(screening.highMinorityTracts).toBe(2);
    expect(screening.disadvantagedTracts).toBe(1);
    expect(screening.pctDisadvantaged).toBe(50);
    expect(screening.proxyDisadvantagedFlag).toBe(true);
  });
});

describe("the map and the scorecard share ONE proxy evaluator", () => {
  it("agrees tract by tract with the count screenEquity reports", () => {
    // `census-geometry.ts` used to reimplement this rule with its own inline
    // literals, kept in step by a comment. Both now call
    // `evaluateProxyDisadvantage`, so this asserts the property that matters:
    // the number of tracts the scorecard calls disadvantaged is exactly the
    // number the map would shade.
    const tracts = [
      { geoid: "a", pctMinority: 60, pctBelowPoverty: 35, medianIncome: 30000, zeroVehicleHouseholds: 80, totalHouseholds: 400 },
      { geoid: "b", pctMinority: 10, pctBelowPoverty: 5, medianIncome: 30000, zeroVehicleHouseholds: 4, totalHouseholds: 400 },
      { geoid: "c", pctMinority: 90, pctBelowPoverty: 40, medianIncome: 95000, zeroVehicleHouseholds: 90, totalHouseholds: 400 },
    ];
    const shadedByTheMap = tracts.filter((t) => evaluateProxyDisadvantage(t).disadvantaged).length;
    const countedByTheScorecard = screenEquity(corridor({ tracts })).disadvantagedTracts;
    expect(countedByTheScorecard).toBe(shadedByTheMap);
    expect(shadedByTheMap).toBe(1);
  });
});

describe("the screening proxy never becomes a federal designation", () => {
  it("defaults to not_determined however disadvantaged the proxy looks", () => {
    const screening = screenEquity(
      corridor({
        pctMinority: 95,
        pctBelowPoverty: 60,
        medianIncomeWeighted: 20000,
        tracts: [
          { geoid: "1", pctMinority: 95, pctBelowPoverty: 60, medianIncome: 20000, zeroVehicleHouseholds: 200, totalHouseholds: 400 },
        ],
      })
    );
    expect(screening.proxyDisadvantagedFlag).toBe(true);
    expect(screening.federalJustice40.status).toBe("not_determined");
    expect(screening.source).toBe("proxy-census");
  });

  it("carries no linguistic-isolation indicator, because none is measured", () => {
    // A `linguisticallyIsolated: false` lived here with no consumer. Limited
    // English Proficiency is a genuine Title VI factor, so a hardcoded negative
    // is a false finding waiting for its first reader. Measuring it needs ACS
    // B16004 / C16002, which this module does not fetch — until then the honest
    // representation is that the field does not exist.
    const indicators = screenEquity(corridor()).ejIndicators as Record<string, unknown>;
    expect(indicators).not.toHaveProperty("linguisticallyIsolated");
    expect(Object.keys(indicators).sort()).toEqual([
      "highMinority",
      "highPoverty",
      "lowIncome",
      "lowVehicleAccess",
      "transitDependent",
    ]);
  });
});
