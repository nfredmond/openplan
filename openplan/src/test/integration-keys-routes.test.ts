import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUserMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const listMock = vi.fn();
const storeMock = vi.fn();
const deleteMock = vi.fn();
const probeMock = vi.fn();
const loadKeysMock = vi.fn();
const rateLimitCheckMock = vi.fn();
const recordUsageMock = vi.fn();

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: membershipMaybeSingleMock }) }) }),
    }),
  }),
  createServiceRoleClient: () => ({}),
}));

// Factory bodies dereference the mock consts lazily (inside arrow functions)
// because vi.mock is hoisted above the const initializations.
vi.mock("@/lib/integrations/workspace-keys", () => ({
  listWorkspaceIntegrationKeyMetadata: (...args: unknown[]) => listMock(...args),
  storeWorkspaceIntegrationKey: (...args: unknown[]) => storeMock(...args),
  deleteWorkspaceIntegrationKey: (...args: unknown[]) => deleteMock(...args),
}));

vi.mock("@/lib/integrations/probes", () => ({
  probeIntegrationKey: (...args: unknown[]) => probeMock(...args),
}));

vi.mock("@/lib/integrations/context", () => ({
  loadWorkspaceIntegrationKeys: (...args: unknown[]) => loadKeysMock(...args),
  runWithWorkspaceIntegrationKeys: (_w: string, _k: unknown, fn: () => unknown) => fn(),
  workspaceIntegrationKey: () => null,
  currentIntegrationKeyWorkspaceId: () => null,
}));

// The probe throttle: real constants, mocked check/record so tests control
// the verdict and observe the metering.
vi.mock("@/lib/runtime/ai-rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/runtime/ai-rate-limit")>();
  return {
    ...actual,
    checkAiUsageRateLimit: (...args: unknown[]) => rateLimitCheckMock(...args),
    recordAiUsageEvent: (...args: unknown[]) => recordUsageMock(...args),
  };
});

import { DELETE, GET, PUT } from "@/app/api/workspaces/integration-keys/route";
import { POST as VALIDATE } from "@/app/api/workspaces/integration-keys/validate/route";

const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000";

function listRequest(query = `?workspaceId=${WORKSPACE_ID}`) {
  return new NextRequest(`http://localhost/api/workspaces/integration-keys${query}`);
}

function bodyRequest(method: "PUT" | "DELETE", body: unknown) {
  return new NextRequest("http://localhost/api/workspaces/integration-keys", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validateRequest(body: unknown) {
  return new NextRequest("http://localhost/api/workspaces/integration-keys/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "unit-test-operator-secret-0123456789");
  vi.stubEnv("ANTHROPIC_API_KEY", "env-anthropic-key-value");
  vi.stubEnv("CENSUS_API_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.env-mapbox-token");
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");

  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  membershipMaybeSingleMock.mockResolvedValue({ data: { role: "owner" }, error: null });
  listMock.mockResolvedValue([]);
  storeMock.mockResolvedValue({
    provider: "anthropic",
    keyLast4: "wxyz",
    configuredBy: "user-1",
    updatedAt: "2026-07-27T00:00:00.000Z",
  });
  deleteMock.mockResolvedValue(undefined);
  probeMock.mockResolvedValue({ ok: true, detail: "accepted" });
  loadKeysMock.mockResolvedValue(new Map());
  rateLimitCheckMock.mockResolvedValue({ allowed: true, count: 0, retryAfterSeconds: 0 });
  recordUsageMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("integration-keys authz — owner/admin on every verb", () => {
  it("401s when unauthenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    expect((await GET(listRequest())).status).toBe(401);
  });

  it("404s for a non-member rather than revealing the workspace exists", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    expect((await GET(listRequest())).status).toBe(404);
  });

  it("403s a plain member on GET, PUT, DELETE, and validate — key metadata is operator info", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "member" }, error: null });
    expect((await GET(listRequest())).status).toBe(403);
    expect(
      (
        await PUT(
          bodyRequest("PUT", { workspaceId: WORKSPACE_ID, provider: "anthropic", key: "sk-ant-key-123" })
        )
      ).status
    ).toBe(403);
    expect(
      (await DELETE(bodyRequest("DELETE", { workspaceId: WORKSPACE_ID, provider: "anthropic" }))).status
    ).toBe(403);
    expect(
      (await VALIDATE(validateRequest({ workspaceId: WORKSPACE_ID, provider: "anthropic" }))).status
    ).toBe(403);
    expect(storeMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(probeMock).not.toHaveBeenCalled();
  });

  it("400s without a workspace id", async () => {
    expect((await GET(listRequest(""))).status).toBe(400);
  });
});

