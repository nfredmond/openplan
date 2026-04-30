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

const assumptionSetSingleMock = vi.fn();
const assumptionSetInsertSelectMock = vi.fn(() => ({ single: assumptionSetSingleMock }));
const assumptionSetInsertMock = vi.fn(() => ({ select: assumptionSetInsertSelectMock }));

const dataPackageSingleMock = vi.fn();
const dataPackageInsertSelectMock = vi.fn(() => ({ single: dataPackageSingleMock }));
const dataPackageInsertMock = vi.fn(() => ({ select: dataPackageInsertSelectMock }));

const indicatorSnapshotSingleMock = vi.fn();
const indicatorSnapshotInsertSelectMock = vi.fn(() => ({ single: indicatorSnapshotSingleMock }));
const indicatorSnapshotInsertMock = vi.fn(() => ({ select: indicatorSnapshotInsertSelectMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const SCENARIO_SET_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

const fromMock = vi.fn((table: string) => {
  if (table === "scenario_sets") return { select: scenarioSetSelectMock };
  if (table === "workspace_members") return { select: membershipSelectMock };
  if (table === "scenario_assumption_sets") return { insert: assumptionSetInsertMock };
  if (table === "scenario_data_packages") return { insert: dataPackageInsertMock };
  if (table === "scenario_indicator_snapshots") return { insert: indicatorSnapshotInsertMock };
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/reports/scenario-writeback", () => ({
  markScenarioLinkedReportsBasisStale: (...args: unknown[]) =>
    markScenarioLinkedReportsBasisStaleMock(...args),
}));

import { POST as postAssumptionSet } from "@/app/api/scenarios/[scenarioSetId]/spine/assumption-sets/route";
import { POST as postDataPackage } from "@/app/api/scenarios/[scenarioSetId]/spine/data-packages/route";
import { POST as postIndicatorSnapshot } from "@/app/api/scenarios/[scenarioSetId]/spine/indicator-snapshots/route";

describe("scenario spine route write-back", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: { user: { id: "22222222-2222-4222-8222-222222222222" } },
    });

    scenarioSetMaybeSingleMock.mockResolvedValue({
      data: {
        id: SCENARIO_SET_ID,
        workspace_id: WORKSPACE_ID,
        project_id: "44444444-4444-4444-8444-444444444444",
        title: "Downtown alternatives",
        baseline_entry_id: null,
      },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: { workspace_id: WORKSPACE_ID, role: "member" },
      error: null,
    });

    assumptionSetSingleMock.mockResolvedValue({
      data: {
        id: "55555555-5555-4555-8555-555555555555",
        scenario_set_id: SCENARIO_SET_ID,
        label: "Updated demand assumptions",
      },
      error: null,
    });

    dataPackageSingleMock.mockResolvedValue({
      data: {
        id: "66666666-6666-4666-8666-666666666666",
        scenario_set_id: SCENARIO_SET_ID,
        label: "Household forecast import",
      },
      error: null,
    });

    indicatorSnapshotSingleMock.mockResolvedValue({
      data: {
        id: "77777777-7777-4777-8777-777777777777",
        scenario_set_id: SCENARIO_SET_ID,
        indicator_label: "Access to jobs",
      },
      error: null,
    });

    markScenarioLinkedReportsBasisStaleMock.mockResolvedValue({
      staleReportIds: ["99999999-9999-4999-8999-999999999999"],
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("marks linked RTP packet basis stale after assumption-set creation", async () => {
    const response = await postAssumptionSet(
      new NextRequest("http://localhost/api/scenarios/1/spine/assumption-sets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: "Updated demand assumptions",
          assumptions: { housingGrowth: 0.12 },
          status: "active",
        }),
      }),
      { params: Promise.resolve({ scenarioSetId: SCENARIO_SET_ID }) }
    );

    expect(response.status).toBe(201);
    expect(markScenarioLinkedReportsBasisStaleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioSetId: SCENARIO_SET_ID,
        workspaceId: WORKSPACE_ID,
        runId: null,
        reason: "Scenario assumption set Updated demand assumptions changed the linked RTP packet basis.",
      })
    );
    expect(mockAudit.info).toHaveBeenCalledWith(
      "scenario_assumption_set_created",
      expect.objectContaining({ staleReportCount: 1 })
    );
  });

  it("marks linked RTP packet basis stale after data-package creation", async () => {
    const response = await postDataPackage(
      new NextRequest("http://localhost/api/scenarios/1/spine/data-packages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: "Household forecast import",
          packageType: "reference",
          status: "ready",
        }),
      }),
      { params: Promise.resolve({ scenarioSetId: SCENARIO_SET_ID }) }
    );

    expect(response.status).toBe(201);
    expect(markScenarioLinkedReportsBasisStaleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioSetId: SCENARIO_SET_ID,
        workspaceId: WORKSPACE_ID,
        runId: null,
        reason: "Scenario data package Household forecast import changed the linked RTP packet basis.",
      })
    );
    expect(mockAudit.info).toHaveBeenCalledWith(
      "scenario_data_package_created",
      expect.objectContaining({ staleReportCount: 1 })
    );
  });

  it("marks linked RTP packet basis stale after indicator-snapshot creation", async () => {
    const response = await postIndicatorSnapshot(
      new NextRequest("http://localhost/api/scenarios/1/spine/indicator-snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          indicatorKey: "access_to_jobs",
          indicatorLabel: "Access to jobs",
          value: { delta: 1200 },
        }),
      }),
      { params: Promise.resolve({ scenarioSetId: SCENARIO_SET_ID }) }
    );

    expect(response.status).toBe(201);
    expect(markScenarioLinkedReportsBasisStaleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioSetId: SCENARIO_SET_ID,
        workspaceId: WORKSPACE_ID,
        runId: null,
        reason: "Scenario indicator snapshot Access to jobs changed the linked RTP packet basis.",
      })
    );
    expect(mockAudit.info).toHaveBeenCalledWith(
      "scenario_indicator_snapshot_created",
      expect.objectContaining({ staleReportCount: 1 })
    );
  });
});
