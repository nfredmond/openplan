import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();

const authGetUserMock = vi.fn();
const missionMaybeSingleMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const activeJobMaybeSingleMock = vi.fn();
const imageryCountMock = vi.fn();
const imageryListMock = vi.fn();
const storageSignedUrlsMock = vi.fn();
const storageFromMock = vi.fn(() => ({ createSignedUrls: storageSignedUrlsMock }));
const jobInsertSingleMock = vi.fn();
const jobInsertMock = vi.fn();
const jobUpdateEqMock = vi.fn();
const jobUpdateMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "aerial_missions") {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: missionMaybeSingleMock,
        }),
      }),
    };
  }

  if (table === "workspace_members") {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: membershipMaybeSingleMock,
          }),
        }),
      }),
    };
  }

  if (table === "aerial_imagery") {
    return {
      // Two shapes: the GET capability handler counts (head:true), the v1.1
      // dispatch lists rows ordered by filename.
      select: (_columns: string, options?: { head?: boolean }) => {
        if (options?.head) {
          return { eq: imageryCountMock };
        }
        return { eq: () => ({ order: imageryListMock }) };
      },
    };
  }

  if (table === "aerial_processing_jobs") {
    return {
      select: () => ({
        eq: () => ({
          in: () => ({
            limit: () => ({
              maybeSingle: activeJobMaybeSingleMock,
            }),
          }),
        }),
      }),
      insert: jobInsertMock,
      update: jobUpdateMock,
    };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  // The dispatch route writes aerial_processing_jobs with the service role
  // (member RLS is SELECT-only) and mints signed imagery URLs through the
  // service client's storage API; route both clients at the same fromMock.
  createServiceRoleClient: () => ({ from: fromMock, storage: { from: storageFromMock } }),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import {
  GET as getProcessCapability,
  POST as postProcessMission,
} from "@/app/api/aerial/missions/[missionId]/process/route";

const MISSION_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "00000000-0000-4000-8000-000000000001";

function request(body?: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/aerial/missions/${MISSION_ID}/process`, {
    method: "POST",
    body: JSON.stringify(body ?? { imageryZipUrl: "https://storage.example.com/imagery.zip" }),
    headers: { "content-type": "application/json" },
  });
}

function capabilityRequest() {
  return new NextRequest(`http://localhost/api/aerial/missions/${MISSION_ID}/process`, {
    method: "GET",
  });
}

function routeContext() {
  return { params: Promise.resolve({ missionId: MISSION_ID }) };
}

function acceptedWorkerResponse(requestId: string, schemaVersion = "natford-aerial-processing.v1") {
  return {
    schemaVersion,
    requestId,
    callbackId: "cb-accept-01",
    jobReference: "worker-job-9",
    status: "accepted",
    occurredAt: "2026-07-21T12:00:00Z",
  };
}

function storedImageryRows() {
  return [
    {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
      storage_bucket: "aerial-imagery",
      storage_path: `${WORKSPACE_ID}/${MISSION_ID}/img-1/DJI_0001.JPG`,
      original_filename: "DJI_0001.JPG",
      byte_size: 8_000_000,
      checksum_sha256: "a".repeat(64),
    },
    {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
      storage_bucket: "aerial-imagery",
      storage_path: `${WORKSPACE_ID}/${MISSION_ID}/img-2/DJI_0002.JPG`,
      original_filename: "DJI_0002.JPG",
      byte_size: 9_000_000,
      checksum_sha256: "b".repeat(64),
    },
  ];
}