describe("GET — registry status, metadata only", () => {
  it("returns every registry provider with env presence and stored-key metadata, never key material", async () => {
    listMock.mockResolvedValue([
      {
        provider: "anthropic",
        keyLast4: "abcd",
        configuredBy: "user-2",
        updatedAt: "2026-07-26T00:00:00.000Z",
      },
    ]);
    // The stored row decrypts under the current secret.
    loadKeysMock.mockResolvedValue(new Map([["anthropic", "stored-plaintext-key"]]));

    const res = await GET(listRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.storageAvailable).toBe(true);
    expect(body.providers).toHaveLength(3);

    const byId = new Map(body.providers.map((p: { id: string }) => [p.id, p]));
    const anthropic = byId.get("anthropic") as Record<string, unknown>;
    expect(anthropic.envKeyPresent).toBe(true);
    expect(anthropic.storedKey).toEqual({
      keyLast4: "abcd",
      updatedAt: "2026-07-26T00:00:00.000Z",
      decryptable: true,
    });
    expect(anthropic.workspaceConfigurable).toBe(true);

    const census = byId.get("census") as Record<string, unknown>;
    expect(census.envKeyPresent).toBe(false);
    expect(census.storedKey).toBeNull();

    const mapbox = byId.get("mapbox") as Record<string, unknown>;
    expect(mapbox.envKeyPresent).toBe(true);
    expect(mapbox.workspaceConfigurable).toBe(false);
    expect(typeof mapbox.workspaceConfigurableNote).toBe("string");

    // The contract: nothing that leaves the server is plaintext or ciphertext.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("ciphertext");
    expect(serialized).not.toContain("env-anthropic-key-value");
    expect(serialized).not.toContain("stored-plaintext-key");
    expect(serialized).not.toContain("v1:");
    expect(serialized).not.toContain("v2:");
  });

  it("reports decryptable false for a stored row the current secret cannot read (rotation honesty)", async () => {
    listMock.mockResolvedValue([
      {
        provider: "anthropic",
        keyLast4: "abcd",
        configuredBy: "user-2",
        updatedAt: "2026-07-26T00:00:00.000Z",
      },
    ]);
    // Rotated secret: the metadata row exists but nothing decrypts.
    loadKeysMock.mockResolvedValue(new Map());

    const body = await (await GET(listRequest())).json();
    const anthropic = (body.providers as Array<Record<string, unknown>>).find(
      (p) => p.id === "anthropic"
    )!;
    expect(anthropic.storedKey).toEqual({
      keyLast4: "abcd",
      updatedAt: "2026-07-26T00:00:00.000Z",
      decryptable: false,
    });
  });

  it("reports storageAvailable false when the deployment has no encryption secret", async () => {
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "");
    const body = await (await GET(listRequest())).json();
    expect(body.storageAvailable).toBe(false);
  });
});

