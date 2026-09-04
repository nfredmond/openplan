import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  OSM_STOP_INVENTORY_METHOD,
  gtfsServiceLevelMethod,
} from "@/lib/data-sources/transit/method";
import {
  CORRIDOR_DECISION_USE_STATUS,
  resolveDecisionUseDisclosure,
} from "@/lib/analysis/decision-use";

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

/** Raw model draft as generateGrantInterpretation returns it: prose WITH
 * [fact:N] provenance tokens plus faithfulness-belt drop disclosures. */
const RAW_AI_TEXT =
  "The corridor has 5000 residents. [fact:m_population] It supports 1000 jobs. [fact:m_jobs]";

const INTERPRETATION_RESULT = {
  text: RAW_AI_TEXT,
  source: "ai" as const,
  model: "claude-haiku-4-5-20251001",
  inputTokens: 500,
  outputTokens: 200,
  totalTokens: 700,
  estimatedCostUsd: 0.0015,
  fallbackReason: null,
  droppedSentenceCount: 2,
  droppedSentenceIssues: [
    "missing_citation: Uncited filler.",
    "unfaithful_citation: Bad figure.",
  ],
};

const CENSUS_FIXTURE = {
  tracts: [],
  totalPopulation: 5000,
  totalCommuters: 2100,
  medianIncomeWeighted: 62000,
  pctMinority: 41.2,
  pctBelowPoverty: 14.3,
  pctTransit: 3.1,
  pctWalk: 2.4,
  pctBike: 1.1,
  pctWfh: 8.6,
  pctZeroVehicle: 6.2,
  clip: { status: "clipped" as const, corridorTracts: 3, countyTracts: 12, counties: 1 },
  // Every ACS universe answered — this fixture is a fully-measured corridor, so
  // the route narrates its figures rather than reporting them as not measured.
  measured: {
    tracts: true,
    population: true,
    commuteMode: true,
    vehicleAccess: true,
    income: true,
  },
};

const LODES_FIXTURE = {
  totalJobs: 1000,
  jobsPerResident: 0.2,
  source: "acs-estimate",
};

const TRANSIT_FIXTURE = {
  observed: true,
  totalStops: 12,
  stopsPerSqMile: 4.5,
  busStops: 11,
  railStations: 1,
  ferryStops: 0,
  accessTier: "moderate",
  source: "osm-overpass",
  frequentServiceShare: null,
  frequentServiceStops: null,
  frequentServiceHeadwayMinutes: null,
  truncated: false,
  method: OSM_STOP_INVENTORY_METHOD,
  contributingSources: [],
  caveats: [],
  narrativeLine: "**Transit Access:** 12 stops (4.5/sq mi). Access tier: moderate.",
  sourceSnapshot: { source: "osm-overpass", observed: true, method: OSM_STOP_INVENTORY_METHOD },
};

/**
 * The same corridor, screened against the workspace's own ingested feed.
 *
 * The figures differ from `TRANSIT_FIXTURE` because the MEASUREMENT differs, and
 * the assertions below are about what the run records so a reader can see that.
 */
const GTFS_TRANSIT_FIXTURE = {
  ...TRANSIT_FIXTURE,
  totalStops: 7,
  stopsPerSqMile: 2.6,
  busStops: null,
  railStations: null,
  ferryStops: null,
  source: "gtfs-feed",
  frequentServiceShare: 0.25,
  frequentServiceStops: 2,
  frequentServiceHeadwayMinutes: 15,
  method: gtfsServiceLevelMethod(true),
  contributingSources: [{ id: "feed-1", label: "Regional Transit", serviceEndDate: "2025-04-05" }],
  caveats: ["These are trip counts derived from a published schedule for one service day."],
  narrativeLine: "**Transit Access:** 7 stops (2.6/sq mi). Access tier: medium.",
  sourceSnapshot: {
    source: "gtfs-feed",
    observed: true,
    method: gtfsServiceLevelMethod(true),
    caveats: ["These are trip counts derived from a published schedule for one service day."],
  },
};