describe("POST /api/aerial/missions/[missionId]/process", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_URL;
    delete process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN;
    delete process.env.OPENPLAN_AERIAL_PROCESSING_CALLBACK_URL;
    delete process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_CONTRACT;
    delete process.env.OPENPLAN_AERIAL_IMAGERY_URL_TTL_SECONDS;

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    missionMaybeSingleMock.mockResolvedValue({
      data: {
        id: MISSION_ID,
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        title: "Hwy 49 corridor survey",
      },
      error: null,
    });
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "editor" }, error: null });
    activeJobMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    imageryCountMock.mockResolvedValue({ count: 0, error: null });
    imageryListMock.mockResolvedValue({ data: [], error: null });
    storageSignedUrlsMock.mockResolvedValue({ data: [], error: null });
    jobInsertSingleMock.mockResolvedValue({
      data: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      error: null,
    });
    jobInsertMock.mockReturnValue({ select: () => ({ single: jobInsertSingleMock }) });
    jobUpdateEqMock.mockResolvedValue({ error: null });
    jobUpdateMock.mockReturnValue({ eq: jobUpdateEqMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the 501 boundary when the worker env vars are unset", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await postProcessMission(request(), routeContext());

    expect(response.status).toBe(501);
    const payload = await response.json();
    expect(payload.schemaVersion).toBe("natford-odm-stub-1");
    expect(payload.status).toBe("not-implemented");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jobInsertMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await postProcessMission(request(), routeContext());

    expect(response.status).toBe(401);
  });

  it("returns 409 when a processing job is already active for the mission", async () => {
    process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_URL = "https://worker.example.com";
    process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN = "worker-secret";
    activeJobMaybeSingleMock.mockResolvedValue({
      data: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        request_id: "11111111-1111-4111-8111-111111111111",
        status: "running",
      },
      error: null,
    });

    const response = await postProcessMission(request(), routeContext());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "processing_already_active",
      requestId: "11111111-1111-4111-8111-111111111111",
    });
    expect(jobInsertMock).not.toHaveBeenCalled();
  });

  it("accepts a localhost http imagery URL but rejects plain-http remote URLs", async () => {
    process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_URL = "https://worker.example.com";
    process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN = "worker-secret";

    const rejected = await postProcessMission(
      request({ imageryZipUrl: "http://storage.example.com/imagery.zip" }),
      routeContext()
    );
    expect(rejected.status).toBe(400);

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const dispatched = JSON.parse(String(init.body));
      expect(dispatched.imagery.url).toBe("http://localhost:3300/imagery.zip");
      return {
        status: 202,
        ok: true,
        json: async () => acceptedWorkerResponse(dispatched.requestId),
        text: async () => "",
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const accepted = await postProcessMission(
      request({ imageryZipUrl: "http://localhost:3300/imagery.zip" }),
      routeContext()
    );
    expect(accepted.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dispatches to the worker and records the accepted job", async () => {
    process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_URL = "https://worker.example.com/";
    process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN = "worker-secret";
    process.env.OPENPLAN_AERIAL_PROCESSING_CALLBACK_URL = "https://openplan.example.com";

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const dispatched = JSON.parse(String(init.body));
      return {
        status: 202,
        ok: true,
        json: async () => acceptedWorkerResponse(dispatched.requestId),
        text: async () => "",
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await postProcessMission(
      request({
        imageryZipUrl: "https://storage.example.com/imagery.zip",
        imageCount: 120,
        sizeBytes: 2048,
        presetId: "high-quality",
        notes: "corridor run",
      }),
      routeContext()
    );

    expect(response.status).toBe(202);
    const payload = await response.json();
    expect(payload.status).toBe("accepted");
    expect(payload.jobReference).toBe("worker-job-9");
    expect(typeof payload.requestId).toBe("string");

    // Row inserted before the worker call, with the dispatch inputs.
    expect(jobInsertMock).toHaveBeenCalledTimes(1);
    expect(jobInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        mission_id: MISSION_ID,
        request_id: payload.requestId,
        status: "requested",
        preset_id: "high-quality",
        imagery_url: "https://storage.example.com/imagery.zip",
        imagery_image_count: 120,
        imagery_size_bytes: 2048,
        created_by: USER_ID,
      })
    );

    // DEPLOY/MIGRATE WINDOW SAFETY: a zip job row must not name the
    // imagery_type column at all — it relies on the DB default, so the zip
    // lane keeps working on a deployment where 20260811000004 has not run yet.
    expect(jobInsertMock.mock.calls[0][0]).not.toHaveProperty("imagery_type");

    // Worker fetch with bearer auth and a contract-shaped payload.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [workerUrl, workerInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(workerUrl).toBe("https://worker.example.com/api/v1/processing-requests");
    expect((workerInit.headers as Record<string, string>).authorization).toBe(
      "Bearer worker-secret"
    );
    const dispatched = JSON.parse(String(workerInit.body));
    expect(dispatched.schemaVersion).toBe("natford-aerial-processing.v1");
    expect(dispatched.callbackUrl).toBe(
      "https://openplan.example.com/api/aerial/processing-callback"
    );
    expect(dispatched.externalRef).toEqual({
      system: "openplan",
      missionId: MISSION_ID,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
    });
    expect(dispatched.missionTitle).toBe("Hwy 49 corridor survey");
    expect(dispatched.imagery).toEqual({
      type: "zip_url",
      url: "https://storage.example.com/imagery.zip",
      imageCount: 120,
      sizeBytes: 2048,
    });
    expect(dispatched.presetId).toBe("high-quality");
    expect(dispatched.notes).toBe("corridor run");

    // Byte-identical v1: no v1.1 marker or manifest key anywhere in the
    // payload the external worker's strict validator will see.
    expect(String(workerInit.body)).not.toContain("v1.1");
    expect(String(workerInit.body)).not.toContain("photo_manifest");

    // Row advanced to accepted with the worker's job reference.
    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "accepted",
        job_reference: "worker-job-9",
        last_callback_id: "cb-accept-01",
        last_callback_at: "2026-07-21T12:00:00Z",
      })
    );
  });

  it("marks the job dispatch_failed and returns 502 on worker failure", async () => {
    process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_URL = "https://worker.example.com";
    process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN = "worker-secret";

    const fetchMock = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await postProcessMission(request(), routeContext());

    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload.error).toBe("worker_dispatch_failed");
    expect(payload.detail).toContain("ECONNREFUSED");

    expect(jobInsertMock).toHaveBeenCalledTimes(1);
    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "dispatch_failed",
        dispatch_error: expect.stringContaining("ECONNREFUSED"),
      })
    );
  });

  it("marks the job dispatch_failed and returns 502 on a non-2xx worker response", async () => {
    process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_URL = "https://worker.example.com";
    process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN = "worker-secret";

    const fetchMock = vi.fn(async () => ({
      status: 401,
      ok: false,
      json: async () => ({}),
      text: async () => "invalid token",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await postProcessMission(request(), routeContext());

    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload.error).toBe("worker_dispatch_failed");
    expect(payload.detail).toContain("401");

    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "dispatch_failed" })
    );
  });

  it("refuses a contract env value it does not know, dispatching nothing", async () => {
    process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_URL = "https://worker.example.com";
    process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN = "worker-secret";
    process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_CONTRACT = "v2";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await postProcessMission(request(), routeContext());

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.error).toBe("worker_contract_misconfigured");
    expect(payload.detail).toContain("OPENPLAN_AERIAL_PROCESSING_WORKER_CONTRACT");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jobInsertMock).not.toHaveBeenCalled();
  });

  describe("contract v1.1 (stored-photo manifests)", () => {
    beforeEach(() => {
      process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_URL = "https://worker.example.com";
      process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN = "worker-secret";
      process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_CONTRACT = "v1.1";
    });

    it("dispatches the mission's stored photos as a photo_manifest of signed links", async () => {
      const rows = storedImageryRows();
      imageryListMock.mockResolvedValue({ data: rows, error: null });
      storageSignedUrlsMock.mockResolvedValue({
        data: rows.map((row) => ({
          path: row.storage_path,
          signedUrl: `https://supabase.example.com/sign/${row.original_filename}?token=t`,
          error: null,
        })),
        error: null,
      });

      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        const dispatched = JSON.parse(String(init.body));
        return {
          status: 202,
          ok: true,
          json: async () =>
            acceptedWorkerResponse(dispatched.requestId, "natford-aerial-processing.v1.1"),
          text: async () => "",
        };
      });
      vi.stubGlobal("fetch", fetchMock);

      const response = await postProcessMission(
        request({ presetId: "balanced" }),
        routeContext()
      );

      expect(response.status).toBe(202);
      const payload = await response.json();
      expect(payload.imageryType).toBe("photo_manifest");

      // Signed against the bucket the rows name, with the configured TTL path.
      expect(storageFromMock).toHaveBeenCalledWith("aerial-imagery");
      expect(storageSignedUrlsMock).toHaveBeenCalledWith(
        rows.map((row) => row.storage_path),
        21_600
      );

      const dispatched = JSON.parse(String(fetchMock.mock.calls[0][1].body));
      expect(dispatched.schemaVersion).toBe("natford-aerial-processing.v1.1");
      expect(dispatched.imagery.type).toBe("photo_manifest");
      expect(dispatched.imagery.imageCount).toBe(2);
      expect(dispatched.imagery.totalSizeBytes).toBe(17_000_000);
      expect(dispatched.imagery.photos).toEqual([
        {
          url: "https://supabase.example.com/sign/DJI_0001.JPG?token=t",
          filename: "DJI_0001.JPG",
          sizeBytes: 8_000_000,
          checksumSha256: "a".repeat(64),
        },
        {
          url: "https://supabase.example.com/sign/DJI_0002.JPG?token=t",
          filename: "DJI_0002.JPG",
          sizeBytes: 9_000_000,
          checksumSha256: "b".repeat(64),
        },
      ]);

      // The job row records the manifest shape: type, count, total bytes — and
      // NO single imagery URL, because there is none.
      expect(jobInsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          imagery_type: "photo_manifest",
          imagery_url: null,
          imagery_image_count: 2,
          imagery_size_bytes: 17_000_000,
        })
      );
    });

    it("falls back to the pasted ZIP link when nothing is stored — and still declares v1", async () => {
      imageryListMock.mockResolvedValue({ data: [], error: null });

      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        const dispatched = JSON.parse(String(init.body));
        return {
          status: 202,
          ok: true,
          json: async () => acceptedWorkerResponse(dispatched.requestId),
          text: async () => "",
        };
      });
      vi.stubGlobal("fetch", fetchMock);

      const response = await postProcessMission(
        request({ imageryZipUrl: "https://storage.example.com/imagery.zip" }),
        routeContext()
      );

      expect(response.status).toBe(202);
      const dispatched = JSON.parse(String(fetchMock.mock.calls[0][1].body));
      // The contract's versioning rule: a zip_url request declares v1, even to
      // a v1.1 worker.
      expect(dispatched.schemaVersion).toBe("natford-aerial-processing.v1");
      expect(dispatched.imagery.type).toBe("zip_url");
      expect(jobInsertMock.mock.calls[0][0]).not.toHaveProperty("imagery_type");
      expect(storageSignedUrlsMock).not.toHaveBeenCalled();
    });

    it("refuses honestly when the mission has no stored photos and no link was pasted", async () => {
      imageryListMock.mockResolvedValue({ data: [], error: null });
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const response = await postProcessMission(request({ presetId: "balanced" }), routeContext());

      expect(response.status).toBe(422);
      const payload = await response.json();
      expect(payload.error).toBe("no_imagery_available");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(jobInsertMock).not.toHaveBeenCalled();
    });

    it("treats a failed stored-photo read as a refusal, never as an empty mission", async () => {
      imageryListMock.mockResolvedValue({
        data: null,
        error: { message: "permission denied for table aerial_imagery" },
      });
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      // A pasted URL is present — but the fallback must NOT fire, because "the
      // read failed" and "nothing is stored" require different outcomes.
      const response = await postProcessMission(
        request({ imageryZipUrl: "https://storage.example.com/imagery.zip" }),
        routeContext()
      );

      expect(response.status).toBe(500);
      const payload = await response.json();
      expect(payload.error).toBe("stored_imagery_unreadable");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(jobInsertMock).not.toHaveBeenCalled();
    });

    it("refuses the dispatch when signed links cannot be minted for every photo", async () => {
      const rows = storedImageryRows();
      imageryListMock.mockResolvedValue({ data: rows, error: null });
      storageSignedUrlsMock.mockResolvedValue({
        data: [
          {
            path: rows[0].storage_path,
            signedUrl: "https://supabase.example.com/sign/DJI_0001.JPG?token=t",
            error: null,
          },
          { path: rows[1].storage_path, signedUrl: null, error: "Object not found" },
        ],
        error: null,
      });
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const response = await postProcessMission(request({ presetId: "balanced" }), routeContext());

      expect(response.status).toBe(500);
      const payload = await response.json();
      expect(payload.error).toBe("stored_imagery_unreadable");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(jobInsertMock).not.toHaveBeenCalled();
    });
  });
});