describe("PUT — save only what validates", () => {
  const putBody = { workspaceId: WORKSPACE_ID, provider: "anthropic", key: "sk-ant-key-123" };

  it("422s with the probe detail and stores nothing when the live probe refuses", async () => {
    probeMock.mockResolvedValue({ ok: false, detail: "The key was rejected by Anthropic." });
    const res = await PUT(bodyRequest("PUT", putBody));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("The key was rejected by Anthropic.");
    expect(storeMock).not.toHaveBeenCalled();
  });

  it("probes the submitted key, stores it, and answers with last4 metadata", async () => {
    const res = await PUT(bodyRequest("PUT", putBody));
    expect(res.status).toBe(200);

    expect(probeMock).toHaveBeenCalledWith("anthropic", "sk-ant-key-123");
    expect(storeMock).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      provider: "anthropic",
      plaintextKey: "sk-ant-key-123",
      configuredBy: "user-1",
    });

    const body = await res.json();
    expect(body.validated).toBe(true);
    expect(body.storedKey).toEqual({
      keyLast4: "wxyz",
      updatedAt: "2026-07-27T00:00:00.000Z",
      decryptable: true,
    });
    expect(JSON.stringify(body)).not.toContain("sk-ant-key-123");

    // The probe was throttled against — and metered into — the DEDICATED
    // bucket, never the staff AI buckets.
    expect(rateLimitCheckMock).toHaveBeenCalledWith(
      WORKSPACE_ID,
      expect.objectContaining({ bucketKeys: ["integration_key_probe"] })
    );
    expect(recordUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WORKSPACE_ID, bucketKey: "integration_key_probe" })
    );
  });

  it("429s before probing when the probe bucket is exhausted, with retry-after", async () => {
    rateLimitCheckMock.mockResolvedValue({ allowed: false, count: 20, retryAfterSeconds: 300 });
    const res = await PUT(bodyRequest("PUT", putBody));

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("300");
    expect(probeMock).not.toHaveBeenCalled();
    expect(storeMock).not.toHaveBeenCalled();
    expect(recordUsageMock).not.toHaveBeenCalled();
  });

  it("meters a refused probe too — the provider was still called", async () => {
    probeMock.mockResolvedValue({ ok: false, detail: "The key was rejected by Anthropic." });
    const res = await PUT(bodyRequest("PUT", putBody));

    expect(res.status).toBe(422);
    expect(recordUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({ bucketKey: "integration_key_probe" })
    );
  });

  it("503s with the operator-facing copy when the deployment cannot encrypt", async () => {
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "");
    const res = await PUT(bodyRequest("PUT", putBody));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("OPENPLAN_INTEGRATION_KEY_SECRET");
    expect(body.error).toContain("operator");
    expect(probeMock).not.toHaveBeenCalled();
    expect(storeMock).not.toHaveBeenCalled();
  });

  it("400s for a provider whose workspace keys cannot take effect (mapbox)", async () => {
    const res = await PUT(
      bodyRequest("PUT", { workspaceId: WORKSPACE_ID, provider: "mapbox", key: "pk.some-token-123" })
    );
    expect(res.status).toBe(400);
    expect(probeMock).not.toHaveBeenCalled();
    expect(storeMock).not.toHaveBeenCalled();
  });

  it("400s an unknown provider and a too-short key without probing", async () => {
    expect(
      (
        await PUT(
          bodyRequest("PUT", { workspaceId: WORKSPACE_ID, provider: "acme", key: "sk-whatever-123" })
        )
      ).status
    ).toBe(400);
    expect(
      (await PUT(bodyRequest("PUT", { workspaceId: WORKSPACE_ID, provider: "anthropic", key: "abc" })))
        .status
    ).toBe(400);
    expect(probeMock).not.toHaveBeenCalled();
  });
});