// source deliberately NOT "switrs-local" so the crash-point overlay fetch is skipped.
const CRASHES_FIXTURE = {
  source: "fars-api",
  yearsQueried: [2021, 2022],
  totalFatalCrashes: 3,
  totalFatalities: 3,
  pedestrianFatalities: 1,
  bicyclistFatalities: 0,
  severeInjuryCrashes: 5,
  totalInjuryCrashes: 20,
  crashesPerSquareMile: 1.7,
};

const EQUITY_FIXTURE = {
  disadvantagedTracts: 1,
  totalTracts: 2,
  pctDisadvantaged: 50,
  proxyDisadvantagedFlag: true,
  federalJustice40: {
    status: "disadvantaged" as const,
    source: "cejst-national",
    datasetLabel: "CEJST v1.0 (2022-11-22) — discontinued-program snapshot",
    version: "1.0",
    vintage: "2010",
    coverage: { totalTracts: 2, determinedTracts: 2, undeterminedTracts: 0, disadvantagedTracts: 1 },
  },
  source: "proxy-census",
  title6Flags: [],
  lowIncomeTracts: 1,
  highPovertyTracts: 0,
  highMinorityTracts: 1,
  lowVehicleAccessTracts: 0,
  highTransitDependencyTracts: 0,
  burdenedLowIncomeTracts: 0,
};

const SCORES_FIXTURE = {
  accessibilityScore: 61,
  safetyScore: 72,
  equityScore: 55,
  overallScore: 63,
  confidence: 0.8,
  dataQuality: { censusTractsFound: false },
};

const WALK_BIKE_FIXTURE = {
  tier: "moderate",
  scoreBoost: 0,
  rationale: "Baseline walk/bike access classification for the test fixture.",
};

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const authGetUserMock = vi.fn();

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const runsInsertMock = vi.fn();

const userFromMock = vi.fn((table: string) => {
  if (table === "workspace_members") {
    return { select: membershipSelectMock };
  }
  throw new Error(`Unexpected user-client table: ${table}`);
});

const serviceFromMock = vi.fn((table: string) => {
  if (table === "runs") {
    return { insert: runsInsertMock };
  }
  throw new Error(`Unexpected service-client table: ${table}`);
});

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const checkMonthlyRunQuotaMock = vi.fn();
const generateGrantInterpretationMock = vi.fn();
const fetchCensusForCorridorMock = vi.fn();
const bboxFromGeojsonMock = vi.fn();
const fetchTractOverlayFeaturesMock = vi.fn();
const fetchLODESForCorridorMock = vi.fn();
const fetchCrashesForBboxMock = vi.fn();
const fetchCrashPointFeaturesForBboxMock = vi.fn();
const fetchTransitAccessForBboxMock = vi.fn();
const screenEquityMock = vi.fn();
const computeCorridorScoresMock = vi.fn();
const classifyWalkBikeAccessMock = vi.fn();
const buildAnalysisCostThresholdWarningMock = vi.fn();
const validateCorridorGeometryMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));

vi.mock("@/lib/ai/interpret", () => ({
  generateGrantInterpretation: (...args: unknown[]) => generateGrantInterpretationMock(...args),
}));

// Only the two NETWORK functions are stubbed. `censusReportedFigures` and
// `censusUniverseUnavailableNote` are pure and stay REAL, because they are the
// measured/not-measured boundary this route now narrates through — doubling them
// would make every assertion below a statement about the double.
vi.mock("@/lib/data-sources/census", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-sources/census")>()),
  fetchCensusForCorridor: (...args: unknown[]) => fetchCensusForCorridorMock(...args),
  bboxFromGeojson: (...args: unknown[]) => bboxFromGeojsonMock(...args),
}));

