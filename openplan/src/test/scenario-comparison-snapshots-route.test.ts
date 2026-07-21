import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const markScenarioLinkedReportsBasisStaleMock = vi.fn();

const scenarioSetMaybeSingleMock = vi.fn();
const scenarioSetEqMock = vi.fn(() => ({ maybeSingle: scenarioSetMaybeSingleMock }));
const scenarioSetSelectMock = vi.fn(() => ({ eq: scenarioSetEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const workspaceMaybeSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock }));
const workspaceSelectMock = vi.fn(() => ({ eq: workspaceEqMock }));

const runsCountGteMock = vi.fn().mockResolvedValue({ count: 0, error: null });
const runsCountEqMock = vi.fn(() => ({ gte: runsCountGteMock }));
const runsSelectMock = vi.fn(() => ({ eq: runsCountEqMock }));

const entryMaybeSingleMock = vi.fn();
const entryEqScenarioSetMock = vi.fn(() => ({ maybeSingle: entryMaybeSingleMock }));
const entryEqIdMock = vi.fn(() => ({ eq: entryEqScenarioSetMock }));
const entrySelectMock = vi.fn(() => ({ eq: entryEqIdMock }));

const indicatorSnapshotInMock = vi.fn();
const indicatorSnapshotEqMock = vi.fn(() => ({ in: indicatorSnapshotInMock }));
const indicatorSnapshotSelectMock = vi.fn(() => ({ eq: indicatorSnapshotEqMock }));

const comparisonSnapshotSingleMock = vi.fn();
const comparisonSnapshotInsertSelectMock = vi.fn(() => ({ single: comparisonSnapshotSingleMock }));
const comparisonSnapshotInsertMock = vi.fn(() => ({ select: comparisonSnapshotInsertSelectMock }));

const comparisonDeltaInsertSelectMock = vi.fn();
const comparisonDeltaInsertMock = vi.fn(() => ({ select: comparisonDeltaInsertSelectMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "scenario_sets") {
    return { select: scenarioSetSelectMock };
  }

  if (table === "workspace_members") {
    return { select: membershipSelectMock };
  }

  if (table === "workspaces") {
    return { select: workspaceSelectMock };
  }

  if (table === "runs") {
    return { select: runsSelectMock };
  }

  if (table === "scenario_entries") {
    return { select: entrySelectMock };
  }

  if (table === "scenario_indicator_snapshots") {
    return { select: indicatorSnapshotSelectMock };
  }

  if (table === "scenario_comparison_snapshots") {
    return { insert: comparisonSnapshotInsertMock };
  }

  if (table === "scenario_comparison_indicator_deltas") {
    return { insert: comparisonDeltaInsertMock };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/reports/scenario-writeback", () => ({
  markScenarioLinkedReportsBasisStale: (...args: unknown[]) => markScenarioLinkedReportsBasisStaleMock(...args),
}));

import { POST as postComparisonSnapshot } from "@/app/api/scenarios/[scenarioSetId]/spine/comparison-snapshots/route";
import { buildTripGenComparisonPayload } from "@/lib/scenarios/trip-gen-comparison";
import { ITE_TRIP_GEN_KPI_NAMES } from "@/lib/models/ite-trip-generation";

