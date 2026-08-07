/**
 * Corridor lane honesty: a figure nobody measured may not be presented as a
 * finding, and the run's decision-use boundary must be reachable by a planner.
 *
 * WHY THIS TEST IS BUILT AND NOT DESCRIBED. The failure this lane keeps shipping
 * is a hand-written fixture describing a state the product cannot produce, or a
 * state it produces constantly that the fixture never shows. So the metrics under
 * test here are not typed out — they are the metrics `POST /api/analysis` actually
 * persists, with `@/lib/data-sources/census` (the summarizer and the
 * measured/not-measured boundary), `@/lib/data-sources/scoring`,
 * `@/lib/data-sources/equity` and `@/lib/ai/interpret` all REAL. Only the network
 * fetches and the database are doubled. That same object is then handed to the
 * real `ExploreResultsBoard`, so what a planner sees is derived from what the API
 * writes, end to end.
 *
 * The four defects this pins:
 *   1. `summarizeCensusTracts([])` returns a fully-zeroed summary, and `pct(n, 0)`
 *      returns 0 — so an unanswered ACS read was narrated and CITED as
 *      "Population: 0", "0% transit, 0% walk, 0% bike".
 *   2. `computeSafety` returns null when no crash source answered, and the score
 *      tile interpolated it: `${null}` renders the four characters "null".
 *   3. `decisionUseStatus` was stamped on every run and read by nothing.
 *   4. A run whose metrics carry no `decisionUseStatus` (every run made before the
 *      field existed) must say NOT RECORDED — never inherit today's default.
 */

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  censusReportedFigures,
  summarizeCensusTracts,
  type CensusTractData,
} from "@/lib/data-sources/census";
import { buildInterpretationFacts } from "@/lib/ai/interpret";
import { describeCrashSafety, type CrashSummary } from "@/lib/data-sources/crashes";
import { notDeterminedJustice40 } from "@/lib/data-sources/equity-designation/types";
import { CORRIDOR_DECISION_USE_STATUS } from "@/lib/analysis/decision-use";

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

// ---------------------------------------------------------------------------
// Route doubles: the network and the database only.
// ---------------------------------------------------------------------------

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const authGetUserMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));
const runsInsertMock = vi.fn();

const userFromMock = vi.fn((table: string) => {
  if (table === "workspace_members") return { select: membershipSelectMock };
  throw new Error(`Unexpected user-client table: ${table}`);
});

const serviceFromMock = vi.fn((table: string) => {
  if (table === "runs") return { insert: runsInsertMock };
  throw new Error(`Unexpected service-client table: ${table}`);
});

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const fetchCensusForCorridorMock = vi.fn();
const fetchTractOverlayFeaturesMock = vi.fn();
const fetchLODESForCorridorMock = vi.fn();
const fetchCrashesForBboxMock = vi.fn();
const fetchCrashPointFeaturesForBboxMock = vi.fn();
const fetchTransitAccessForBboxMock = vi.fn();
const resolveJustice40ForTractsMock = vi.fn();
const generateGrantInterpretationMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));

// Only the ACS HTTP call is stubbed. `summarizeCensusTracts`,
// `censusReportedFigures` and `censusUniverseUnavailableNote` stay REAL — they
// are the boundary under test, and doubling them would leave this file asserting
// about a double.
vi.mock("@/lib/data-sources/census", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-sources/census")>()),
  fetchCensusForCorridor: (...args: unknown[]) => fetchCensusForCorridorMock(...args),
}));

vi.mock("@/lib/data-sources/census-geometry", () => ({
  fetchTractOverlayFeatures: (...args: unknown[]) => fetchTractOverlayFeaturesMock(...args),
}));

vi.mock("@/lib/data-sources/lodes", () => ({
  fetchLODESForCorridor: (...args: unknown[]) => fetchLODESForCorridorMock(...args),
}));

vi.mock("@/lib/data-sources/crashes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-sources/crashes")>()),
  fetchCrashesForBbox: (...args: unknown[]) => fetchCrashesForBboxMock(...args),
  fetchCrashPointFeaturesForBbox: (...args: unknown[]) =>
    fetchCrashPointFeaturesForBboxMock(...args),
}));

vi.mock("@/lib/data-sources/transit", () => ({
  fetchTransitAccessForBbox: (...args: unknown[]) => fetchTransitAccessForBboxMock(...args),
}));

