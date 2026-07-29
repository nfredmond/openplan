import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const runMaybeSingleMock = vi.fn();
const runEqMock = vi.fn(() => ({ maybeSingle: runMaybeSingleMock }));
const runSelectMock = vi.fn(() => ({ eq: runEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const updateSelectMock = vi.fn();
const updateEqMock = vi.fn(() => ({ select: updateSelectMock }));
const updateMock = vi.fn(() => ({ eq: updateEqMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "runs") {
    return {
      select: runSelectMock,
      update: updateMock,
    };
  }

  if (table === "workspace_members") {
    return {
      select: membershipSelectMock,
    };
  }

  throw new Error(`Unexpected table: ${table}`);
});

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { PATCH as patchRun } from "@/app/api/runs/route";

/**
 * This file used to contain the sharpest possible illustration of why a green
 * suite proved nothing here.
 *
 * A test named "persists map view state into run metrics" asserted status 200
 * and that `.update()` was called with the right metrics object — and it passed
 * for the entire life of a bug in which NOTHING WAS EVER PERSISTED. `runs` had
 * a RESTRICTIVE writer gate and no PERMISSIVE UPDATE policy (fixed by
 * 20260728000010), so every update matched zero rows; with RLS on that is a
 * SUCCESSFUL statement, and supabase-js returns `error: null` over it. The mock
 * resolved `{ error: null }` too — faithfully reproducing the failure and
 * calling it a pass.
 *
 * The test verified the REQUEST, and was named for the RESULT. So the assertion
 * below is now about the row the write actually changed, and the zero-row case
 * has its own test.
 */
describe("PATCH /api/runs", () => {
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

    runMaybeSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        metrics: {
          overallScore: 75,
        },
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

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });

    updateSelectMock.mockResolvedValue({
      data: [{ id: "11111111-1111-4111-8111-111111111111" }],
      error: null,
    });
  });

  it("returns 400 for invalid payload", async () => {
    const response = await patchRun(
      new NextRequest("http://localhost/api/runs", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "nope" }),
      })
    );

    expect(response.status).toBe(400);
  });

  it("writes map view state into run metrics and confirms a row changed", async () => {
    const response = await patchRun(
      new NextRequest("http://localhost/api/runs", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "11111111-1111-4111-8111-111111111111",
          mapViewState: {
            tractMetric: "poverty",
            showTracts: true,
            showCrashes: true,
            crashSeverityFilter: "fatal",
            crashUserFilter: "pedestrian",
            activeDatasetOverlayId: "44444444-4444-4444-8444-444444444444",
            activeOverlayContext: {
              datasetId: "44444444-4444-4444-8444-444444444444",
              datasetName: "Nevada County Equity Indicators",
              overlayMode: "thematic_overlay",
              geometryAttachment: "analysis_tracts",
              thematicMetricKey: "pctBelowPoverty",
              thematicMetricLabel: "Poverty share",
              connectorLabel: "Census ACS 5-Year",
            },
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({
      metrics: expect.objectContaining({
        overallScore: 75,
        mapViewState: expect.objectContaining({
          crashSeverityFilter: "fatal",
          crashUserFilter: "pedestrian",
          tractMetric: "poverty",
          activeDatasetOverlayId: "44444444-4444-4444-8444-444444444444",
          activeOverlayContext: expect.objectContaining({
            datasetName: "Nevada County Equity Indicators",
            thematicMetricLabel: "Poverty share",
          }),
        }),
      }),
    });

    // The projection is what makes "did anything change?" answerable at all.
    expect(updateSelectMock).toHaveBeenCalled();
  });

  it("reports failure when the update matched no rows", async () => {
    // THE REGRESSION. An UPDATE that matches nothing is a successful statement
    // under RLS, so this is indistinguishable from a real write unless the
    // route counts the rows it changed. Reporting success here is what made the
    // audit log agree with the lie: it recorded `run_updated` every time.
    updateSelectMock.mockResolvedValueOnce({ data: [], error: null });

    const response = await patchRun(
      new NextRequest("http://localhost/api/runs", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "11111111-1111-4111-8111-111111111111",
          mapViewState: { showTracts: true },
        }),
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Run update did not apply" });
    expect(mockAudit.info).not.toHaveBeenCalledWith("run_updated", expect.anything());
    expect(mockAudit.error).toHaveBeenCalledWith("update_matched_no_rows", expect.anything());
  });
});
