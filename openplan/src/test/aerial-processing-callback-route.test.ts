import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const rebuildAerialProjectPostureMock = vi.fn();

const jobMaybeSingleMock = vi.fn();
const jobUpdateEqMock = vi.fn();
const jobUpdateMock = vi.fn();
const ledgerInsertMock = vi.fn();
const evidenceLookupMaybeSingleMock = vi.fn();
const evidenceInsertSingleMock = vi.fn();
const evidenceInsertMock = vi.fn();
const missionMaybeSingleMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "aerial_processing_jobs") {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: jobMaybeSingleMock,
        }),
      }),
      update: jobUpdateMock,
    };
  }

  if (table === "aerial_processing_callbacks") {
    return { insert: ledgerInsertMock };
  }

  if (table === "aerial_evidence_packages") {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: evidenceLookupMaybeSingleMock,
        }),
      }),
      insert: evidenceInsertMock,
    };
  }

  if (table === "aerial_missions") {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: missionMaybeSingleMock,
        }),
      }),
    };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/aerial/posture-writeback", () => ({
  rebuildAerialProjectPosture: (...args: unknown[]) => rebuildAerialProjectPostureMock(...args),
}));

import { POST as postProcessingCallback } from "@/app/api/aerial/processing-callback/route";

const CALLBACK_TOKEN = "callback-secret";

const JOB_ROW = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workspace_id: "33333333-3333-4333-8333-333333333333",
  project_id: "44444444-4444-4444-8444-444444444444",
  mission_id: "22222222-2222-4222-8222-222222222222",
  request_id: "11111111-1111-4111-8111-111111111111",
  job_reference: "worker-job-9",
  status: "accepted",
};

function callbackPayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "natford-aerial-processing.v1",
    requestId: JOB_ROW.request_id,
    callbackId: "cb-0000000001",
    jobReference: "worker-job-9",
    status: "running",
    occurredAt: "2026-07-21T12:00:00Z",
    ...overrides,
  };
}

const SUCCEEDED_ARTIFACTS = [
  {
    kind: "orthomosaic",
    downloadUrl: "https://storage.example.com/ortho.tif?signature=abc",
    expiresAt: "2026-07-22T14:30:00Z",
    sizeBytes: 123456,
    contentType: "image/tiff",
  },
];

