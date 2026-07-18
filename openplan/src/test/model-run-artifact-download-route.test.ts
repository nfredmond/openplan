import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const loadModelAccessMock = vi.fn();
const authGetUserMock = vi.fn();
const runMaybeSingleMock = vi.fn();
const artifactMaybeSingleMock = vi.fn();
const createSignedUrlMock = vi.fn();
const readFileMock = vi.fn();

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_RUN_ID = "22222222-2222-4222-8222-222222222222";
const ARTIFACT_ID = "55555555-5555-4555-8555-555555555555";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "model_runs") {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: runMaybeSingleMock,
          })),
        })),
      })),
    };
  }
  if (table === "model_run_artifacts") {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: artifactMaybeSingleMock,
          })),
        })),
      })),
    };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/models/api", () => ({
  loadModelAccess: (...args: unknown[]) => loadModelAccessMock(...args),
}));

vi.mock("node:fs/promises", () => {
  const readFile = (...args: unknown[]) => readFileMock(...args);
  return { readFile, default: { readFile } };
});

import { GET as downloadArtifact } from "@/app/api/models/[modelId]/runs/[modelRunId]/artifacts/[artifactId]/download/route";

function request() {
  return new NextRequest(
    `http://localhost/api/models/${MODEL_ID}/runs/${MODEL_RUN_ID}/artifacts/${ARTIFACT_ID}/download`,
  );
}

function routeContext() {
  return {
    params: Promise.resolve({
      modelId: MODEL_ID,
      modelRunId: MODEL_RUN_ID,
      artifactId: ARTIFACT_ID,
    }),
  };
}

function setArtifact(fileUrl: string | null) {
  artifactMaybeSingleMock.mockResolvedValue({
    data:
      fileUrl === null
        ? null
        : {
            id: ARTIFACT_ID,
            run_id: MODEL_RUN_ID,
            artifact_type: "volumes_geojson",
            file_url: fileUrl,
          },
    error: null,
  });
}

describe("/api/models/[modelId]/runs/[modelRunId]/artifacts/[artifactId]/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: { user: { id: "44444444-4444-4444-8444-444444444444" } },
    });
    loadModelAccessMock.mockResolvedValue({
      model: { id: MODEL_ID, workspace_id: WORKSPACE_ID },
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
      allowed: true,
      error: null,
    });
    runMaybeSingleMock.mockResolvedValue({
      data: { id: MODEL_RUN_ID, model_id: MODEL_ID },
      error: null,
    });
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
    createServiceRoleClientMock.mockReturnValue({
      storage: {
        from: (bucket: string) => ({
          createSignedUrl: (objectPath: string, ttl: number) =>
            createSignedUrlMock(bucket, objectPath, ttl),
        }),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects unauthenticated requests", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });
    const res = await downloadArtifact(request(), routeContext());
    expect(res.status).toBe(401);
  });

  it("rejects users without workspace access", async () => {
    loadModelAccessMock.mockResolvedValue({
      model: { id: MODEL_ID, workspace_id: WORKSPACE_ID },
      membership: null,
      allowed: false,
      error: null,
    });
    const res = await downloadArtifact(request(), routeContext());
    expect(res.status).toBe(403);
  });

  it("404s when the artifact does not exist for the run", async () => {
    setArtifact(null);
    const res = await downloadArtifact(request(), routeContext());
    expect(res.status).toBe(404);
  });

  it("redirects storage:// references to a short-TTL signed URL", async () => {
    setArtifact(`storage://run-artifacts/model-runs/${MODEL_RUN_ID}/volumes.geojson`);
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: "http://localhost:54321/storage/v1/object/sign/run-artifacts/x?token=t" },
      error: null,
    });

    const res = await downloadArtifact(request(), routeContext());

    expect(createSignedUrlMock).toHaveBeenCalledWith(
      "run-artifacts",
      `model-runs/${MODEL_RUN_ID}/volumes.geojson`,
      15 * 60,
    );
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toContain("/object/sign/run-artifacts/");
  });

  it("500s when signing fails instead of leaking a raw reference", async () => {
    setArtifact(`storage://run-artifacts/model-runs/${MODEL_RUN_ID}/volumes.geojson`);
    createSignedUrlMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    const res = await downloadArtifact(request(), routeContext());
    expect(res.status).toBe(500);
  });

  it("refuses to sign refs pointing at other buckets", async () => {
    setArtifact("storage://engagement-photos/private/photo.jpg");
    const res = await downloadArtifact(request(), routeContext());
    expect(res.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("refuses to sign refs pointing at another run's objects", async () => {
    setArtifact("storage://run-artifacts/model-runs/99999999-9999-4999-8999-999999999999/volumes.geojson");
    const res = await downloadArtifact(request(), routeContext());
    expect(res.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("does not redirect to remote file_url values", async () => {
    setArtifact("https://evil.example/phish");
    const res = await downloadArtifact(request(), routeContext());
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
  });

  it("404s local:// references when OPENPLAN_WORKER_LOCAL_ROOT is unset", async () => {
    setArtifact(`local:///srv/worker/runs/${MODEL_RUN_ID.slice(0, 12)}/link_volumes.csv`);
    const res = await downloadArtifact(request(), routeContext());
    expect(res.status).toBe(404);
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("streams run-local files as attachments in dev", async () => {
    vi.stubEnv("OPENPLAN_WORKER_LOCAL_ROOT", "/srv/worker");
    const runDirPath = `/srv/worker/runs/${MODEL_RUN_ID.slice(0, 12)}/run_output/link_volumes.csv`;
    setArtifact(`local://${runDirPath}`);
    readFileMock.mockResolvedValue(Buffer.from("link_id,volume\n1,42\n"));

    const res = await downloadArtifact(request(), routeContext());

    expect(readFileMock).toHaveBeenCalledWith(runDirPath);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv");
    expect(res.headers.get("content-disposition")).toContain('filename="link_volumes.csv"');
  });

  it("refuses local paths outside this run's work dir", async () => {
    vi.stubEnv("OPENPLAN_WORKER_LOCAL_ROOT", "/srv/worker");
    for (const fileUrl of [
      "local:///app/.env",
      "local:///srv/worker/runs/999999999999/link_volumes.csv",
      `local:///srv/worker/runs/${MODEL_RUN_ID.slice(0, 12)}/../escape.csv`,
    ]) {
      setArtifact(fileUrl);
      const res = await downloadArtifact(request(), routeContext());
      expect(res.status).toBe(404);
    }
    expect(readFileMock).not.toHaveBeenCalled();
  });
});
