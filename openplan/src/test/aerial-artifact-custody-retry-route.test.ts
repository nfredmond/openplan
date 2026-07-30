import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * DEFERRED CUSTODY MUST HAVE A DOOR.
 *
 * Custody runs inside the processing callback under a wall-clock budget, so
 * some artifacts land `pending` and some land `failed`. Without a way to finish
 * them, every one of those is a deliverable that quietly expires — the exact
 * defect custody was built to end, re-created by the mechanism meant to end it.
 *
 * What these assert: the retry finishes only what is outstanding (never a second
 * copy of something already held), it reads the signed URLs from the
 * service-role-only callback ledger rather than from the member-readable custody
 * table, it refuses a viewer, it distinguishes "no source on record" from
 * "nothing to do", and a successful retry moves the evidence package's claim.
 */

const createServiceRoleClientMock = vi.fn();
const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const isAuthenticatedCallbackMock = vi.fn();

const jobMaybeSingleMock = vi.fn();
const custodySelectEqMock = vi.fn();
const custodyUpsertMock = vi.fn();
const ledgerLimitMock = vi.fn();
const jobUpdateEqMock = vi.fn();
const packageUpdateEqMock = vi.fn();
const packageUpdateMock = vi.fn();
const storageUploadMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const authGetUserMock = vi.fn();
const fetchMock = vi.fn();

const audit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const serviceFromMock = vi.fn((table: string) => {
  if (table === "aerial_processing_jobs") {
    return {
      select: () => ({ eq: () => ({ maybeSingle: jobMaybeSingleMock }) }),
      update: () => ({ eq: jobUpdateEqMock }),
    };
  }
  if (table === "aerial_artifact_custody") {
    return {
      select: () => ({ eq: custodySelectEqMock }),
      upsert: custodyUpsertMock,
    };
  }
  if (table === "aerial_processing_callbacks") {
    return {
      select: () => ({
        eq: () => ({ eq: () => ({ order: () => ({ limit: ledgerLimitMock }) }) }),
      }),
    };
  }
  if (table === "aerial_evidence_packages") {
    return { update: packageUpdateMock };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/api/aerial-processing-auth", () => ({
  isAuthenticatedAerialProcessingCallback: (...args: unknown[]) =>
    isAuthenticatedCallbackMock(...args),
}));

import { POST as postCustodyRetry } from "@/app/api/aerial/processing-callback/custody/route";

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const MISSION_ID = "22222222-2222-4222-8222-222222222222";

const SIGNED_URL = "https://worker.example.net/outputs/cloud.laz?X-Amz-Signature=deadbeefcafe";