// The designation registry reads a bundled national dataset; stubbed for speed
// with the SAME `not_determined` value its own helper produces.
vi.mock("@/lib/data-sources/equity-designation/registry", () => ({
  resolveJustice40ForTracts: (...args: unknown[]) => resolveJustice40ForTractsMock(...args),
}));

vi.mock("@/lib/ai/interpret", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/interpret")>()),
  generateGrantInterpretation: (...args: unknown[]) => generateGrantInterpretationMock(...args),
}));

// Deliberately NOT mocked, because they are the code under test:
//   @/lib/data-sources/scoring       (safetyScore null when nothing was observed)
//   @/lib/data-sources/equity        (screenEquity)
//   @/lib/accessibility/isochrone    (classifyWalkBikeAccess)
//   @/lib/analysis/decision-use      (the boundary being surfaced)
//   @/lib/ai/interpret               (buildInterpretationFacts — the citability gate)

import { POST as postAnalysis } from "@/app/api/analysis/route";
import { ExploreResultsBoard } from "@/app/(app)/explore/_components/explore-results-board";
import type { AnalysisResult } from "@/app/(app)/explore/_components/_types";
import type { MapViewState } from "@/lib/analysis/map-view-state";

const CORRIDOR = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-121.5, 39.1],
      [-121.4, 39.1],
      [-121.4, 39.2],
      [-121.5, 39.1],
    ],
  ],
};

function analysisRequest() {
  return new NextRequest("http://localhost/api/analysis", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: WORKSPACE_ID,
      queryText: "Corridor with no data behind it",
      corridorGeojson: CORRIDOR,
    }),
  });
}

/**
 * A real ACS tract row. Built by field so a test can make ONE universe empty and
 * leave the rest measured — which is the case the coverage flags exist for.
 */
function tract(over: Partial<CensusTractData> = {}): CensusTractData {
  return {
    geoid: "06000000001",
    state: "06",
    county: "000",
    tract: "000001",
    population: 5000,
    medianIncome: 62000,
    totalCommuters: 2000,
    transitCommuters: 60,
    walkCommuters: 40,
    bikeCommuters: 20,
    wfhCommuters: 180,
    zeroVehicleHouseholds: 90,
    totalHouseholds: 1800,
    pctMinority: 41.2,
    pctBelowPoverty: 14.3,
    popWhiteNonHispanic: 2940,
    popBelowPoverty: 715,
    // Both universes equal the population here, so the derived shares match the
    // pctMinority / pctBelowPoverty above: (5000-2940)/5000 = 41.2%,
    // 715/5000 = 14.3%. A test that wants an unmeasured universe zeroes one.
    povertyUniverse: 5000,
    raceUniverse: 5000,
    ...over,
  };
}

/** An unobserved CrashSummary, with its narrative line from the REAL describer. */
function unobservedCrashes(): CrashSummary {
  const core = {
    observed: false as const,
    source: "out-of-coverage",
    sourceLabel: "No registered crash source",
    attribution: null,
    severityCompleteness: null,
    totalFatalCrashes: 0,
    totalFatalities: 0,
    pedestrianFatalities: 0,
    bicyclistFatalities: 0,
    severeInjuryCrashes: null,
    totalInjuryCrashes: null,
    yearsQueried: [],
    crashesPerSquareMile: 0,
    crashDensityBasis: "none" as const,
    reportedTotal: 0,
    mappedTotal: 0,
    truncated: false,
    points: [],
    checkedSources: [],
    unavailableReason: null,
  };
  return {
    ...core,
    sourceSnapshot: { state: "out-of-coverage", note: "No crash source covers this study area." },
    narrativeLine: describeCrashSafety(core as never),
  } as unknown as CrashSummary;
}

type PersistedRun = {
  summary_text: string;
  metrics: Record<string, unknown>;
};

/** Drive the real route once and hand back what it actually persisted. */
async function runAnalysisWithNoCensusData(): Promise<PersistedRun> {
  // The REAL summarizer on an empty tract set — the state the ACS lane produces
  // when nothing answered, not a description of it.
  fetchCensusForCorridorMock.mockResolvedValue(summarizeCensusTracts([]));
  const response = await postAnalysis(analysisRequest());
  expect(response.status).toBe(200);
  expect(runsInsertMock).toHaveBeenCalledTimes(1);
  return runsInsertMock.mock.calls[0][0] as PersistedRun;
}

