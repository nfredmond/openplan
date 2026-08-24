import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const createClientMock = vi.fn();
const cancelCountyOnrampJobMock = vi.fn();
const requireWorkspaceWriteAccessMock = vi.fn();
const authGetUserMock = vi.fn();
const maybeSingleMock = vi.fn();
const updateMock = vi.fn();
const cancellationClaimMaybeSingleMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));
vi.mock("@/lib/api/county-onramp-dispatch", () => ({
  cancelCountyOnrampJob: (...args: unknown[]) => cancelCountyOnrampJobMock(...args),
}));
vi.mock("@/lib/auth/workspace-write-gate", () => ({
  requireWorkspaceWriteAccess: (...args: unknown[]) => requireWorkspaceWriteAccessMock(...args),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { POST as cancelCountyRun } from "@/app/api/county-runs/[countyRunId]/cancel/route";

const COUNTY_RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_ID = "123e4567-e89b-12d3-a456-426614174999";

function request() {
  return new NextRequest(`http://localhost/api/county-runs/${COUNTY_RUN_ID}/cancel`, { method: "POST" });
}

describe("POST /api/county-runs/[countyRunId]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    maybeSingleMock.mockResolvedValue({
      data: {
        id: COUNTY_RUN_ID,
        workspace_id: "workspace-1",
        worker_job_id: JOB_ID,
        worker_url: "http://worker.test/jobs",
        enqueue_status: "running",
      },
      error: null,
    });
    requireWorkspaceWriteAccessMock.mockResolvedValue({ ok: true, role: "member" });
    cancelCountyOnrampJobMock.mockResolvedValue(undefined);
    cancellationClaimMaybeSingleMock.mockResolvedValue({ data: { id: COUNTY_RUN_ID }, error: null });

    const updateSecondEq = vi.fn().mockReturnValue({
      in: () => ({
        select: () => ({
          maybeSingle: cancellationClaimMaybeSingleMock,
        }),
      }),
    });
    const updateFirstEq = vi.fn().mockReturnValue({ eq: updateSecondEq });
    updateMock.mockReturnValue({ eq: updateFirstEq });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: (table: string) => {
        if (table !== "county_runs") throw new Error(`Unexpected table ${table}`);
        return {
          select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }),
          update: updateMock,
        };
      },
    });
  });

  it("records the human request before asking the worker to stop", async () => {
    const response = await cancelCountyRun(request(), { params: Promise.resolve({ countyRunId: COUNTY_RUN_ID }) });

    expect(response.status).toBe(202);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enqueue_status: "cancelling",
        cancellation_requested_by: "user-1",
        cancellation_requested_at: expect.any(String),
      })
    );
    expect(cancelCountyOnrampJobMock).toHaveBeenCalledWith({
      workerUrl: "http://worker.test/jobs",
      jobId: JOB_ID,
    });
  });

  it("has no bearer-only or anonymous cancellation path", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await cancelCountyRun(request(), { params: Promise.resolve({ countyRunId: COUNTY_RUN_ID }) });

    expect(response.status).toBe(401);
    expect(cancelCountyOnrampJobMock).not.toHaveBeenCalled();
  });

  it("does not contact the worker when completion wins the cancellation race", async () => {
    cancellationClaimMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const response = await cancelCountyRun(request(), { params: Promise.resolve({ countyRunId: COUNTY_RUN_ID }) });

    expect(response.status).toBe(409);
    expect(cancelCountyOnrampJobMock).not.toHaveBeenCalled();
  });

  it("refuses read-only workspace members before contacting the worker", async () => {
    requireWorkspaceWriteAccessMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Read only" }, { status: 403 }),
    });

    const response = await cancelCountyRun(request(), { params: Promise.resolve({ countyRunId: COUNTY_RUN_ID }) });

    expect(response.status).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
    expect(cancelCountyOnrampJobMock).not.toHaveBeenCalled();
  });
});