vi.mock("@/lib/data-sources/census-geometry", () => ({
  fetchTractOverlayFeatures: (...args: unknown[]) => fetchTractOverlayFeaturesMock(...args),
}));

vi.mock("@/lib/data-sources/lodes", () => ({
  fetchLODESForCorridor: (...args: unknown[]) => fetchLODESForCorridorMock(...args),
}));

vi.mock("@/lib/data-sources/crashes", () => ({
  fetchCrashesForBbox: (...args: unknown[]) => fetchCrashesForBboxMock(...args),
  fetchCrashPointFeaturesForBbox: (...args: unknown[]) =>
    fetchCrashPointFeaturesForBboxMock(...args),
}));

vi.mock("@/lib/data-sources/transit", () => ({
  fetchTransitAccessForBbox: (...args: unknown[]) => fetchTransitAccessForBboxMock(...args),
}));

vi.mock("@/lib/data-sources/equity", () => ({
  screenEquity: (...args: unknown[]) => screenEquityMock(...args),
}));

vi.mock("@/lib/data-sources/scoring", () => ({
  computeCorridorScores: (...args: unknown[]) => computeCorridorScoresMock(...args),
}));

vi.mock("@/lib/accessibility/isochrone", () => ({
  classifyWalkBikeAccess: (...args: unknown[]) => classifyWalkBikeAccessMock(...args),
}));

vi.mock("@/lib/ai/cost-threshold", () => ({
  buildAnalysisCostThresholdWarning: (...args: unknown[]) =>
    buildAnalysisCostThresholdWarningMock(...args),
}));

vi.mock("@/lib/geo/corridor-geometry", () => ({
  validateCorridorGeometry: (...args: unknown[]) => validateCorridorGeometryMock(...args),
}));

// Kept real (pure): @/lib/billing/subscription, @/lib/auth/role-matrix,
// @/lib/grants/narrative-grounding (stripFactCitationTokens), @/lib/http/body-limit.

import { POST as postAnalysis } from "@/app/api/analysis/route";

function analysisRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/analysis", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  workspaceId: WORKSPACE_ID,
  queryText: "Test corridor",
  corridorGeojson: {
    type: "Polygon",
    coordinates: [
      [
        [-121.5, 39.1],
        [-121.4, 39.1],
        [-121.4, 39.2],
        [-121.5, 39.1],
      ],
    ],
  },
};