describe("/api/scenarios/[scenarioSetId]/spine/comparison-snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      },
    });

    scenarioSetMaybeSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: "44444444-4444-4444-8444-444444444444",
        title: "Downtown alternatives",
        baseline_entry_id: "55555555-5555-4555-8555-555555555555",
      },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: {
        workspace_id: "33333333-3333-4333-8333-333333333333",
        role: "member",
      },
      error: null,
    });

    workspaceMaybeSingleMock.mockResolvedValue({
      data: {
        plan: "pilot",
        subscription_plan: "pilot",
        subscription_status: "active",
      },
      error: null,
    });

    runsCountGteMock.mockResolvedValue({ count: 0, error: null });

    entryMaybeSingleMock
      .mockResolvedValueOnce({
        data: {
          id: "55555555-5555-4555-8555-555555555555",
          scenario_set_id: "11111111-1111-4111-8111-111111111111",
          entry_type: "baseline",
          label: "Existing conditions",
          assumptions_json: {
            horizonYear: 2045,
            network_source: "County public network",
            hidden_raw_key: "do-not-leak",
          },
          attached_run_id: "baseline-run",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: "77777777-7777-4777-8777-777777777777",
          scenario_set_id: "11111111-1111-4111-8111-111111111111",
          entry_type: "alternative",
          label: "Protected bike package",
          assumptions_json: {
            projectPackage: "Protected bike network",
            internalSolverKey: "do-not-leak",
          },
          attached_run_id: "candidate-run",
        },
        error: null,
      });

    indicatorSnapshotInMock.mockResolvedValue({
      data: [
        { id: "88888888-8888-4888-8888-888888888888" },
        { id: "99999999-9999-4999-8999-999999999999" },
      ],
      error: null,
    });

    comparisonSnapshotSingleMock.mockResolvedValue({
      data: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        scenario_set_id: "11111111-1111-4111-8111-111111111111",
        baseline_entry_id: "55555555-5555-4555-8555-555555555555",
        candidate_entry_id: "77777777-7777-4777-8777-777777777777",
        label: "Protected bike package comparison",
        status: "ready",
      },
      error: null,
    });

    comparisonDeltaInsertSelectMock.mockResolvedValue({
      data: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          comparison_snapshot_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          indicator_key: "vmt",
        },
      ],
      error: null,
    });

    markScenarioLinkedReportsBasisStaleMock.mockResolvedValue({
      staleReportIds: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("marks linked RTP packet basis stale after creating saved comparison evidence", async () => {
    const response = await postComparisonSnapshot(
      new NextRequest("http://localhost/api/scenarios/1/spine/comparison-snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baselineEntryId: "55555555-5555-4555-8555-555555555555",
          candidateEntryId: "77777777-7777-4777-8777-777777777777",
          label: "Protected bike package comparison",
          status: "ready",
          caveats: ["Screening-grade comparison only; preserve validation caveats."],
          indicatorDeltas: [
            {
              baselineIndicatorSnapshotId: "88888888-8888-4888-8888-888888888888",
              candidateIndicatorSnapshotId: "99999999-9999-4999-8999-999999999999",
              indicatorKey: "vmt",
              indicatorLabel: "Vehicle miles traveled",
              delta: { percent: -6 },
              summary: "Alternative reduces VMT.",
            },
          ],
        }),
      }),
      {
        params: Promise.resolve({ scenarioSetId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(201);
    expect(comparisonSnapshotInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scenario_set_id: "11111111-1111-4111-8111-111111111111",
        baseline_entry_id: "55555555-5555-4555-8555-555555555555",
        candidate_entry_id: "77777777-7777-4777-8777-777777777777",
        status: "ready",
        caveats_json: ["Screening-grade comparison only; preserve validation caveats."],
        metadata_json: expect.objectContaining({
          sourceContext: expect.objectContaining({
            kind: "scenario_comparison_snapshot_source_context",
            pairingLabel: "Protected bike package compared against Existing conditions",
            baselineAssumptions: expect.stringContaining("Network source: County public network"),
            alternativeAssumptions: expect.stringContaining("Project package: Protected bike network"),
            caveatSummary: expect.stringContaining("Screening-grade comparison only"),
            exportReadiness: expect.stringContaining("ready for a draft comparison packet"),
            evidenceLabels: ["Vehicle miles traveled"],
            pairing: expect.objectContaining({
              baselineRunId: "baseline-run",
              candidateRunId: "candidate-run",
            }),
          }),
        }),
      })
    );
    const [persistedSnapshot] = comparisonSnapshotInsertMock.mock.calls[0] as unknown as [
      { metadata_json?: { sourceContext?: unknown } },
    ];
    const renderedContext = JSON.stringify(persistedSnapshot.metadata_json?.sourceContext);
    expect(renderedContext).not.toContain("internalSolverKey");
    expect(renderedContext).not.toContain("hidden_raw_key");
    expect(comparisonDeltaInsertMock).toHaveBeenCalledWith([
      expect.objectContaining({
        comparison_snapshot_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        indicator_key: "vmt",
      }),
    ]);
    expect(markScenarioLinkedReportsBasisStaleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioSetId: "11111111-1111-4111-8111-111111111111",
        workspaceId: "33333333-3333-4333-8333-333333333333",
        runId: null,
        reason: "Scenario comparison snapshot Protected bike package comparison changed the linked RTP packet basis.",
      })
    );
    expect(mockAudit.info).toHaveBeenCalledWith(
      "comparison_snapshot_created",
      expect.objectContaining({
        comparisonSnapshotId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        staleReportCount: 1,
      })
    );
  });

  it("accepts a real buildTripGenComparisonPayload body through the real route schema and persists the split caveats", async () => {
    // Drift guard: the payload comes from the REAL builder, and the POST goes
    // through the REAL route handler (real createComparisonSnapshotSchema).
    // If the spine schema and the builder ever diverge, this returns 400.
    const baselineKpis = [
      { kpi_name: "project_daily_trip_ends", kpi_label: "Daily vehicle trip ends", value: 1284, unit: "trip ends / day" },
      { kpi_name: "project_am_peak_hour_trip_ends", kpi_label: "AM peak-hour trip ends", value: 96, unit: "trip ends / hour" },
      { kpi_name: "project_pm_peak_hour_trip_ends", kpi_label: "PM peak-hour trip ends", value: 121, unit: "trip ends / hour" },
      { kpi_name: "project_daily_vmt_screen", kpi_label: "Screening daily VMT", value: 7575.6, unit: "vehicle miles / day" },
      { kpi_name: "project_program_units", kpi_label: "Program units", value: 180, unit: "dwelling units" },
    ];
    const candidateKpis = [
      { kpi_name: "project_daily_trip_ends", kpi_label: "Daily vehicle trip ends", value: 1046, unit: "trip ends / day" },
      { kpi_name: "project_am_peak_hour_trip_ends", kpi_label: "AM peak-hour trip ends", value: 78, unit: "trip ends / hour" },
      { kpi_name: "project_pm_peak_hour_trip_ends", kpi_label: "PM peak-hour trip ends", value: 99, unit: "trip ends / hour" },
      { kpi_name: "project_daily_vmt_screen", kpi_label: "Screening daily VMT", value: 6171.4, unit: "vehicle miles / day" },
      { kpi_name: "project_program_units", kpi_label: "Program units", value: 180, unit: "dwelling units" },
    ];

    // Every fixture KPI name must live in the real engine namespace, so the
    // fixture cannot drift away from what the engine actually emits.
    for (const row of [...baselineKpis, ...candidateKpis]) {
      expect(ITE_TRIP_GEN_KPI_NAMES.has(row.kpi_name)).toBe(true);
    }

    const payload = buildTripGenComparisonPayload({
      baselineEntry: { id: "55555555-5555-4555-8555-555555555555", label: "Existing conditions" },
      candidateEntry: { id: "77777777-7777-4777-8777-777777777777", label: "Protected bike package" },
      baselineKpis,
      candidateKpis,
      label: "Trip generation — Protected bike package vs Existing conditions",
    });

    expect(payload.indicatorDeltas).toHaveLength(5);
    expect(payload.caveats.length).toBeGreaterThan(1);
    for (const caveat of payload.caveats) {
      expect(caveat.length).toBeGreaterThan(0);
      expect(caveat.length).toBeLessThanOrEqual(400);
    }

    const response = await postComparisonSnapshot(
      new NextRequest("http://localhost/api/scenarios/1/spine/comparison-snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
      { params: Promise.resolve({ scenarioSetId: "11111111-1111-4111-8111-111111111111" }) }
    );

    expect(response.status).toBe(201);
    expect(comparisonSnapshotInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scenario_set_id: "11111111-1111-4111-8111-111111111111",
        baseline_entry_id: "55555555-5555-4555-8555-555555555555",
        candidate_entry_id: "77777777-7777-4777-8777-777777777777",
        caveats_json: payload.caveats,
      })
    );
    expect(comparisonDeltaInsertMock).toHaveBeenCalledTimes(1);
    const [deltaRows] = comparisonDeltaInsertMock.mock.calls[0] as unknown as [
      Array<{ indicator_key: string }>,
    ];
    expect(deltaRows.map((row) => row.indicator_key)).toEqual(
      payload.indicatorDeltas.map((delta) => delta.indicatorKey)
    );
  });

  it("returns 402 when the workspace subscription is not active", async () => {
    workspaceMaybeSingleMock.mockResolvedValueOnce({
      data: {
        plan: "pilot",
        subscription_plan: "pilot",
        subscription_status: "past_due",
      },
      error: null,
    });

    const response = await postComparisonSnapshot(
      new NextRequest("http://localhost/api/scenarios/1/spine/comparison-snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baselineEntryId: "55555555-5555-4555-8555-555555555555",
          candidateEntryId: "77777777-7777-4777-8777-777777777777",
          label: "Protected bike package comparison",
        }),
      }),
      { params: Promise.resolve({ scenarioSetId: "11111111-1111-4111-8111-111111111111" }) }
    );

    expect(response.status).toBe(402);
    expect(comparisonSnapshotInsertMock).not.toHaveBeenCalled();
  });

  it("returns 429 when the monthly run quota is exceeded", async () => {
    runsCountGteMock.mockResolvedValueOnce({ count: 9999, error: null });

    const response = await postComparisonSnapshot(
      new NextRequest("http://localhost/api/scenarios/1/spine/comparison-snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baselineEntryId: "55555555-5555-4555-8555-555555555555",
          candidateEntryId: "77777777-7777-4777-8777-777777777777",
          label: "Protected bike package comparison",
        }),
      }),
      { params: Promise.resolve({ scenarioSetId: "11111111-1111-4111-8111-111111111111" }) }
    );

    expect(response.status).toBe(429);
    expect(comparisonSnapshotInsertMock).not.toHaveBeenCalled();
  });
});
