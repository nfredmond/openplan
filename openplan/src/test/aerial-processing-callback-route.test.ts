import { Blob as ServerBlob } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const rebuildAerialProjectPostureMock = vi.fn();

const jobMaybeSingleMock = vi.fn();
const jobSelectMock = vi.fn();
const jobUpdateEqMock = vi.fn();
const jobUpdateMock = vi.fn();
const jobStatusEqMock = vi.fn();
const jobStatusIsMock = vi.fn();
const jobStatusSelectMock = vi.fn();
const ledgerInsertMock = vi.fn();
const ledgerLookupMock = vi.fn();
const ledgerSelectMock = vi.fn();
const ledgerLookupEqMock = vi.fn();
const evidenceLookupMaybeSingleMock = vi.fn();
const evidenceSelectMock = vi.fn();
const evidenceEqMock = vi.fn();
const evidenceReadinessUpdateMock = vi.fn();
const evidenceReadinessEqMock = vi.fn();
const evidenceInsertSingleMock = vi.fn();
const evidenceInsertMock = vi.fn();
const missionMaybeSingleMock = vi.fn();
const custodyUpsertMock = vi.fn();
const custodySelectEqMock = vi.fn();
const storageUploadMock = vi.fn();
const storageObjects = new Map<string, Uint8Array>();
const fetchMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "aerial_processing_jobs") {
    return {
      select: jobSelectMock,
      update: jobUpdateMock,
    };
  }

  if (table === "aerial_processing_callbacks") {
    return { insert: ledgerInsertMock, select: ledgerSelectMock };
  }

  if (table === "aerial_evidence_packages") {
    return {
      select: (columns: string) => {
        evidenceSelectMock(columns);
        return { eq: (column: string, value: string) => {
          evidenceEqMock(column, value);
          return { maybeSingle: evidenceLookupMaybeSingleMock };
        } };
      },
      insert: evidenceInsertMock,
      update: evidenceReadinessUpdateMock,
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

  if (table === "aerial_artifact_custody") {
    return {
      upsert: custodyUpsertMock,
      select: () => ({ eq: custodySelectEqMock }),
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
  last_callback_id: null,
  last_callback_at: null,
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

function retainedCallbacks(...payloads: ReturnType<typeof callbackPayload>[]) {
  const records = new Map(payloads.map((payload) => [payload.callbackId, {
    processing_job_id: JOB_ROW.id, workspace_id: JOB_ROW.workspace_id, payload,
  }]));
  ledgerLookupEqMock.mockImplementation((_key, id) => ({
    maybeSingle: () => Promise.resolve({ data: records.get(id) ?? null, error: null }),
  }));
}

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
    storageObjects.clear();
    jobStatusSelectMock.mockReset();
    jobUpdateEqMock.mockReset();
    process.env.OPENPLAN_AERIAL_PROCESSING_CALLBACK_BEARER_TOKEN = CALLBACK_TOKEN;

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createServiceRoleClientMock.mockReturnValue({
      from: fromMock,
      // workspace_storage_bytes: an empty workspace, so custody may store.
      rpc: async () => ({ data: 0, error: null }),
      storage: { from: () => ({
        upload: async (path: string, body: Uint8Array, options: { upsert?: boolean }) => {
          const result = await storageUploadMock(path, body, options);
          if (!result.error) {
            if (storageObjects.has(path) && options?.upsert !== true) return { error: { message: "Object already exists" } };
            storageObjects.set(path, new Uint8Array(body));
          }
          return result;
        },
        download: (path: string) => ({ asStream: async () => ({
          data: storageObjects.has(path) ? new ServerBlob([storageObjects.get(path)!]).stream() : null,
          error: null,
        }) }),
      }) },
    });

    // Custody now runs inside the succeeded branch. These stubs make it succeed
    // so the assertions below stay about the callback's OWN behaviour; the
    // custody engine itself has its own suite.
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/tiff" },
      })
    );
    storageUploadMock.mockResolvedValue({ error: null });
    custodyUpsertMock.mockImplementation(async (rows: unknown[]) => {
      custodySelectEqMock.mockResolvedValue({ data: rows, error: null });
      return { error: null };
    });
    custodySelectEqMock.mockResolvedValue({
      data: [
        {
          kind: "orthomosaic",
          ordinal: 0,
          state: "held",
          storage_bucket: "aerial-artifacts",
          storage_path: "ws/mission/job/orthomosaic.tif",
          byte_size: 3,
          checksum_sha256: "a".repeat(64),
          content_type: "image/tiff",
          declared_size_bytes: 123456,
          source_host: "storage.example.com",
          source_expires_at: "2099-07-22T14:30:00Z",
          failure_code: null,
          failure_detail: null,
          attempt_count: 1,
          held_at: "2026-07-21T12:00:00Z",
        },
      ],
      error: null,
    });

    jobSelectMock.mockReturnValue({ eq: () => ({ maybeSingle: jobMaybeSingleMock }) });
    jobMaybeSingleMock.mockResolvedValue({ data: { ...JOB_ROW }, error: null });
    ledgerInsertMock.mockResolvedValue({ error: null });
    ledgerLookupMock.mockResolvedValue({ data: null, error: null });
    ledgerLookupEqMock.mockReturnValue({ maybeSingle: ledgerLookupMock });
    ledgerSelectMock.mockReturnValue({ eq: ledgerLookupEqMock });
    // The status write ends at `.eq()`; the custody roll-up chains
    // `.select("id")` so it can see whether it changed anything.
    const guardedStatusQuery = { eq: jobStatusEqMock, is: jobStatusIsMock, select: jobStatusSelectMock };
    jobStatusEqMock.mockReturnValue(guardedStatusQuery);
    jobStatusIsMock.mockReturnValue(guardedStatusQuery);
    jobStatusSelectMock.mockResolvedValue({ data: [{ id: JOB_ROW.id }], error: null });
    jobUpdateEqMock.mockReturnValue(
      Object.assign(Promise.resolve({ error: null }), {
        eq: jobStatusEqMock,
        select: () => Promise.resolve({ data: [{ id: JOB_ROW.id }], error: null }),
      })
    );
    jobUpdateMock.mockReturnValue({ eq: jobUpdateEqMock });
    evidenceLookupMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    evidenceReadinessEqMock.mockReturnValue({ eq: evidenceReadinessEqMock,
      select: () => Promise.resolve({ data: [{ id: JOB_ROW.id }], error: null }) });
    evidenceReadinessUpdateMock.mockReturnValue({ eq: evidenceReadinessEqMock });
    evidenceInsertSingleMock.mockResolvedValue({ data: { id: "pkg-1", processing_job_id: JOB_ROW.id, workspace_id: JOB_ROW.workspace_id, mission_id: JOB_ROW.mission_id, project_id: JOB_ROW.project_id, package_type: "measurable_output" }, error: null });
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

  it("does not create a package from an unreadable custody pass", async () => {
    custodySelectEqMock.mockResolvedValue({ data: null, error: { message: "Synthetic read failure" } });
    const response = await postProcessingCallback(request(callbackPayload({ status: "succeeded", artifacts: SUCCEEDED_ARTIFACTS }), CALLBACK_TOKEN));
    expect(response.status, "Unreadable callback custody remains retryable").toBe(503);
    expect(evidenceInsertMock, "Unreadable callback cannot create a pending package").not.toHaveBeenCalled();
  });

  it("repairs pending package custody without changing human verification", async () => {
    evidenceLookupMaybeSingleMock.mockResolvedValue({ data: {
      id: JOB_ROW.id, processing_job_id: JOB_ROW.id, workspace_id: JOB_ROW.workspace_id,
      mission_id: JOB_ROW.mission_id, project_id: JOB_ROW.project_id, package_type: "measurable_output",
    }, error: null });
    const response = await postProcessingCallback(request(callbackPayload({ status: "succeeded", artifacts: SUCCEEDED_ARTIFACTS }), CALLBACK_TOKEN));
    expect(response.status).toBe(200);
    expect(evidenceInsertMock).not.toHaveBeenCalled();
    expect(evidenceReadinessUpdateMock, "Callback repairs pending package custody").toHaveBeenCalledWith({ verification_readiness: "partial" });
    expect(evidenceReadinessEqMock, "Callback preserves human verification").toHaveBeenCalledWith("verification_readiness", "pending");
  });

  it("leaves existing package verification unchanged when no artifact is held", async () => {
    custodySelectEqMock.mockResolvedValue({ data: [], error: null });
    evidenceLookupMaybeSingleMock.mockResolvedValue({ data: {
      id: JOB_ROW.id, processing_job_id: JOB_ROW.id, workspace_id: JOB_ROW.workspace_id,
      mission_id: JOB_ROW.mission_id, project_id: JOB_ROW.project_id, package_type: "measurable_output",
    }, error: null });
    const response = await postProcessingCallback(request(callbackPayload({ status: "succeeded", artifacts: SUCCEEDED_ARTIFACTS }), CALLBACK_TOKEN));
    expect(response.status).toBe(200);
    expect(evidenceReadinessUpdateMock, "Pending callback cannot lower human verification").not.toHaveBeenCalled();
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
        // REDACTED — the signed downloadUrl is a bearer credential and this row
        // is readable by every workspace member.
        artifacts: [
          {
            kind: "orthomosaic",
            ordinal: 0,
            expiresAt: "2026-07-22T14:30:00Z",
            sizeBytes: 123456,
            contentType: "image/tiff",
            sourceHost: "storage.example.com",
          },
        ],
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

  it("passes a v1.1 artifact's validated georeference into the custody rows", async () => {
    const response = await postProcessingCallback(
      request(
        callbackPayload({
          callbackId: "cb-0000000012",
          status: "succeeded",
          artifacts: [
            {
              kind: "ortho_preview",
              downloadUrl: "https://storage.example.com/preview.png?signature=abc",
              expiresAt: "2099-07-22T14:30:00Z",
              contentType: "image/png",
              boundsWgs84: [-120.51, 39.2, -120.49, 39.22],
              crs: "EPSG:32610",
              pixelSizeM: 0.021,
            },
          ],
        }),
        CALLBACK_TOKEN
      )
    );

    expect(response.status).toBe(200);
    expect(custodyUpsertMock).toHaveBeenCalledTimes(1);
    const rows = custodyUpsertMock.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows[0], "Valid callback georeference remains recorded").toMatchObject({
      kind: "ortho_preview",
      state: "held",
      bounds_west: -120.51,
      bounds_south: 39.2,
      bounds_east: -120.49,
      bounds_north: 39.22,
      crs: "EPSG:32610",
      pixel_size_m: 0.021,
    });
  });

  it("refuses an implausible georeference at intake, records why, and still takes custody", async () => {
    const response = await postProcessingCallback(
      request(
        callbackPayload({
          callbackId: "cb-0000000013",
          status: "succeeded",
          artifacts: [
            {
              kind: "ortho_preview",
              downloadUrl: "https://storage.example.com/preview.png?signature=abc",
              expiresAt: "2099-07-22T14:30:00Z",
              contentType: "image/png",
              // Passes the contract's ordering refine, fails the plausibility
              // ceiling: a rectangle spanning a third of a continent.
              boundsWgs84: [-120, 30, -100, 40],
            },
          ],
        }),
        CALLBACK_TOKEN
      )
    );

    expect(response.status).toBe(200);
    // Custody still happens — the bytes matter more than the placement — but
    // the row carries no georef, and the refusal reason is on the record.
    const rows = custodyUpsertMock.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows[0], "Refused callback georeference remains null").toMatchObject({
      kind: "ortho_preview",
      state: "held",
      bounds_west: null,
      bounds_south: null,
      bounds_east: null,
      bounds_north: null,
    });
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "artifact_georef_refused",
      expect.objectContaining({ kind: "ortho_preview", reason: expect.stringMatching(/degrees/) })
    );
  });

  it("a v1 artifact with no georef fields lands with all-null placement — the honest external-worker case", async () => {
    // The default stub says an orthomosaic is ALREADY held, which makes the
    // engine skip it (correctly). Empty prior custody so the write happens.
    custodySelectEqMock.mockResolvedValue({ data: [], error: null });
    const response = await postProcessingCallback(
      request(
        callbackPayload({
          callbackId: "cb-0000000014",
          status: "succeeded",
          artifacts: SUCCEEDED_ARTIFACTS,
        }),
        CALLBACK_TOKEN
      )
    );

    expect(response.status).toBe(200);
    const rows = custodyUpsertMock.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows[0], "Absent callback georeference remains null").toMatchObject({
      bounds_west: null,
      bounds_south: null,
      bounds_east: null,
      bounds_north: null,
      crs: null,
      pixel_size_m: null,
    });
    expect(mockAudit.warn).not.toHaveBeenCalledWith("artifact_georef_refused", expect.anything());
  });

  it("skips a second evidence package when one exists for the processing job", async () => {
    evidenceLookupMaybeSingleMock.mockResolvedValue({ data: { id: "pkg-1", processing_job_id: JOB_ROW.id, workspace_id: JOB_ROW.workspace_id, mission_id: JOB_ROW.mission_id, project_id: JOB_ROW.project_id, package_type: "measurable_output" }, error: null });

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

  it("resumes an exact redelivery without a second evidence insert", async () => {
    ledgerInsertMock.mockResolvedValue({
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    const payload = callbackPayload({
      callbackId: "cb-0000000002", status: "succeeded", artifacts: SUCCEEDED_ARTIFACTS,
    });
    ledgerLookupMock.mockResolvedValue({ data: {
      processing_job_id: JOB_ROW.id, workspace_id: JOB_ROW.workspace_id, payload,
    }, error: null });
    evidenceLookupMaybeSingleMock.mockResolvedValue({ data: { id: "pkg-1", processing_job_id: JOB_ROW.id, workspace_id: JOB_ROW.workspace_id, mission_id: JOB_ROW.mission_id, project_id: JOB_ROW.project_id, package_type: "measurable_output" }, error: null });
    const response = await postProcessingCallback(request(payload, CALLBACK_TOKEN));

    expect(response.status).toBe(200);
    expect(await response.json(), "Exact retained retry must apply pending effects").toEqual({ ok: true, status: "succeeded", replayed: true });
    expect(jobUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded" }));
    expect(evidenceInsertMock).not.toHaveBeenCalled();
    expect(ledgerSelectMock, "Replay loads both scope and payload").toHaveBeenCalledWith("processing_job_id, workspace_id, payload");
    expect(ledgerLookupEqMock, "Replay loads exact original callback key").toHaveBeenCalledWith("callback_id", payload.callbackId);
  });

  it("finishes a job update after its original ledger write survived an error", async () => {
    const payload = callbackPayload({ progress: 40, message: "matching features" });
    const failure = { message: "interrupted status update" };
    jobUpdateEqMock.mockReturnValueOnce(Object.assign(Promise.resolve({ error: failure }), {
      eq: jobStatusEqMock,
    }));
    jobStatusSelectMock.mockResolvedValueOnce({ data: null, error: failure });
    const first = await postProcessingCallback(request(payload, CALLBACK_TOKEN));
    expect(first.status).toBe(500);
    ledgerInsertMock.mockResolvedValue({ error: { code: "23505", message: "already retained" } });
    ledgerLookupMock.mockResolvedValue({ data: {
      processing_job_id: JOB_ROW.id, workspace_id: JOB_ROW.workspace_id,
      payload: Object.fromEntries(Object.entries(payload).reverse()),
    }, error: null });
    const resumed = await postProcessingCallback(request(payload, CALLBACK_TOKEN));
    expect(resumed.status).toBe(200);
    expect(await resumed.json(), "Interrupted ledger replay must finish status").toEqual({ ok: true, status: "running", replayed: true });
    expect(jobUpdateMock).toHaveBeenCalledTimes(2);
    expect(jobUpdateMock.mock.calls[1][0]).toEqual(jobUpdateMock.mock.calls[0][0]);
  });

  it("finishes evidence creation after its original job update survived an error", async () => {
    const payload = callbackPayload({ status: "succeeded", artifacts: SUCCEEDED_ARTIFACTS });
    evidenceInsertSingleMock.mockResolvedValueOnce({ data: null, error: { message: "interrupted package write" } });
    expect((await postProcessingCallback(request(payload, CALLBACK_TOKEN))).status).toBe(500);
    ledgerInsertMock.mockResolvedValue({ error: { code: "23505" } });
    ledgerLookupMock.mockResolvedValue({ data: {
      processing_job_id: JOB_ROW.id, workspace_id: JOB_ROW.workspace_id, payload,
    }, error: null });
    jobMaybeSingleMock.mockResolvedValue({ data: { ...JOB_ROW, status: "succeeded" }, error: null });
    const resumed = await postProcessingCallback(request(payload, CALLBACK_TOKEN));
    expect(resumed.status).toBe(200);
    expect(evidenceInsertSingleMock, "Interrupted ledger replay must finish evidence").toHaveBeenCalledTimes(2);
    expect(rebuildAerialProjectPostureMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a duplicate whose original callback cannot be read", async () => {
    ledgerInsertMock.mockResolvedValue({ error: { code: "23505" } });
    ledgerLookupMock.mockResolvedValue({ data: null, error: { message: "lookup unavailable" } });
    const response = await postProcessingCallback(request(callbackPayload(), CALLBACK_TOKEN));
    expect(response.status, "Unavailable original cannot acknowledge replay").toBe(500);
    expect(jobUpdateMock).not.toHaveBeenCalled();
  });

  it("refuses changed or missing duplicate payload and scope without applying it", async () => {
    const payload = callbackPayload();
    ledgerInsertMock.mockResolvedValue({ error: { code: "23505" } });
    for (const data of [null,
      { processing_job_id: "other-job", workspace_id: JOB_ROW.workspace_id, payload },
      { processing_job_id: JOB_ROW.id, workspace_id: "other-workspace", payload },
      { processing_job_id: JOB_ROW.id, workspace_id: JOB_ROW.workspace_id, payload: { ...payload, progress: 90 } },
    ]) {
      ledgerLookupMock.mockResolvedValue({ data, error: null });
      const response = await postProcessingCallback(request(payload, CALLBACK_TOKEN));
      expect(response.status, "Changed callback originals cannot be applied").toBe(409);
    }
    expect(jobUpdateMock).not.toHaveBeenCalled();
    expect(evidenceInsertMock).not.toHaveBeenCalled();
  });

  it("refuses a different worker job reference before recording or applying it", async () => {
    const response = await postProcessingCallback(request(callbackPayload({ jobReference: "other-worker-job" }), CALLBACK_TOKEN));
    expect(response.status, "Different worker reference cannot be applied").toBe(409);
    expect(ledgerInsertMock).not.toHaveBeenCalled();
    expect(jobUpdateMock).not.toHaveBeenCalled();
  });

  it("requires the observed state and worker reference in the status write", async () => {
    expect((await postProcessingCallback(request(callbackPayload(), CALLBACK_TOKEN))).status).toBe(200);
    expect(jobUpdateEqMock, "Write guards original job identity").toHaveBeenCalledWith("id", JOB_ROW.id);
    expect(jobStatusEqMock, "Write guards observed status").toHaveBeenCalledWith("status", JOB_ROW.status);
    expect(jobStatusEqMock, "Write guards observed worker reference").toHaveBeenCalledWith("job_reference", JOB_ROW.job_reference);
    expect(jobStatusSelectMock, "Write verifies affected job projection").toHaveBeenCalledWith("id");
  });

  it("guards an unset worker reference before assigning the first one", async () => {
    jobMaybeSingleMock.mockResolvedValue({ data: { ...JOB_ROW, job_reference: null }, error: null });
    expect((await postProcessingCallback(request(callbackPayload(), CALLBACK_TOKEN))).status).toBe(200);
    expect(jobStatusIsMock, "Write guards original null reference").toHaveBeenCalledWith("job_reference", null);
    expect(jobUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ job_reference: "worker-job-9" }));
  });

  it("retries a changed or missing job without applying downstream artifacts", async () => {
    const payload = callbackPayload({ status: "succeeded", artifacts: SUCCEEDED_ARTIFACTS });
    for (const data of [[], null, [{ id: "other-job" }], [{ id: JOB_ROW.id }, { id: "other-job" }]]) {
      jobStatusSelectMock.mockResolvedValue({ data, error: null });
      const response = await postProcessingCallback(request(payload, CALLBACK_TOKEN));
      expect(response.status, "Changed or missing job cannot apply artifacts").toBe(503);
    }
    expect(evidenceInsertMock).not.toHaveBeenCalled();
    expect(rebuildAerialProjectPostureMock).not.toHaveBeenCalled();
  });

  it("preserves a newer same-status event when an older original is replayed", async () => {
    const payload = callbackPayload({ progress: 20, message: "older work" });
    ledgerInsertMock.mockResolvedValue({ error: { code: "23505" } });
    ledgerLookupMock.mockResolvedValue({ data: {
      processing_job_id: JOB_ROW.id, workspace_id: JOB_ROW.workspace_id, payload,
    }, error: null });
    for (const occurredAt of ["2026-07-21T12:00:01Z", payload.occurredAt]) {
      retainedCallbacks(payload, callbackPayload({ callbackId: "newer-callback", occurredAt }));
      jobMaybeSingleMock.mockResolvedValue({ data: { ...JOB_ROW, status: "running",
        last_callback_id: "newer-callback", last_callback_at: occurredAt,
      }, error: null });
      const response = await postProcessingCallback(request(payload, CALLBACK_TOKEN));
      expect(await response.json(), "Older replay cannot replace a newer same-status callback").toEqual({ ok: true, ignored: "superseded" });
    }
    expect(jobUpdateMock).not.toHaveBeenCalled();
  });

  it("allows a newer original retry and guards its observed callback identity", async () => {
    const payload = callbackPayload({ occurredAt: "2026-07-21T12:00:02Z", progress: 70 });
    ledgerInsertMock.mockResolvedValue({ error: { code: "23505" } });
    ledgerLookupMock.mockResolvedValue({ data: {
      processing_job_id: JOB_ROW.id, workspace_id: JOB_ROW.workspace_id, payload,
    }, error: null });
    retainedCallbacks(payload, callbackPayload({ callbackId: "older-callback", occurredAt: "2026-07-21T12:00:01Z" }));
    jobMaybeSingleMock.mockResolvedValue({ data: { ...JOB_ROW, status: "running",
      last_callback_id: "older-callback", last_callback_at: "2026-07-21T12:00:01Z",
    }, error: null });
    const response = await postProcessingCallback(request(payload, CALLBACK_TOKEN));
    expect(response.status, "A newer retained original can still finish").toBe(200);
    expect(jobStatusEqMock, "Write guards observed callback identity").toHaveBeenCalledWith("last_callback_id", "older-callback");
    expect(jobStatusEqMock, "Write guards observed callback time").toHaveBeenCalledWith("last_callback_at", "2026-07-21T12:00:01Z");
    expect(jobSelectMock, "Replay reads callback ordering fields").toHaveBeenCalledWith("id, workspace_id, project_id, mission_id, request_id, job_reference, status, last_callback_id, last_callback_at");
  });

  it("guards empty callback identity and time on the first application", async () => {
    expect((await postProcessingCallback(request(callbackPayload(), CALLBACK_TOKEN))).status).toBe(200);
    expect(jobStatusIsMock, "Write guards original empty callback identity").toHaveBeenCalledWith("last_callback_id", null);
    expect(jobStatusIsMock, "Write guards original empty callback time").toHaveBeenCalledWith("last_callback_at", null);
  });

  it("keeps one deterministic evidence package when exact retries overlap", async () => {
    const payload = callbackPayload({ status: "succeeded", artifacts: [] });
    jobMaybeSingleMock.mockResolvedValue({ data: { ...JOB_ROW, status: "succeeded",
      last_callback_id: payload.callbackId, last_callback_at: payload.occurredAt }, error: null });
    ledgerInsertMock.mockResolvedValue({ error: { code: "23505" } });
    ledgerLookupMock.mockResolvedValue({ data: { processing_job_id: JOB_ROW.id,
      workspace_id: JOB_ROW.workspace_id, payload }, error: null });
    const packages = new Map<string, Record<string, unknown>>();
    let lookups = 0;
    let release: () => void = () => {};
    const bothLooked = new Promise<void>((resolve) => { release = resolve; });
    evidenceLookupMaybeSingleMock.mockImplementation(async () => {
      lookups += 1;
      if (lookups <= 2) {
        if (lookups === 2) release();
        await bothLooked;
        return { data: null, error: null };
      }
      return { data: packages.get(JOB_ROW.id) ?? null, error: null };
    });
    evidenceInsertSingleMock.mockImplementation(async () => {
      const row = evidenceInsertMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      const id = String(row.id);
      if (packages.has(id)) return { data: null, error: { code: "23505" } };
      packages.set(id, { ...row, title: "Retained human title" });
      return { data: { id }, error: null };
    });
    const responses = await Promise.all([
      postProcessingCallback(request(payload, CALLBACK_TOKEN)),
      postProcessingCallback(request(payload, CALLBACK_TOKEN)),
    ]);
    expect([...packages.keys()], "Concurrent packages share the deterministic job primary key").toEqual([JOB_ROW.id]);
    expect(responses.map((response) => response.status), "Both exact retries complete after a primary-key conflict").toEqual([200, 200]);
    expect(packages.get(JOB_ROW.id)?.title, "A replay preserves human changes to the original package").toBe("Retained human title");
    expect(evidenceSelectMock, "Package replay projects all original scope fields").toHaveBeenCalledWith("id, processing_job_id, workspace_id, mission_id, project_id, package_type");
    expect(evidenceEqMock, "Conflicting creation reads the deterministic original ID").toHaveBeenCalledWith("id", JOB_ROW.id);
    expect(mockAudit.info, "Conflicting creation records reuse of the original package").toHaveBeenCalledWith("evidence_package_reused", expect.objectContaining({ packageId: JOB_ROW.id }));
  });

  it("refuses a conflicting package outside the exact original scope", async () => {
    const payload = callbackPayload({ status: "succeeded", artifacts: [] });
    evidenceInsertSingleMock.mockResolvedValue({ data: null, error: { code: "23505" } });
    const correct = { id: JOB_ROW.id, processing_job_id: JOB_ROW.id,
      workspace_id: JOB_ROW.workspace_id, mission_id: JOB_ROW.mission_id,
      project_id: JOB_ROW.project_id, package_type: "measurable_output" };
    for (const field of ["id", "processing_job_id", "workspace_id", "mission_id", "project_id", "package_type"]) {
      evidenceLookupMaybeSingleMock.mockReset();
      evidenceLookupMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValue({ data: { ...correct, [field]: "foreign-value" }, error: null });
      const response = await postProcessingCallback(request(payload, CALLBACK_TOKEN));
      expect(response.status, "Conflicting package retains exact binding: " + field).toBe(409);
    }
  });

  it("refuses a legacy linked package outside the processing scope", async () => {
    const payload = callbackPayload({ status: "succeeded", artifacts: [] });
    evidenceLookupMaybeSingleMock.mockResolvedValue({ data: { id: "legacy-package",
      processing_job_id: JOB_ROW.id, workspace_id: "foreign-workspace",
      mission_id: JOB_ROW.mission_id, project_id: JOB_ROW.project_id, package_type: "measurable_output" }, error: null });
    const response = await postProcessingCallback(request(payload, CALLBACK_TOKEN));
    expect(response.status, "Legacy package must belong to the original processing scope").toBe(409);
    expect(evidenceInsertMock).not.toHaveBeenCalled();
  });

  it("advances a legacy accepted pointer whose synchronous event was never posted", async () => {
    jobMaybeSingleMock.mockResolvedValue({ data: { ...JOB_ROW,
      last_callback_id: "cb-original-accepted", last_callback_at: "2026-07-21T12:00:00+00:00",
    }, error: null });
    ledgerLookupMock.mockResolvedValue({ data: null, error: null });
    const response = await postProcessingCallback(request(callbackPayload({ occurredAt: "2026-07-21T12:01:00Z" }), CALLBACK_TOKEN));
    expect(response.status, "First posted callback advances the legacy synchronous baseline").toBe(200);
    expect(jobUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ status: "running" }));
    expect(jobStatusEqMock).toHaveBeenCalledWith("status", "accepted");
    expect(jobStatusEqMock).toHaveBeenCalledWith("last_callback_id", "cb-original-accepted");
  });

  it("refuses unreadable callback ordering without applying it", async () => {
    const applied = callbackPayload({ callbackId: "other-callback" });
    jobMaybeSingleMock.mockResolvedValue({ data: { ...JOB_ROW,
      status: "running", last_callback_id: applied.callbackId, last_callback_at: applied.occurredAt,
    }, error: null });
    const correct = { processing_job_id: JOB_ROW.id, workspace_id: JOB_ROW.workspace_id, payload: applied };
    for (const value of [
      { data: null, error: null }, { data: null, error: { message: "lookup unavailable" } },
      { data: { ...correct, processing_job_id: "foreign-job" }, error: null },
      { data: { ...correct, workspace_id: "foreign-workspace" }, error: null },
      { data: { ...correct, payload: { ...applied, callbackId: "foreign-callback" } }, error: null },
      { data: { ...correct, payload: { ...applied, occurredAt: "not a time" } }, error: null },
    ]) {
      ledgerLookupMock.mockResolvedValue(value);
      const response = await postProcessingCallback(request(callbackPayload(), CALLBACK_TOKEN));
      expect(response.status, "Unreadable callback order cannot apply effects").toBe(503);
    }
    expect(jobUpdateMock).not.toHaveBeenCalled();
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
