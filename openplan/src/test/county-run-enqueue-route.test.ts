import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const fromMock = vi.fn();
const countyRunSelectMock = vi.fn();
const countyRunEqMock = vi.fn();
const countyRunMaybeSingleMock = vi.fn();
const countyRunUpdateMock = vi.fn();
const countyRunUpdateEqMock = vi.fn();
const dispatchCountyOnrampJobMock = vi.fn();

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

vi.mock("@/lib/api/county-onramp-dispatch", () => ({
  dispatchCountyOnrampJob: (...args: unknown[]) => dispatchCountyOnrampJobMock(...args),
}));

import { POST as postCountyRunEnqueue } from "@/app/api/county-runs/[countyRunId]/enqueue/route";

function request() {
  return new NextRequest("http://localhost/api/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/enqueue", {
    method: "POST",
  });
}

describe("POST /api/county-runs/[countyRunId]/enqueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    dispatchCountyOnrampJobMock.mockResolvedValue({ deliveryMode: "prepared", workerUrl: null });

    authGetUserMock.mockResolvedValue({
      data: {
        user: { id: "123e4567-e89b-12d3-a456-426614174000" },
      },
    });

    countyRunMaybeSingleMock.mockResolvedValue({
      data: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        requested_runtime_json: {
          workspaceId: "11111111-1111-4111-8111-111111111111",
          geographyType: "county_fips",
          geographyId: "06057",
          geographyLabel: "Nevada County, CA",
          runName: "nevada-run",
          countyPrefix: "NEVADA",
          runtimeOptions: {
            keepProject: true,
            force: true,
            overallDemandScalar: 0.369,
            externalDemandScalar: null,
            hbwScalar: null,
            hboScalar: null,
            nhbScalar: null,
          },
        },
      },
      error: null,
    });
    countyRunEqMock.mockReturnValue({ maybeSingle: countyRunMaybeSingleMock });
    countyRunSelectMock.mockReturnValue({ eq: countyRunEqMock });
    countyRunUpdateEqMock.mockResolvedValue({ error: null });
    countyRunUpdateMock.mockReturnValue({ eq: countyRunUpdateEqMock });

    fromMock.mockImplementation((table: string) => {
      if (table === "county_runs") {
        return { select: countyRunSelectMock, update: countyRunUpdateMock };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("returns a prepared worker payload when no worker is configured", async () => {
    const response = await postCountyRunEnqueue(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe("prepared");
    expect(payload.workerJobId).toBe(payload.workerPayload.jobId);
    expect(payload.workerUrl).toBeNull();
    expect(payload.workerPayload.countyRunId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(payload.workerPayload.callback.manifestIngestUrl).toBe(
      "http://localhost/api/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/manifest"
    );
    expect(payload.workerPayload.callback.hasBearerToken).toBe(false);
    expect(payload.workerPayload.callback.bearerToken).toBeUndefined();
    expect(dispatchCountyOnrampJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        callback: expect.objectContaining({
          manifestIngestUrl: "http://localhost/api/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/manifest",
        }),
      })
    );
    expect(countyRunUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enqueue_status: "prepared",
        last_enqueued_at: expect.any(String),
        worker_job_id: payload.workerPayload.jobId,
        worker_payload_json: payload.workerPayload,
        worker_url: null,
        worker_dispatch_error: null,
      })
    );
  });

  it("submits configured worker dispatches without leaking the callback bearer", async () => {
    vi.stubEnv("OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN", "callback-secret");
    vi.stubEnv("OPENPLAN_COUNTY_ONRAMP_WORKER_URL", "https://worker.example/jobs");
    dispatchCountyOnrampJobMock.mockResolvedValue({ deliveryMode: "submitted", workerUrl: "https://worker.example/jobs" });

    const response = await postCountyRunEnqueue(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe("submitted");
    expect(payload.workerUrl).toBe("https://worker.example/jobs");
    expect(payload.workerPayload.callback).toEqual({
      manifestIngestUrl: "http://localhost/api/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/manifest",
      hasBearerToken: true,
    });
    expect(dispatchCountyOnrampJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        callback: expect.objectContaining({
          bearerToken: "callback-secret",
        }),
      })
    );
    expect(countyRunUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enqueue_status: "submitted",
        worker_url: "https://worker.example/jobs",
        worker_payload_json: payload.workerPayload,
      })
    );
  });

  it("records dispatch failures before returning 502", async () => {
    vi.stubEnv("OPENPLAN_COUNTY_ONRAMP_WORKER_URL", "https://worker.example/jobs");
    dispatchCountyOnrampJobMock.mockRejectedValue(new Error("worker offline"));

    const response = await postCountyRunEnqueue(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "failed",
      error: "Failed to dispatch county worker",
    });
    expect(countyRunUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enqueue_status: "failed",
        worker_url: "https://worker.example/jobs",
        worker_dispatch_error: "worker offline",
      })
    );
  });

  it("returns 409 when launch state is missing", async () => {
    countyRunMaybeSingleMock.mockResolvedValue({ data: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", requested_runtime_json: {} }, error: null });

    const response = await postCountyRunEnqueue(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(409);
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await postCountyRunEnqueue(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(401);
  });
});
