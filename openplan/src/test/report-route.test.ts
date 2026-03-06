import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();

const authGetUserMock = vi.fn();

const runsSingleMock = vi.fn();
const runsEqMock = vi.fn(() => ({ single: runsSingleMock }));
const runsSelectMock = vi.fn(() => ({ eq: runsEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const decisionInsertMock = vi.fn();

const clientFromMock = vi.fn((table: string) => {
  if (table === "runs") {
    return { select: runsSelectMock };
  }

  if (table === "workspace_members") {
    return { select: membershipSelectMock };
  }

  if (table === "stage_gate_decisions") {
    return { insert: decisionInsertMock };
  }

  throw new Error(`Unexpected table: ${table}`);
});

const telemetryEqMock = vi.fn().mockResolvedValue({ error: null });
const telemetryUpdateMock = vi.fn(() => ({ eq: telemetryEqMock }));
const telemetryFromMock = vi.fn(() => ({ update: telemetryUpdateMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { POST as postReport } from "@/app/api/report/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/report", () => {
  const runId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "22222222-2222-4222-8222-222222222222",
          email: "owner@example.com",
        },
      },
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: clientFromMock,
    });

    createServiceRoleClientMock.mockReturnValue({
      from: telemetryFromMock,
    });

    runsSingleMock.mockResolvedValue({
      data: {
        id: runId,
        workspace_id: "33333333-3333-4333-8333-333333333333",
        title: "Test Corridor",
        query_text: "Evaluate this corridor",
        summary_text: "Summary text",
        ai_interpretation: "Interpretation text",
        metrics: {
          overallScore: 70,
          accessibilityScore: 68,
          safetyScore: 72,
          equityScore: 74,
          confidence: "high",
          totalPopulation: 12345,
          totalTransitStops: 56,
          totalFatalCrashes: 3,
          justice40Eligible: true,
          sourceSnapshots: {
            census: { fetchedAt: "2025-01-01T00:00:00.000Z" },
            transit: { fetchedAt: "2025-01-01T00:00:00.000Z" },
            crashes: { fetchedAt: "2025-01-01T00:00:00.000Z" },
          },
        },
        created_at: "2025-01-01T00:00:00.000Z",
      },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: { workspace_id: "33333333-3333-4333-8333-333333333333", role: "member" },
      error: null,
    });

    decisionInsertMock.mockResolvedValue({ error: null });
  });

  it("returns 400 for invalid format", async () => {
    const response = await postReport(jsonRequest({ runId, format: "docx" }));

    expect(response.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await postReport(jsonRequest({ runId, format: "html" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 403 when user is not a workspace member", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await postReport(jsonRequest({ runId, format: "html" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("returns 409 HOLD when required report artifacts are missing", async () => {
    runsSingleMock.mockResolvedValueOnce({
      data: {
        id: runId,
        workspace_id: "33333333-3333-4333-8333-333333333333",
        title: "Missing artifacts run",
        query_text: "Evaluate this corridor",
        summary_text: "",
        ai_interpretation: "Interpretation text",
        metrics: {
          overallScore: 70,
          accessibilityScore: 68,
          safetyScore: 72,
          equityScore: 74,
          confidence: "high",
          sourceSnapshots: {
            census: { fetchedAt: "2025-01-01T00:00:00.000Z" },
            transit: { fetchedAt: "2025-01-01T00:00:00.000Z" },
          },
        },
        created_at: "2025-01-01T00:00:00.000Z",
      },
      error: null,
    });

    const response = await postReport(jsonRequest({ runId, format: "html" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "Required report artifacts missing",
      decision: "HOLD",
      missingArtifacts: expect.arrayContaining([
        "summary_text",
        "metrics.sourceSnapshots.crashes.fetchedAt",
      ]),
    });
    expect(decisionInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "HOLD",
        gate_id: "report_artifact_gate",
        run_id: runId,
        workspace_id: "33333333-3333-4333-8333-333333333333",
        missing_artifacts: expect.arrayContaining([
          "summary_text",
          "metrics.sourceSnapshots.crashes.fetchedAt",
        ]),
      })
    );
    expect(telemetryUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 500 when decision persistence fails", async () => {
    decisionInsertMock.mockResolvedValueOnce({
      error: { message: "write failed", code: "XX000" },
    });

    const response = await postReport(jsonRequest({ runId, format: "html" }));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Failed to persist stage-gate decision" });
  });

  it("returns html for format=html", async () => {
    const response = await postReport(jsonRequest({ runId, format: "html" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(decisionInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "PASS",
        gate_id: "report_artifact_gate",
        run_id: runId,
      })
    );
  });

  it("returns pdf bytes for format=pdf", async () => {
    const response = await postReport(jsonRequest({ runId, format: "pdf" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/pdf");

    const bytes = new Uint8Array(await response.arrayBuffer());
    const signature = new TextDecoder().decode(bytes.slice(0, 4));
    expect(signature).toBe("%PDF");
  });
});