const MAP_VIEW_STATE: MapViewState = {
  tractMetric: "minority",
  showTracts: true,
  showCrashes: true,
  crashSeverityFilter: "all",
  crashUserFilter: "all",
  activeDatasetOverlayId: null,
  activeOverlayContext: null,
};

/** Wrap what the API persisted in the shape the board reads. Metrics untouched. */
function boardResultFrom(persisted: PersistedRun, metricOverrides?: Record<string, unknown>): AnalysisResult {
  return {
    runId: "run-under-test",
    title: "Corridor with no data behind it",
    createdAt: "2026-08-03T09:00:00.000Z",
    summary: persisted.summary_text,
    geojson: { type: "FeatureCollection", features: [] },
    metrics: {
      ...(persisted.metrics as AnalysisResult["metrics"]),
      ...(metricOverrides ?? {}),
    } as AnalysisResult["metrics"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: userFromMock });
  createServiceRoleClientMock.mockReturnValue({ from: serviceFromMock });
  membershipMaybeSingleMock.mockResolvedValue({
    data: { workspace_id: WORKSPACE_ID, role: "owner" },
    error: null,
  });
  runsInsertMock.mockResolvedValue({ error: null });

  fetchTractOverlayFeaturesMock.mockResolvedValue([]);
  fetchCrashPointFeaturesForBboxMock.mockResolvedValue([]);
  fetchCrashesForBboxMock.mockResolvedValue(unobservedCrashes());
  fetchTransitAccessForBboxMock.mockResolvedValue({
    totalStops: 0,
    stopsPerSqMile: null,
    busStops: 0,
    railStations: 0,
    ferryStops: 0,
    accessTier: null,
    source: "none",
    observed: false,
    unavailableReason: "No transit source answered for this study area.",
  });
  fetchLODESForCorridorMock.mockResolvedValue({
    totalJobs: 0,
    jobsPerResident: 0,
    source: "acs-estimate",
  });
  resolveJustice40ForTractsMock.mockResolvedValue(notDeterminedJustice40(0));
  generateGrantInterpretationMock.mockResolvedValue({
    text: "",
    source: "summary-fallback",
    model: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    estimatedCostUsd: null,
    fallbackReason: "missing_api_key",
    droppedSentenceCount: 0,
    droppedSentenceIssues: [],
  });
});

// ---------------------------------------------------------------------------

describe("census measurement coverage (real summarizer, real boundary)", () => {
  it("disowns every figure when no tract answered", () => {
    const summary = summarizeCensusTracts([]);
    // Exhaustive on purpose: a new universe added without a `false` here means
    // something is claiming to be measured when nothing was read.
    expect(summary.measured).toEqual({
      tracts: false,
      population: false,
      race: false,
      poverty: false,
      commuteMode: false,
      vehicleAccess: false,
      income: false,
    });

    const reported = censusReportedFigures(summary);
    // Not one of these may be a number: nothing was read.
    expect(Object.values(reported).every((value) => value === null)).toBe(true);
  });

  it("keeps a MEASURED zero as a finding", () => {
    // A real corridor where 2,000 people commute and none of them take transit.
    // That is a fact about the place and must survive as the number 0.
    const summary = summarizeCensusTracts([tract({ transitCommuters: 0 })]);
    expect(summary.measured.commuteMode).toBe(true);
    expect(censusReportedFigures(summary).pctTransit).toBe(0);
  });

  it("separates universes: a tract with people but no commuter universe", () => {
    const summary = summarizeCensusTracts([tract({ totalCommuters: 0, transitCommuters: 0 })]);
    const reported = censusReportedFigures(summary);

    expect(reported.totalPopulation).toBe(5000);
    expect(reported.pctMinority).not.toBeNull();
    // No denominator, so no share — not a share of zero.
    expect(reported.pctTransit).toBeNull();
    expect(reported.pctWalk).toBeNull();
  });
});