describe("/api/analysis grounding provenance contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: userFromMock,
    });
    createServiceRoleClientMock.mockReturnValue({ from: serviceFromMock });

    membershipMaybeSingleMock.mockResolvedValue({
      data: {
        workspace_id: WORKSPACE_ID,
        role: "owner",
        workspaces: {
          plan: "pro",
          subscription_plan: "pro",
          subscription_status: "active",
        },
      },
      error: null,
    });

    checkMonthlyRunQuotaMock.mockResolvedValue({
      ok: true,
      plan: "pro",
      monthlyLimit: null,
      usedRuns: 0,
      remaining: null,
      unlimited: true,
    });
    runsInsertMock.mockResolvedValue({ error: null });

    validateCorridorGeometryMock.mockReturnValue({ ok: true });
    bboxFromGeojsonMock.mockReturnValue([-121.5, 39.1, -121.4, 39.2]);
    fetchCensusForCorridorMock.mockResolvedValue(CENSUS_FIXTURE);
    fetchTractOverlayFeaturesMock.mockResolvedValue([]);
    fetchLODESForCorridorMock.mockResolvedValue(LODES_FIXTURE);
    fetchCrashesForBboxMock.mockResolvedValue(CRASHES_FIXTURE);
    fetchCrashPointFeaturesForBboxMock.mockResolvedValue([]);
    fetchTransitAccessForBboxMock.mockResolvedValue(TRANSIT_FIXTURE);
    screenEquityMock.mockReturnValue(EQUITY_FIXTURE);
    computeCorridorScoresMock.mockReturnValue(SCORES_FIXTURE);
    classifyWalkBikeAccessMock.mockReturnValue(WALK_BIKE_FIXTURE);
    buildAnalysisCostThresholdWarningMock.mockReturnValue(null);
    generateGrantInterpretationMock.mockResolvedValue(INTERPRETATION_RESULT);
  });

  it("stores the raw [fact:N] narrative, responds stripped, and discloses dropped sentences", async () => {
    const response = await postAnalysis(analysisRequest(VALID_BODY));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      runId: string;
      metrics: {
        aiInterpretationSource: string;
        dataQuality: Record<string, unknown>;
      };
      aiInterpretation: string;
      aiInterpretationSource: string;
    };

    // --- Store raw: the persisted run keeps the [fact:N] provenance tokens ---
    expect(runsInsertMock).toHaveBeenCalledTimes(1);
    const insertPayload = runsInsertMock.mock.calls[0][0] as {
      id: string;
      workspace_id: string;
      ai_interpretation: string;
      metrics: {
        aiInterpretationSource: string;
        dataQuality: Record<string, unknown>;
      };
    };
    expect(insertPayload.workspace_id).toBe(WORKSPACE_ID);
    expect(insertPayload.ai_interpretation).toBe(RAW_AI_TEXT);
    expect(insertPayload.ai_interpretation).toContain("[fact:m_population]");
    expect(insertPayload.ai_interpretation).toContain("[fact:m_jobs]");

    // --- Respond stripped: display path is token-free but keeps the prose ---
    expect(payload.aiInterpretation).not.toContain("[fact:");
    expect(payload.aiInterpretation).toContain("5000 residents");
    expect(payload.aiInterpretation).toContain("1000 jobs");
    expect(payload.aiInterpretationSource).toBe("ai");

    // --- Provenance disclosure: dropped-sentence count in both metrics copies ---
    expect(insertPayload.metrics.dataQuality.aiInterpretationDroppedSentences).toBe(2);
    expect(insertPayload.metrics.aiInterpretationSource).toBe("ai");
    expect(payload.metrics.dataQuality.aiInterpretationDroppedSentences).toBe(2);
    expect(payload.metrics.aiInterpretationSource).toBe("ai");

    // Stored and responded metrics carry the same disclosure (same object).
    expect(payload.metrics.dataQuality).toEqual(insertPayload.metrics.dataQuality);

    // --- Audit trail: the drop is surfaced as a warn event ---
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "analysis_ai_sentences_dropped",
      expect.objectContaining({
        runId: payload.runId,
        workspaceId: WORKSPACE_ID,
        droppedSentenceCount: 2,
        issues: [
          "missing_citation: Uncited filler.",
          "unfaithful_citation: Bad figure.",
        ],
      })
    );
    // No fallback warn: the interpretation came from the AI path.
    expect(mockAudit.warn).not.toHaveBeenCalledWith(
      "analysis_ai_fallback",
      expect.anything()
    );
  });
});

/**
 * THE RUN RECORDS HOW ITS TRANSIT FIGURES WERE MEASURED — disclosure site (a).
 *
 * A workspace that ingests its agency's feed can watch this corridor's
 * accessibility score fall by up to nine points with nothing about the corridor
 * having changed. The only thing that makes that legible after the fact is that
 * the run wrote down which measurement produced its number, so this asserts on
 * the PERSISTED payload rather than on the response.
 */