describe("DELETE — remove and fall back to env", () => {
  it("removes the stored key", async () => {
    const res = await DELETE(bodyRequest("DELETE", { workspaceId: WORKSPACE_ID, provider: "anthropic" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true, provider: "anthropic" });
    expect(deleteMock).toHaveBeenCalledWith(WORKSPACE_ID, "anthropic");
  });

  it("400s an unknown provider", async () => {
    const res = await DELETE(bodyRequest("DELETE", { workspaceId: WORKSPACE_ID, provider: "acme" }));
    expect(res.status).toBe(400);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe("POST /validate — probe the submitted or effective key", () => {
  it("probes a submitted plaintext as a pre-save check", async () => {
    const res = await VALIDATE(
      validateRequest({ workspaceId: WORKSPACE_ID, provider: "anthropic", key: "sk-ant-candidate-1" })
    );
    expect(res.status).toBe(200);
    expect(probeMock).toHaveBeenCalledWith("anthropic", "sk-ant-candidate-1");
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, source: "candidate" });

    // Throttled against — and metered into — the DEDICATED probe bucket.
    expect(rateLimitCheckMock).toHaveBeenCalledWith(
      WORKSPACE_ID,
      expect.objectContaining({ bucketKeys: ["integration_key_probe"] })
    );
    expect(recordUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WORKSPACE_ID, bucketKey: "integration_key_probe" })
    );
  });

  it("429s before any probe when the probe bucket is exhausted, with retry-after", async () => {
    rateLimitCheckMock.mockResolvedValue({ allowed: false, count: 20, retryAfterSeconds: 120 });
    const res = await VALIDATE(
      validateRequest({ workspaceId: WORKSPACE_ID, provider: "anthropic", key: "sk-ant-candidate-1" })
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("120");
    expect(probeMock).not.toHaveBeenCalled();
    expect(recordUsageMock).not.toHaveBeenCalled();
  });

  it("probes the stored workspace key when one decrypts", async () => {
    loadKeysMock.mockResolvedValue(new Map([["anthropic", "stored-workspace-key"]]));
    const res = await VALIDATE(validateRequest({ workspaceId: WORKSPACE_ID, provider: "anthropic" }));

    expect(probeMock).toHaveBeenCalledWith("anthropic", "stored-workspace-key");
    expect(await res.json()).toMatchObject({ ok: true, source: "workspace" });
  });

  it("reports a stored key that no longer decrypts instead of papering over it", async () => {
    loadKeysMock.mockResolvedValue(new Map());
    listMock.mockResolvedValue([
      { provider: "anthropic", keyLast4: "abcd", configuredBy: "user-2", updatedAt: null },
    ]);

    const body = await (
      await VALIDATE(validateRequest({ workspaceId: WORKSPACE_ID, provider: "anthropic" }))
    ).json();

    expect(body.ok).toBe(false);
    expect(body.source).toBe("workspace");
    expect(body.detail).toContain("no longer be decrypted");
    expect(probeMock).not.toHaveBeenCalled();
  });

  it("falls back to the deployment env key when no workspace key exists", async () => {
    const res = await VALIDATE(validateRequest({ workspaceId: WORKSPACE_ID, provider: "anthropic" }));
    expect(probeMock).toHaveBeenCalledWith("anthropic", "env-anthropic-key-value");
    expect(await res.json()).toMatchObject({ ok: true, source: "env" });
  });

  it("uses the resolved NEXT_PUBLIC browser token for mapbox", async () => {
    const res = await VALIDATE(validateRequest({ workspaceId: WORKSPACE_ID, provider: "mapbox" }));
    expect(probeMock).toHaveBeenCalledWith("mapbox", "pk.env-mapbox-token");
    expect(await res.json()).toMatchObject({ ok: true, source: "env" });
  });

  it("answers source none with honest copy when nothing is configured, without probing", async () => {
    const body = await (
      await VALIDATE(validateRequest({ workspaceId: WORKSPACE_ID, provider: "census" }))
    ).json();

    expect(body.ok).toBe(false);
    expect(body.source).toBe("none");
    expect(body.detail).toContain("CENSUS_API_KEY");
    expect(probeMock).not.toHaveBeenCalled();
  });

  it("400s an unknown provider", async () => {
    const res = await VALIDATE(validateRequest({ workspaceId: WORKSPACE_ID, provider: "acme" }));
    expect(res.status).toBe(400);
  });
});