function request(body: unknown, token?: string) {
  return new NextRequest("http://localhost/api/aerial/processing-callback", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

describe("POST /api/aerial/processing-callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENPLAN_AERIAL_PROCESSING_CALLBACK_BEARER_TOKEN = CALLBACK_TOKEN;

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createServiceRoleClientMock.mockReturnValue({ from: fromMock });

    jobMaybeSingleMock.mockResolvedValue({ data: { ...JOB_ROW }, error: null });
    ledgerInsertMock.mockResolvedValue({ error: null });
    jobUpdateEqMock.mockResolvedValue({ error: null });
    jobUpdateMock.mockReturnValue({ eq: jobUpdateEqMock });
    evidenceLookupMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    evidenceInsertSingleMock.mockResolvedValue({ data: { id: "pkg-1" }, error: null });
    evidenceInsertMock.mockReturnValue({
      select: () => ({ single: evidenceInsertSingleMock }),
    });
    missionMaybeSingleMock.mockResolvedValue({
      data: { title: "Hwy 49 corridor survey" },
      error: null,
    });
    rebuildAerialProjectPostureMock.mockResolvedValue({
      posture: {
        missionCount: 1,
        activeMissionCount: 0,
        completeMissionCount: 1,
        readyPackageCount: 1,
        verificationReadiness: "partial",
      },
      updatedAt: "2026-07-21T12:00:00.000Z",
      error: null,
    });
  });

  it("returns 503 missing_config when the callback token env is unset", async () => {
    delete process.env.OPENPLAN_AERIAL_PROCESSING_CALLBACK_BEARER_TOKEN;

    const response = await postProcessingCallback(request(callbackPayload(), CALLBACK_TOKEN));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "missing_config" });
  });

  it("returns 401 for a bad bearer token", async () => {
    const response = await postProcessingCallback(request(callbackPayload(), "wrong-secret"));

    expect(response.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid payload", async () => {
    const response = await postProcessingCallback(
      request(callbackPayload({ callbackId: "cb-1" }), CALLBACK_TOKEN)
    );

    expect(response.status).toBe(400);
    expect(ledgerInsertMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown requestId", async () => {
    jobMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const response = await postProcessingCallback(request(callbackPayload(), CALLBACK_TOKEN));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "unknown_request" });
  });

  it("applies a running callback to the job row", async () => {
    const response = await postProcessingCallback(
      request(callbackPayload({ progress: 40, message: "matching features" }), CALLBACK_TOKEN)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "running" });
    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "running",
        progress: 40,
        message: "matching features",
        last_callback_id: "cb-0000000001",
        last_callback_at: "2026-07-21T12:00:00Z",
      })
    );
    expect(evidenceInsertMock).not.toHaveBeenCalled();
    expect(rebuildAerialProjectPostureMock).not.toHaveBeenCalled();
  });

  it("creates the evidence package and rebuilds posture on succeeded", async () => {
    const response = await postProcessingCallback(
      request(
        callbackPayload({
          callbackId: "cb-0000000002",
          status: "succeeded",
          artifacts: SUCCEEDED_ARTIFACTS,
          benchmarkSummary: { wallClockSeconds: 812 },
        }),
        CALLBACK_TOKEN
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "succeeded" });

    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "succeeded",
        progress: 100,
        artifacts: SUCCEEDED_ARTIFACTS,
        benchmark_summary: { wallClockSeconds: 812 },
      })
    );

    expect(evidenceInsertMock).toHaveBeenCalledTimes(1);
    expect(evidenceInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mission_id: JOB_ROW.mission_id,
        workspace_id: JOB_ROW.workspace_id,
        project_id: JOB_ROW.project_id,
        title: "Hwy 49 corridor survey aerial processing outputs",
        package_type: "measurable_output",
        status: "ready",
        verification_readiness: "partial",
        processing_job_id: JOB_ROW.id,
        notes: expect.stringContaining("orthomosaic"),
      })
    );

    expect(rebuildAerialProjectPostureMock).toHaveBeenCalledTimes(1);
    const postureCall = rebuildAerialProjectPostureMock.mock.calls[0]?.[0] as {
      projectId: string;
      workspaceId: string;
    };
    expect(postureCall.projectId).toBe(JOB_ROW.project_id);
    expect(postureCall.workspaceId).toBe(JOB_ROW.workspace_id);
  });

  it("skips a second evidence package when one exists for the processing job", async () => {
    evidenceLookupMaybeSingleMock.mockResolvedValue({ data: { id: "pkg-1" }, error: null });

    const response = await postProcessingCallback(
      request(
        callbackPayload({
          callbackId: "cb-0000000003",
          status: "succeeded",
          artifacts: SUCCEEDED_ARTIFACTS,
        }),
        CALLBACK_TOKEN
      )
    );

    expect(response.status).toBe(200);
    expect(evidenceInsertMock).not.toHaveBeenCalled();
    expect(rebuildAerialProjectPostureMock).toHaveBeenCalledTimes(1);
  });

  it("dedupes a redelivered callbackId without a second evidence insert", async () => {
    ledgerInsertMock.mockResolvedValue({
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    const response = await postProcessingCallback(
      request(
        callbackPayload({
          callbackId: "cb-0000000002",
          status: "succeeded",
          artifacts: SUCCEEDED_ARTIFACTS,
        }),
        CALLBACK_TOKEN
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, deduped: true });
    expect(jobUpdateMock).not.toHaveBeenCalled();
    expect(evidenceInsertMock).not.toHaveBeenCalled();
  });

  it("ignores a running callback after the job reached a terminal status", async () => {
    jobMaybeSingleMock.mockResolvedValue({
      data: { ...JOB_ROW, status: "succeeded" },
      error: null,
    });

    const response = await postProcessingCallback(
      request(callbackPayload({ callbackId: "cb-0000000009", progress: 50 }), CALLBACK_TOKEN)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, ignored: "terminal" });
    // The delivery is still recorded in the idempotency ledger.
    expect(ledgerInsertMock).toHaveBeenCalledTimes(1);
    expect(jobUpdateMock).not.toHaveBeenCalled();
    expect(evidenceInsertMock).not.toHaveBeenCalled();
  });
});