describe("GET /api/aerial/missions/[missionId]/process (dispatch capability)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_URL;
    delete process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN;
    delete process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_CONTRACT;

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    missionMaybeSingleMock.mockResolvedValue({
      data: { id: MISSION_ID, workspace_id: WORKSPACE_ID },
      error: null,
    });
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "viewer" }, error: null });
    imageryCountMock.mockResolvedValue({ count: 3, error: null });
  });

  it("reports the worker contract and the stored-photo count", async () => {
    process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_URL = "https://worker.example.com";
    process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN = "worker-secret";
    process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_CONTRACT = "v1.1";

    const response = await getProcessCapability(capabilityRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      workerConfigured: true,
      workerContract: "v1.1",
      storedImagery: { status: "counted", count: 3 },
    });
  });

  it("defaults the contract to v1 when the env var is unset", async () => {
    const response = await getProcessCapability(capabilityRequest(), routeContext());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.workerConfigured).toBe(false);
    expect(payload.workerContract).toBe("v1");
  });

  it("reports a failed stored-photo count as unavailable, never as zero", async () => {
    imageryCountMock.mockResolvedValue({
      count: null,
      error: { message: 'relation "aerial_imagery" does not exist' },
    });

    const response = await getProcessCapability(capabilityRequest(), routeContext());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.storedImagery.status).toBe("unavailable");
    expect(payload.storedImagery.reason).toContain("could not be read");
    expect(payload.storedImagery).not.toHaveProperty("count");
  });

  it("returns 401 unauthenticated and 403 for non-members", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });
    const unauthenticated = await getProcessCapability(capabilityRequest(), routeContext());
    expect(unauthenticated.status).toBe(401);

    membershipMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const outsider = await getProcessCapability(capabilityRequest(), routeContext());
    expect(outsider.status).toBe(403);
  });
});