describe("/api/analysis records the transit measurement on the run", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: userFromMock });
    createServiceRoleClientMock.mockReturnValue({ from: serviceFromMock });
    membershipMaybeSingleMock.mockResolvedValue({
      data: { workspace_id: WORKSPACE_ID, role: "owner", workspaces: {} },
      error: null,
    });
    runsInsertMock.mockResolvedValue({ error: null });
    validateCorridorGeometryMock.mockReturnValue({ ok: true });
    bboxFromGeojsonMock.mockReturnValue({ minLon: -121.5, minLat: 39.1, maxLon: -121.4, maxLat: 39.2 });
    fetchCensusForCorridorMock.mockResolvedValue(CENSUS_FIXTURE);
    fetchTractOverlayFeaturesMock.mockResolvedValue([]);
    fetchLODESForCorridorMock.mockResolvedValue(LODES_FIXTURE);
    fetchCrashesForBboxMock.mockResolvedValue(CRASHES_FIXTURE);
    fetchCrashPointFeaturesForBboxMock.mockResolvedValue([]);
    screenEquityMock.mockReturnValue(EQUITY_FIXTURE);
    computeCorridorScoresMock.mockReturnValue(SCORES_FIXTURE);
    classifyWalkBikeAccessMock.mockReturnValue(WALK_BIKE_FIXTURE);
    buildAnalysisCostThresholdWarningMock.mockReturnValue(null);
    generateGrantInterpretationMock.mockResolvedValue(INTERPRETATION_RESULT);
  });

  async function persistedMetrics(transitFixture: unknown): Promise<Record<string, unknown>> {
    fetchTransitAccessForBboxMock.mockResolvedValue(transitFixture);
    const response = await postAnalysis(analysisRequest(VALID_BODY));
    expect(response.status).toBe(200);
    return (runsInsertMock.mock.calls[0][0] as { metrics: Record<string, unknown> }).metrics;
  }

  it("keeps capped crash severity counts out of the AI fact list and score", async () => {
    fetchTransitAccessForBboxMock.mockResolvedValue(TRANSIT_FIXTURE);
    fetchCrashesForBboxMock.mockResolvedValue({
      ...CRASHES_FIXTURE,
      observed: true,
      truncated: true,
      reportedTotal: 5432,
      mappedTotal: 5432,
      totalFatalCrashes: 71,
      totalFatalities: 77,
      totalInjuryCrashes: 1603,
      sourceSnapshot: { source: "ccrs-ca", truncated: true },
      narrativeLine:
        "**Safety (2022, 2023, 2024, 2025, CCRS):** 5,432 crashes matched the study area, but the record extract reached OpenPlan's analysis cap. Severity totals, crash density, and the safety score are withheld because the extract is incomplete.",
    });
    computeCorridorScoresMock.mockReturnValue({
      ...SCORES_FIXTURE,
      safetyScore: null,
      dataQuality: {
        censusAvailable: true,
        crashDataAvailable: true,
        crashDataComplete: false,
        transitDataAvailable: true,
        lodesSource: "acs-estimate",
        equitySource: "proxy-census",
      },
    });

    const response = await postAnalysis(analysisRequest(VALID_BODY));
    expect(response.status).toBe(200);

    const [metrics, summary] = generateGrantInterpretationMock.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(metrics.totalFatalCrashes).toBeNull();
    expect(metrics.totalFatalities).toBeNull();
    expect(metrics.totalInjuryCrashes).toBeNull();
    expect(metrics.crashesPerSquareMile).toBeNull();
    expect(metrics.crashReportedTotal).toBe(5432);
    expect(metrics.safetyScore).toBeNull();
    expect((metrics.dataQuality as Record<string, unknown>).crashDataComplete).toBe(false);
    expect(summary).toContain("5,432 crashes matched");
    expect(summary).toContain("safety score are withheld");
    expect(summary).not.toContain("1,603");
    expect(summary).not.toContain("71 fatal");
  });

  it("hands the transit registry the workspace, which is the tenant boundary", async () => {
    await persistedMetrics(GTFS_TRANSIT_FIXTURE);

    // `gtfs_feeds.workspace_id IS NULL` is a PUBLIC PRELOADED feed shared by
    // every tenant. Without this argument the corridor could be scored off a
    // stranger's transit agency, on a scorecard, with nothing saying so.
    expect(fetchTransitAccessForBboxMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: WORKSPACE_ID, client: expect.anything() })
    );
  });

  it("stores the transit lane's own snapshot, method and all", async () => {
    const metrics = await persistedMetrics(GTFS_TRANSIT_FIXTURE);
    const snapshot = (metrics.sourceSnapshots as Record<string, unknown>).transit as Record<string, unknown>;

    // Written verbatim from the summary, so a run stored today can still say how
    // it was measured after the labels have been rewritten twice.
    expect(snapshot).toEqual(GTFS_TRANSIT_FIXTURE.sourceSnapshot);
    expect((snapshot.method as { id: string }).id).toBe("gtfs-service-levels");
    expect(metrics.frequentServiceShare).toBe(0.25);
    expect(metrics.frequentServiceHeadwayMinutes).toBe(15);
  });

  it("narrates transit through the lane's own line, not a shape only OSM can fill", async () => {
    const metrics = await persistedMetrics(GTFS_TRANSIT_FIXTURE);
    const summary = (runsInsertMock.mock.calls[0][0] as { summary_text: string }).summary_text;

    // The route used to build this line itself as "including ${busStops} bus
    // stops", which a GTFS summary reports as null — the narrative would have
    // read "including null bus stops".
    expect(summary).toContain(GTFS_TRANSIT_FIXTURE.narrativeLine);
    expect(summary).not.toContain("null bus stops");
    expect(metrics.busStops).toBeNull();
  });

  /**
   * THE CLAIM TIER DOES NOT MOVE — asserted, not assumed.
   *
   * Every corridor screen is `concept-level` by the method, not by the data, and
   * no input may promote one. Better transit evidence makes the screen better
   * evidence; it does not make it a modeled forecast, and it may still not stand
   * behind a CEQA determination.
   */
  it("keeps the decision-use boundary identical whichever source answered", async () => {
    const osm = await persistedMetrics(TRANSIT_FIXTURE);
    expect(osm.decisionUseStatus).toBe(CORRIDOR_DECISION_USE_STATUS);

    vi.clearAllMocks();
    runsInsertMock.mockResolvedValue({ error: null });
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: userFromMock });
    createServiceRoleClientMock.mockReturnValue({ from: serviceFromMock });
    membershipMaybeSingleMock.mockResolvedValue({
      data: { workspace_id: WORKSPACE_ID, role: "owner", workspaces: {} },
      error: null,
    });
    validateCorridorGeometryMock.mockReturnValue({ ok: true });
    bboxFromGeojsonMock.mockReturnValue({ minLon: -121.5, minLat: 39.1, maxLon: -121.4, maxLat: 39.2 });
    fetchCensusForCorridorMock.mockResolvedValue(CENSUS_FIXTURE);
    fetchTractOverlayFeaturesMock.mockResolvedValue([]);
    fetchLODESForCorridorMock.mockResolvedValue(LODES_FIXTURE);
    fetchCrashesForBboxMock.mockResolvedValue(CRASHES_FIXTURE);
    fetchCrashPointFeaturesForBboxMock.mockResolvedValue([]);
    screenEquityMock.mockReturnValue(EQUITY_FIXTURE);
    computeCorridorScoresMock.mockReturnValue(SCORES_FIXTURE);
    classifyWalkBikeAccessMock.mockReturnValue(WALK_BIKE_FIXTURE);
    buildAnalysisCostThresholdWarningMock.mockReturnValue(null);
    generateGrantInterpretationMock.mockResolvedValue(INTERPRETATION_RESULT);

    const gtfs = await persistedMetrics(GTFS_TRANSIT_FIXTURE);
    expect(gtfs.decisionUseStatus).toBe(CORRIDOR_DECISION_USE_STATUS);
    expect(gtfs.decisionUseStatus).toBe(osm.decisionUseStatus);
    // And the route reaches it from the constant rather than computing it: the
    // status is fixed by the method, so a derived value would imply a
    // distinction the method does not support.
    expect(resolveDecisionUseDisclosure(gtfs).notRecorded).toBe(false);
  });
});