function ledgerPayload() {
  return {
    schemaVersion: "natford-aerial-processing.v1",
    requestId: "11111111-1111-4111-8111-111111111111",
    callbackId: "cb-0000000042",
    jobReference: "worker-job-9",
    status: "succeeded",
    occurredAt: "2026-07-30T12:00:00Z",
    artifacts: [
      {
        kind: "orthomosaic",
        downloadUrl: "https://worker.example.net/outputs/ortho.tif?X-Amz-Signature=aaa",
        expiresAt: "2099-07-22T14:30:00Z",
        sizeBytes: 4,
        contentType: "image/tiff",
      },
      {
        kind: "point_cloud",
        downloadUrl: SIGNED_URL,
        expiresAt: "2099-07-22T14:30:00Z",
        sizeBytes: 4,
        contentType: "application/octet-stream",
      },
    ],
  };
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/aerial/processing-callback/custody", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/aerial/processing-callback/custody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(audit);
    createServiceRoleClientMock.mockReturnValue({
      from: serviceFromMock,
      storage: { from: () => ({ upload: storageUploadMock }) },
    });
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: membershipMaybeSingleMock }) }) }),
      }),
    });

    isAuthenticatedCallbackMock.mockReturnValue(true);
    jobMaybeSingleMock.mockResolvedValue({
      data: { id: JOB_ID, workspace_id: WORKSPACE_ID, mission_id: MISSION_ID, status: "succeeded" },
      error: null,
    });
    custodyUpsertMock.mockResolvedValue({ error: null });
    // The custody roll-up chains `.select("id")` so it can see whether it
    // changed anything.
    jobUpdateEqMock.mockReturnValue({
      select: () => Promise.resolve({ data: [{ id: JOB_ID }], error: null }),
    });
    packageUpdateEqMock.mockResolvedValue({ error: null });
    packageUpdateMock.mockReturnValue({ eq: packageUpdateEqMock });
    ledgerLimitMock.mockResolvedValue({ data: [{ payload: ledgerPayload() }], error: null });
    storageUploadMock.mockResolvedValue({ error: null });
    authGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "editor" }, error: null });

    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        })
      )
    );
  });

  it("retries only the artifact that is not held, and never re-downloads the one that is", async () => {
    // Read 1: the route's outstanding set. Read 2: the custody engine's own
    // pre-read, which is what stops a pass from rewriting a row it already
    // holds. Read 3+: the roll-up after the pass.
    const outstanding = {
      data: [
        { kind: "orthomosaic", ordinal: 0, state: "held", attempt_count: 1 },
        { kind: "point_cloud", ordinal: 0, state: "pending", attempt_count: 0 },
      ],
      error: null,
    };
    custodySelectEqMock
      .mockResolvedValueOnce(outstanding)
      .mockResolvedValueOnce(outstanding)
      .mockResolvedValue({
        data: [
          {
            kind: "orthomosaic",
            ordinal: 0,
            state: "held",
            storage_bucket: "aerial-artifacts",
            storage_path: "p",
            byte_size: 4,
            checksum_sha256: "a".repeat(64),
            content_type: "image/tiff",
            declared_size_bytes: 4,
            source_host: "worker.example.net",
            source_expires_at: "2099-07-22T14:30:00Z",
            failure_code: null,
            failure_detail: null,
            attempt_count: 1,
            held_at: "2026-07-30T00:00:00Z",
          },
          {
            kind: "point_cloud",
            ordinal: 0,
            state: "held",
            storage_bucket: "aerial-artifacts",
            storage_path: "q",
            byte_size: 4,
            checksum_sha256: "b".repeat(64),
            content_type: "application/octet-stream",
            declared_size_bytes: 4,
            source_host: "worker.example.net",
            source_expires_at: "2099-07-22T14:30:00Z",
            failure_code: null,
            failure_detail: null,
            attempt_count: 2,
            held_at: "2026-07-30T00:00:00Z",
          },
        ],
        error: null,
      });

    const response = await postCustodyRetry(request({ processingJobId: JOB_ID }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, custodyState: "complete", retriedCount: 1 });

    // Exactly one fetch, and it is the point cloud — the held orthomosaic is
    // never re-downloaded and never re-uploaded.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(SIGNED_URL);
    expect(storageUploadMock).toHaveBeenCalledTimes(1);

    // And the package's claim moves with the bytes.
    expect(packageUpdateMock).toHaveBeenCalledWith({ verification_readiness: "partial" });
  });

  it("answers without touching the worker when everything is already held", async () => {
    custodySelectEqMock.mockResolvedValue({
      data: [{ kind: "orthomosaic", ordinal: 0, state: "held" }],
      error: null,
    });

    const response = await postCustodyRetry(request({ processingJobId: JOB_ID }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ custodyState: "complete", retriedCount: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ledgerLimitMock).not.toHaveBeenCalled();
  });

  it("says a missing source is a missing source, not 'nothing to do'", async () => {
    custodySelectEqMock.mockResolvedValue({
      data: [{ kind: "orthomosaic", ordinal: 0, state: "failed" }],
      error: null,
    });
    ledgerLimitMock.mockResolvedValue({ data: [], error: null });

    const response = await postCustodyRetry(request({ processingJobId: JOB_ID }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("custody_source_unavailable");
    expect(body.detail).toContain("re-processed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a viewer, who may not write storage objects", async () => {
    isAuthenticatedCallbackMock.mockReturnValue(false);
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "viewer" }, error: null });
    custodySelectEqMock.mockResolvedValue({ data: [], error: null });

    const response = await postCustodyRetry(request({ processingJobId: JOB_ID }));

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller with no operator token", async () => {
    isAuthenticatedCallbackMock.mockReturnValue(false);
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await postCustodyRetry(request({ processingJobId: JOB_ID }));

    expect(response.status).toBe(401);
  });

  /**
   * The job lookup runs with the SERVICE role, which RLS does not apply to. If
   * it ran before identity was established, this endpoint would answer 404 for
   * an unknown processing-job id and 401 for a real one — an existence oracle
   * over every workspace's jobs, available to anyone. A signed-out caller must
   * get the same answer either way.
   */
  it("does not tell a signed-out caller whether the processing job exists", async () => {
    isAuthenticatedCallbackMock.mockReturnValue(false);
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    jobMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const unknown = await postCustodyRetry(request({ processingJobId: JOB_ID }));

    jobMaybeSingleMock.mockResolvedValue({
      data: { id: JOB_ID, workspace_id: WORKSPACE_ID, mission_id: MISSION_ID, status: "succeeded" },
      error: null,
    });
    const known = await postCustodyRetry(request({ processingJobId: JOB_ID }));

    expect(unknown.status).toBe(401);
    expect(known.status).toBe(401);
    expect(await known.json()).toEqual(await unknown.json());
  });

  it("refuses a member of another workspace", async () => {
    isAuthenticatedCallbackMock.mockReturnValue(false);
    membershipMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const response = await postCustodyRetry(request({ processingJobId: JOB_ID }));

    expect(response.status).toBe(403);
  });

  it("never returns the signed URL to the caller and never logs it", async () => {
    custodySelectEqMock
      .mockResolvedValueOnce({
        data: [{ kind: "point_cloud", ordinal: 0, state: "failed" }],
        error: null,
      })
      .mockResolvedValue({ data: [], error: null });

    const response = await postCustodyRetry(request({ processingJobId: JOB_ID }));
    const raw = JSON.stringify(await response.json());

    expect(raw).not.toContain("X-Amz-Signature");
    expect(raw).not.toContain("deadbeefcafe");

    const logged = JSON.stringify([
      ...audit.info.mock.calls,
      ...audit.warn.mock.calls,
      ...audit.error.mock.calls,
    ]);
    expect(logged).not.toContain("X-Amz-Signature");
    expect(logged).not.toContain("deadbeefcafe");
  });

  it("rejects a body that is not a processing job id", async () => {
    const response = await postCustodyRetry(request({ processingJobId: "not-a-uuid" }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