describe("unmeasured census figures are uncitable (real grounding fact builder)", () => {
  it("gives the model no fact to cite for a figure nobody measured", () => {
    const reported = censusReportedFigures(summarizeCensusTracts([]));
    const facts = buildInterpretationFacts({ ...reported }, "");
    const ids = facts.map((fact) => fact.fact_id);

    expect(ids).not.toContain("m_totalPopulation");
    expect(ids).not.toContain("m_pctTransit");
    expect(ids).not.toContain("m_pctZeroVehicle");
  });

  it("still offers a measured zero as a citable fact", () => {
    const reported = censusReportedFigures(summarizeCensusTracts([tract({ transitCommuters: 0 })]));
    const facts = buildInterpretationFacts({ ...reported }, "");

    expect(facts).toContainEqual({ fact_id: "m_pctTransit", claim_text: "pctTransit: 0" });
  });
});

describe("POST /api/analysis with nothing measured", () => {
  it("persists nulls, not zeros, for every unmeasured census figure", async () => {
    const persisted = await runAnalysisWithNoCensusData();

    expect(persisted.metrics.totalPopulation).toBeNull();
    expect(persisted.metrics.medianIncome).toBeNull();
    expect(persisted.metrics.pctTransit).toBeNull();
    expect(persisted.metrics.pctWalk).toBeNull();
    expect(persisted.metrics.pctBike).toBeNull();
    expect(persisted.metrics.pctZeroVehicle).toBeNull();
    expect(persisted.metrics.pctMinority).toBeNull();
    expect(persisted.metrics.censusMeasuredUniverses).toMatchObject({ tracts: false });
  });

  it("narrates the gap instead of narrating the placeholder zeros", async () => {
    const { summary_text: summary } = await runAnalysisWithNoCensusData();

    expect(summary).toContain("**Demographics:** Not measured.");
    expect(summary).toContain("**Commute Mode Share:** Not measured.");
    expect(summary).toContain("**Vehicle Access:** Not measured.");
    expect(summary).toContain("population: not measured");

    // The exact sentences that used to ship for an unread corridor.
    expect(summary).not.toContain("0% transit");
    expect(summary).not.toContain("0% minority");
    expect(summary).not.toContain("0% of households have zero vehicles");
  });

  it("never writes the literal word null into the deterministic summary", async () => {
    const { summary_text: summary } = await runAnalysisWithNoCensusData();

    // `computeSafety` really does return null here — the crash summary is
    // unobserved and scoring is not mocked — so this is the live path.
    expect(summary).not.toContain("null");
    expect(summary).toContain("Safety: not scored (no crash source answered)");
  });

  it("keeps the unmeasured demographics out of the model's citable fact list", async () => {
    const persisted = await runAnalysisWithNoCensusData();
    const ids = buildInterpretationFacts(persisted.metrics, persisted.summary_text).map(
      (fact) => fact.fact_id
    );

    expect(ids).not.toContain("m_totalPopulation");
    expect(ids).not.toContain("m_pctTransit");
    expect(ids).not.toContain("m_pctMinority");
  });

  it("stamps the decision-use boundary the card and report read", async () => {
    const persisted = await runAnalysisWithNoCensusData();
    expect(persisted.metrics.decisionUseStatus).toBe(CORRIDOR_DECISION_USE_STATUS);
  });
});

