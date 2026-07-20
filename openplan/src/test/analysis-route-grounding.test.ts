import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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
};

const LODES_FIXTURE = {
  totalJobs: 1000,
  jobsPerResident: 0.2,
  source: "acs-estimate",
};

const TRANSIT_FIXTURE = {
  totalStops: 12,
  stopsPerSqMile: 4.5,
  busStops: 11,
  railStations: 1,
  ferryStops: 0,
  accessTier: "moderate",
  source: "osm-overpass",
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
  justice40Eligible: true,
  source: "census-proxy",
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
const recordUsageEventBestEffortMock = vi.fn();
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

vi.mock("@/lib/billing/quota", () => ({
  checkMonthlyRunQuota: (...args: unknown[]) => checkMonthlyRunQuotaMock(...args),
  isQuotaLookupError: (result: { ok: boolean; lookupError?: boolean }) =>
    result.ok === false && result.lookupError === true,
  isQuotaExceeded: (result: { ok: boolean; lookupError?: boolean }) =>
    result.ok === false && result.lookupError !== true,
}));

vi.mock("@/lib/billing/usage-recording", () => ({
  recordUsageEventBestEffort: (...args: unknown[]) => recordUsageEventBestEffortMock(...args),
}));

vi.mock("@/lib/ai/interpret", () => ({
  generateGrantInterpretation: (...args: unknown[]) => generateGrantInterpretationMock(...args),
}));

vi.mock("@/lib/data-sources/census", () => ({
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
    recordUsageEventBestEffortMock.mockResolvedValue(undefined);
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
