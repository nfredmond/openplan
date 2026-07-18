import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const authGetUserMock = vi.fn();

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));

import { POST } from "@/app/api/projects/[projectId]/bca-screenings/route";

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "22222222-2222-4222-8222-222222222222";

const VALID_INPUTS = {
  baseYear: 2026,
  analysisHorizonYears: 20,
  discountRatePct: 3.1,
  benefits: [
    { kind: "travelTime", annualHoursSaved: { commuter: 20000 } },
    { kind: "safety", annualCrashesAvoided: { injury: 2 } },
  ],
  costs: [{ kind: "capital", totalAmount: 1000000, spreadYears: 2 }],
};

const projectMaybeSingleMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const insertSingleMock = vi.fn();
const insertSelectMock = vi.fn(() => ({ single: insertSingleMock }));
const insertMock = vi.fn(() => ({ select: insertSelectMock }));

function supabaseMock() {
  return {
    auth: { getUser: authGetUserMock },
    from: vi.fn((table: string) => {
      if (table === "projects") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: projectMaybeSingleMock })),
          })),
        };
      }
      if (table === "workspace_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock })),
            })),
          })),
        };
      }
      if (table === "project_bca_screenings") {
        return { insert: insertMock };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

function jsonRequest(payload: unknown) {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/bca-screenings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function routeContext(projectId: string = PROJECT_ID) {
  return { params: Promise.resolve({ projectId }) };
}

describe("/api/projects/[projectId]/bca-screenings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    createClientMock.mockResolvedValue(supabaseMock());
    projectMaybeSingleMock.mockResolvedValue({
      data: { id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: "SR-49 Corridor" },
      error: null,
    });
    membershipMaybeSingleMock.mockResolvedValue({
      data: { workspace_id: WORKSPACE_ID, role: "admin" },
      error: null,
    });
    insertSingleMock.mockResolvedValue({
      data: {
        id: "bca-1",
        created_at: "2026-07-18T20:00:00.000Z",
        result_json: {},
        engine_version: "openplan-bca-ts",
      },
      error: null,
    });
  });

  it("rejects a non-uuid project id", async () => {
    const response = await POST(jsonRequest({ inputs: VALID_INPUTS }), routeContext("not-a-uuid"));
    expect(response.status).toBe(400);
  });

  it("requires an authenticated user", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });
    const response = await POST(jsonRequest({ inputs: VALID_INPUTS }), routeContext());
    expect(response.status).toBe(401);
  });

  it("404s on a project outside RLS visibility", async () => {
    projectMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const response = await POST(jsonRequest({ inputs: VALID_INPUTS }), routeContext());
    expect(response.status).toBe(404);
  });

  it("denies roles without programs.write", async () => {
    membershipMaybeSingleMock.mockResolvedValue({
      data: { workspace_id: WORKSPACE_ID, role: "viewer" },
      error: null,
    });
    const response = await POST(jsonRequest({ inputs: VALID_INPUTS }), routeContext());
    expect(response.status).toBe(403);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("400s on payloads that fail the wire schema", async () => {
    const badShape = await POST(jsonRequest({ inputs: { nope: true } }), routeContext());
    expect(badShape.status).toBe(400);

    const smuggled = await POST(
      jsonRequest({
        inputs: {
          ...VALID_INPUTS,
          benefits: [{ kind: "other", label: "x", annualValue: Number.POSITIVE_INFINITY }],
        },
      }),
      routeContext()
    );
    expect(smuggled.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("422s when the engine reports missing data (no benefits and no costs)", async () => {
    const response = await POST(
      jsonRequest({ inputs: { ...VALID_INPUTS, benefits: [], costs: [] } }),
      routeContext()
    );
    expect(response.status).toBe(422);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("recomputes server-side and stores headline metrics with the engine version", async () => {
    const response = await POST(
      jsonRequest({ inputs: VALID_INPUTS, contextLabel: "SR-49 Corridor" }),
      routeContext()
    );
    expect(response.status).toBe(201);

    const inserted = (insertMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(inserted.workspace_id).toBe(WORKSPACE_ID);
    expect(inserted.project_id).toBe(PROJECT_ID);
    expect(inserted.created_by).toBe(USER_ID);
    expect(inserted.engine_version).toBe("openplan-bca-ts");
    expect(inserted.context_label).toBe("SR-49 Corridor");
    expect(inserted.inputs_json).toEqual(VALID_INPUTS);

    // The stored result is the server's own recompute, not client math.
    const result = inserted.result_json as Record<string, number | null>;
    expect(result.presentValueCosts).toBeGreaterThan(0);
    expect(result.presentValueBenefits).toBeGreaterThan(0);
    expect(result.benefitCostRatio).toBeCloseTo(
      (result.presentValueBenefits as number) / (result.presentValueCosts as number),
      10
    );
    expect(result.baseYear).toBe(2026);
    expect(result.analysisHorizonYears).toBe(20);
    expect(result.discountRatePct).toBe(3.1);
  });

  it("500s with a neutral message when the insert fails", async () => {
    insertSingleMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const response = await POST(jsonRequest({ inputs: VALID_INPUTS }), routeContext());
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("Failed to save the screening");
  });
});
