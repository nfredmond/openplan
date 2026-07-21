import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();

const authGetUserMock = vi.fn();
const missionMaybeSingleMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const activeJobMaybeSingleMock = vi.fn();
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
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { POST as postProcessMission } from "@/app/api/aerial/missions/[missionId]/process/route";

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

function routeContext() {
  return { params: Promise.resolve({ missionId: MISSION_ID }) };
}

function acceptedWorkerResponse(requestId: string) {
  return {
    schemaVersion: "natford-aerial-processing.v1",
    requestId,
    callbackId: "cb-accept-01",
    jobReference: "worker-job-9",
    status: "accepted",
    occurredAt: "2026-07-21T12:00:00Z",
  };
}

describe("POST /api/aerial/missions/[missionId]/process", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_URL;
    delete process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN;
    delete process.env.OPENPLAN_AERIAL_PROCESSING_CALLBACK_URL;

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
});
