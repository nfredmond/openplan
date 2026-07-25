import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const upsertMock = vi.fn();
const INGEST_TOKEN = "op-secret-token";

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({ __service: true }),
}));

vi.mock("@/lib/data-sources/equity-designation/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data-sources/equity-designation/db")>(
    "@/lib/data-sources/equity-designation/db"
  );
  return { ...actual, upsertDesignations: (...args: unknown[]) => upsertMock(...args) };
});

import { POST } from "@/app/api/geographies/equity-designation/ingest/route";

function request(body: unknown, token: string | null = INGEST_TOKEN) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers["x-openplan-ingest-token"] = token;
  return new NextRequest("http://localhost/api/geographies/equity-designation/ingest", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID_BODY = {
  sourceId: "calenviroscreen-ca",
  version: "4.0",
  attribution: "CalEPA/OEHHA",
  retrievedAt: "2026-07-24T00:00:00.000Z",
  rows: [
    { geoid: "06001400100", isDisadvantaged: true },
    { geoid: "06001400200", isDisadvantaged: false },
  ],
};

describe("POST /api/geographies/equity-designation/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENPLAN_EQUITY_INGEST_TOKEN", INGEST_TOKEN);
    upsertMock.mockResolvedValue({ affected: 2, error: null });
  });

  it("403s (route disabled) when no operator token is configured", async () => {
    vi.stubEnv("OPENPLAN_EQUITY_INGEST_TOKEN", "");
    expect((await POST(request(VALID_BODY))).status).toBe(403);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("403s a caller without the operator token — a signed-in user is not enough", async () => {
    expect((await POST(request(VALID_BODY, null))).status).toBe(403);
    expect((await POST(request(VALID_BODY, "wrong-token"))).status).toBe(403);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("400s an unknown source_id (outside the CHECK domain)", async () => {
    const response = await POST(request({ ...VALID_BODY, sourceId: "made-up-source" }));
    expect(response.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("400s a malformed GEOID", async () => {
    const response = await POST(request({ ...VALID_BODY, rows: [{ geoid: "6001", isDisadvantaged: true }] }));
    expect(response.status).toBe(400);
  });

  it("persists via the service-role upsert and reports counts", async () => {
    const response = await POST(request(VALID_BODY));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sourceId: "calenviroscreen-ca",
      version: "4.0",
      requested: 2,
      persisted: 2,
    });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock.mock.calls[0]![1]).toMatchObject({ sourceId: "calenviroscreen-ca", version: "4.0" });
  });

  it("500s and surfaces the error when the upsert fails", async () => {
    upsertMock.mockResolvedValue({ affected: 0, error: "constraint violation" });
    const response = await POST(request(VALID_BODY));
    expect(response.status).toBe(500);
  });
});
