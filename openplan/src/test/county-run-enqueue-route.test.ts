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

import { POST as postCountyRunEnqueue } from "@/app/api/county-runs/[countyRunId]/enqueue/route";

function request() {
  return new NextRequest("http://localhost/api/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/enqueue", {
    method: "POST",
  });
}

describe("POST /api/county-runs/[countyRunId]/enqueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENPLAN_COUNTY_ONRAMP_WORKER_URL;
    delete process.env.OPENPLAN_COUNTY_ONRAMP_WORKER_TOKEN;
    delete process.env.OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN;
    createApiAuditLoggerMock.mockReturnValue(mockAudit);

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

  it("returns a queue-ready worker payload", async () => {
    const response = await postCountyRunEnqueue(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe("queued_stub");
    expect(payload.deliveryMode).toBe("prepared");
    expect(payload.workerPayload.countyRunId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(payload.workerPayload.callback.manifestIngestUrl).toBe(
      "http://localhost/api/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/manifest"
    );
    expect(countyRunUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enqueue_status: "queued_stub",
        last_enqueued_at: expect.any(String),
      })
    );
  });

  it("dispatches to a configured worker endpoint", async () => {
    process.env.OPENPLAN_COUNTY_ONRAMP_WORKER_URL = "https://worker.example.com/jobs";
    process.env.OPENPLAN_COUNTY_ONRAMP_WORKER_TOKEN = "secret-token";
    process.env.OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN = "callback-secret";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await postCountyRunEnqueue(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://worker.example.com/jobs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer secret-token" }),
        body: expect.stringContaining("\"bearerToken\":\"callback-secret\""),
      })
    );
    expect(await response.json()).toMatchObject({
      deliveryMode: "submitted",
      workerPayload: {
        callback: {
          manifestIngestUrl: "http://localhost/api/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/manifest",
        },
      },
    });
    vi.unstubAllGlobals();
  });

  it("preserves behavioral smoke runtime options in the dispatched worker payload", async () => {
    process.env.OPENPLAN_COUNTY_ONRAMP_WORKER_URL = "https://worker.example.com/jobs";
    process.env.OPENPLAN_COUNTY_ONRAMP_WORKER_TOKEN = "secret-token";
    process.env.OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN = "callback-secret";

    countyRunMaybeSingleMock.mockResolvedValue({
      data: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        requested_runtime_json: {
          workspaceId: "11111111-1111-4111-8111-111111111111",
          geographyType: "county_fips",
          geographyId: "06057",
          geographyLabel: "Nevada County, CA",
          runName: "nevada-behavioral-smoke",
          countyPrefix: "NEVADA",
          runtimeOptions: {
            keepProject: true,
            force: true,
            overallDemandScalar: null,
            externalDemandScalar: null,
            hbwScalar: null,
            hboScalar: null,
            nhbScalar: null,
            activitysimContainerImage: "python:3.11-slim",
            containerEngineCli: "docker",
            activitysimContainerCliTemplate:
              "bash -lc 'python -m pip install --no-cache-dir activitysim==1.5.1 && python -m activitysim.cli.run -c {config_dir} -d {data_dir} -o {output_dir} -w {working_dir}'",
            containerNetworkMode: "bridge",
          },
        },
      },
      error: null,
    });

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await postCountyRunEnqueue(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://worker.example.com/jobs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer secret-token" }),
        body: expect.stringContaining('"activitysimContainerImage":"python:3.11-slim"'),
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://worker.example.com/jobs",
      expect.objectContaining({
        body: expect.stringContaining('"containerEngineCli":"docker"'),
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://worker.example.com/jobs",
      expect.objectContaining({
        body: expect.stringContaining('"containerNetworkMode":"bridge"'),
      })
    );

    expect(await response.json()).toMatchObject({
      deliveryMode: "submitted",
      workerPayload: {
        runtimeOptions: {
          activitysimContainerImage: "python:3.11-slim",
          containerEngineCli: "docker",
          activitysimContainerCliTemplate:
            "bash -lc 'python -m pip install --no-cache-dir activitysim==1.5.1 && python -m activitysim.cli.run -c {config_dir} -d {data_dir} -o {output_dir} -w {working_dir}'",
          containerNetworkMode: "bridge",
        },
      },
    });
    vi.unstubAllGlobals();
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