describe("the results board a planner actually sees, fed by what the API persisted", () => {
  function renderBoard(result: AnalysisResult) {
    return render(
      <ExploreResultsBoard
        analysisResult={result}
        comparisonRun={null}
        queryText="Corridor with no data behind it"
        currentMapViewState={MAP_VIEW_STATE}
        onClearComparison={vi.fn()}
        onError={vi.fn()}
      />
    );
  }

  it("renders no tile containing the literal string null", async () => {
    const persisted = await runAnalysisWithNoCensusData();
    // Guard the guard: this run really does carry a null safety score, so the
    // assertion below is exercising the case rather than passing vacuously.
    expect(persisted.metrics.safetyScore).toBeNull();

    const { container } = renderBoard(boardResultFrom(persisted));

    expect(container.textContent).not.toMatch(/\bnull\b/);
    expect(screen.queryByText("null")).not.toBeInTheDocument();
  });

  it("says the safety score was not measured, and why", async () => {
    const persisted = await runAnalysisWithNoCensusData();
    renderBoard(boardResultFrom(persisted));

    const safetyTile = screen.getByText("Safety").closest("div")?.parentElement as HTMLElement;
    expect(within(safetyTile).getByText("Not measured")).toBeInTheDocument();
    expect(
      screen.getByText(/No crash source covered this study area, so no safety score was produced/)
    ).toBeInTheDocument();
  });

  it("says the demographics were not measured rather than showing a zero", async () => {
    const persisted = await runAnalysisWithNoCensusData();
    renderBoard(boardResultFrom(persisted));

    const populationTile = screen.getByText("Population").closest("div")
      ?.parentElement as HTMLElement;
    expect(within(populationTile).getByText("Not measured")).toBeInTheDocument();
    expect(within(populationTile).queryByText("0")).not.toBeInTheDocument();
    expect(
      screen.getByText(/this is an unanswered read, not a count of zero/)
    ).toBeInTheDocument();
  });

  it("puts the run's decision-use boundary in front of the planner", async () => {
    const persisted = await runAnalysisWithNoCensusData();
    renderBoard(boardResultFrom(persisted));

    // The badge label AND the sentence — a tooltip alone would not be reachable.
    expect(screen.getAllByText("Decision use: concept-level").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Do not use it as the technical basis for a CEQA determination/)
    ).toBeInTheDocument();
  });

  it("says NOT RECORDED for a run that predates the boundary", async () => {
    const persisted = await runAnalysisWithNoCensusData();
    const legacy = boardResultFrom(persisted);
    delete (legacy.metrics as Record<string, unknown>).decisionUseStatus;

    renderBoard(legacy);

    expect(screen.getAllByText("Decision use: not recorded").length).toBeGreaterThan(0);
    expect(screen.getByText(/its permitted use is unknown rather than unrestricted/)).toBeInTheDocument();
    // The absent field must not silently inherit today's default.
    expect(screen.queryByText("Decision use: concept-level")).not.toBeInTheDocument();
  });

  /**
   * Nulling the FIGURES did not null the SCORES, and the scores are the biggest
   * numbers on the page. Driving the real route with an empty ACS result really
   * does produce Accessibility 5 / Equity 0 / Overall 3, because
   * `computeAccessibility` and `computeEquity` consume the summarizer's
   * placeholder zeros rather than the reported figures. Until that is fixed in
   * the scoring engine — a separate change — every surface that shows one of
   * those numbers must say what it was built from.
   */
  it("does not present a score built on an unread census as a measurement", async () => {
    const persisted = await runAnalysisWithNoCensusData();
    // Guard the guard: these are the real values the route produced. If scoring
    // is later fixed to return null here, this assertion fails and tells the
    // next reader to retire the caveat rather than leaving it lying about.
    expect(typeof persisted.metrics.equityScore).toBe("number");
    expect(typeof persisted.metrics.accessibilityScore).toBe("number");

    renderBoard(boardResultFrom(persisted));

    const caveat = /computed as though every demographic input were zero/;
    // Accessibility, Equity and the composite each carry it — the composite most
    // of all, because it is the number that gets quoted.
    expect(screen.getAllByText(caveat).length).toBeGreaterThanOrEqual(3);

    const equityTile = screen.getByText("Equity").closest("div")?.parentElement as HTMLElement;
    expect(within(equityTile).getByText(caveat)).toBeInTheDocument();
  });

  it("stays quiet about the demographic inputs when the census DID answer", async () => {
    fetchCensusForCorridorMock.mockResolvedValue(summarizeCensusTracts([tract()]));
    const response = await postAnalysis(analysisRequest());
    expect(response.status).toBe(200);
    const persisted = runsInsertMock.mock.calls[0][0] as PersistedRun;
    expect(persisted.metrics.censusMeasuredUniverses).toMatchObject({ tracts: true });

    renderBoard(boardResultFrom(persisted));

    // Over-warning is its own defect: a caveat on every run teaches a planner to
    // ignore it, and this one is false when the read succeeded.
    expect(
      screen.queryAllByText(/computed as though every demographic input were zero/)
    ).toHaveLength(0);
  });

  it("claims nothing about a legacy run that recorded no census coverage at all", async () => {
    const persisted = await runAnalysisWithNoCensusData();
    const legacy = boardResultFrom(persisted);
    // The three eras of coverage signal, all absent — the oldest runs in the
    // database. "We cannot tell" is not "there was no data".
    delete (legacy.metrics as Record<string, unknown>).censusMeasuredUniverses;
    delete (legacy.metrics as Record<string, unknown>).dataQuality;
    delete (legacy.metrics as Record<string, unknown>).tractCount;

    renderBoard(legacy);

    expect(
      screen.queryAllByText(/computed as though every demographic input were zero/)
    ).toHaveLength(0);
  });
});
