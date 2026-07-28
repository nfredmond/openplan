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

import { DELETE, PATCH, POST } from "@/app/api/projects/[projectId]/spend-entries/route";

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const DELIVERABLE_ID = "44444444-4444-4444-8444-444444444444";
const ENTRY_ID = "55555555-5555-4555-8555-555555555555";

const projectMaybeSingleMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const deliverableMaybeSingleMock = vi.fn();

const insertSingleMock = vi.fn();
const insertSelectMock = vi.fn(() => ({ single: insertSingleMock }));
const insertMock = vi.fn(() => ({ select: insertSelectMock }));

const updateMaybeSingleMock = vi.fn();
const updateSelectMock = vi.fn(() => ({ maybeSingle: updateMaybeSingleMock }));
const updateProjectEqMock = vi.fn(() => ({ select: updateSelectMock }));
const updateIdEqMock = vi.fn(() => ({ eq: updateProjectEqMock }));
const updateMock = vi.fn(() => ({ eq: updateIdEqMock }));

const deleteMaybeSingleMock = vi.fn();
const deleteSelectMock = vi.fn(() => ({ maybeSingle: deleteMaybeSingleMock }));
const deleteProjectEqMock = vi.fn(() => ({ select: deleteSelectMock }));
const deleteIdEqMock = vi.fn(() => ({ eq: deleteProjectEqMock }));
const deleteMock = vi.fn(() => ({ eq: deleteIdEqMock }));

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
      if (table === "project_deliverables") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: deliverableMaybeSingleMock })),
          })),
        };
      }
      if (table === "project_spend_entries") {
        return { insert: insertMock, update: updateMock, delete: deleteMock };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

function jsonRequest(method: "POST" | "PATCH", payload: unknown) {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/spend-entries`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function deleteRequest(entryId: string | null) {
  const search = entryId ? `?entryId=${entryId}` : "";
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/spend-entries${search}`, {
    method: "DELETE",
  });
}

function routeContext(projectId: string = PROJECT_ID) {
  return { params: Promise.resolve({ projectId }) };
}

const VALID_CREATE = {
  amount: 1250.5,
  description: "Traffic counts subconsultant",
};

describe("/api/projects/[projectId]/spend-entries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    createClientMock.mockResolvedValue(supabaseMock());
    projectMaybeSingleMock.mockResolvedValue({
      data: { id: PROJECT_ID, workspace_id: WORKSPACE_ID },
      error: null,
    });
    membershipMaybeSingleMock.mockResolvedValue({
      data: { workspace_id: WORKSPACE_ID, role: "admin" },
      error: null,
    });
    deliverableMaybeSingleMock.mockResolvedValue({
      data: { id: DELIVERABLE_ID, project_id: PROJECT_ID },
      error: null,
    });
    insertSingleMock.mockResolvedValue({
      data: { id: ENTRY_ID, project_id: PROJECT_ID, amount: 1250.5 },
      error: null,
    });
    updateMaybeSingleMock.mockResolvedValue({
      data: { id: ENTRY_ID, project_id: PROJECT_ID, amount: 900 },
      error: null,
    });
    deleteMaybeSingleMock.mockResolvedValue({ data: { id: ENTRY_ID }, error: null });
  });

  it("rejects a non-uuid project id", async () => {
    const response = await POST(jsonRequest("POST", VALID_CREATE), routeContext("nope"));
    expect(response.status).toBe(400);
  });

  it("requires an authenticated user", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });
    const response = await POST(jsonRequest("POST", VALID_CREATE), routeContext());
    expect(response.status).toBe(401);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("404s on a project outside RLS visibility", async () => {
    projectMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const response = await POST(jsonRequest("POST", VALID_CREATE), routeContext());
    expect(response.status).toBe(404);
  });

  it("denies roles without invoices.write", async () => {
    membershipMaybeSingleMock.mockResolvedValue({
      data: { workspace_id: WORKSPACE_ID, role: "member" },
      error: null,
    });
    const response = await POST(jsonRequest("POST", VALID_CREATE), routeContext());
    expect(response.status).toBe(403);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("refuses a deliverable that belongs to a different project", async () => {
    deliverableMaybeSingleMock.mockResolvedValue({
      data: { id: DELIVERABLE_ID, project_id: "99999999-9999-4999-8999-999999999999" },
      error: null,
    });

    const response = await POST(
      jsonRequest("POST", { ...VALID_CREATE, deliverableId: DELIVERABLE_ID }),
      routeContext()
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/does not belong to this project/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("records a spend entry with attribution and server-side identity", async () => {
    const response = await POST(
      jsonRequest("POST", {
        ...VALID_CREATE,
        deliverableId: DELIVERABLE_ID,
        entryDate: "2026-07-01",
        vendorLabel: "Counts Co",
      }),
      routeContext()
    );

    expect(response.status).toBe(201);
    const inserted = (insertMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(inserted.project_id).toBe(PROJECT_ID);
    expect(inserted.deliverable_id).toBe(DELIVERABLE_ID);
    expect(inserted.entry_date).toBe("2026-07-01");
    expect(inserted.amount).toBe(1250.5);
    expect(inserted.vendor_label).toBe("Counts Co");
    expect(inserted.created_by).toBe(USER_ID);
  });

  it("omits entry_date when not provided so the DB default applies", async () => {
    const response = await POST(jsonRequest("POST", VALID_CREATE), routeContext());
    expect(response.status).toBe(201);
    const inserted = (insertMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect("entry_date" in inserted).toBe(false);
  });

  it("PATCH refuses a cross-project deliverable reattribution", async () => {
    deliverableMaybeSingleMock.mockResolvedValue({
      data: { id: DELIVERABLE_ID, project_id: "99999999-9999-4999-8999-999999999999" },
      error: null,
    });

    const response = await PATCH(
      jsonRequest("PATCH", { entryId: ENTRY_ID, deliverableId: DELIVERABLE_ID }),
      routeContext()
    );

    expect(response.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("PATCH updates the entry scoped to the project and 404s when it is missing", async () => {
    const response = await PATCH(jsonRequest("PATCH", { entryId: ENTRY_ID, amount: 900 }), routeContext());
    expect(response.status).toBe(200);
    expect(updateIdEqMock).toHaveBeenCalledWith("id", ENTRY_ID);
    expect(updateProjectEqMock).toHaveBeenCalledWith("project_id", PROJECT_ID);

    updateMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const missing = await PATCH(jsonRequest("PATCH", { entryId: ENTRY_ID, amount: 900 }), routeContext());
    expect(missing.status).toBe(404);
  });

  it("DELETE removes a ledger row, scoped to the project", async () => {
    const response = await DELETE(deleteRequest(ENTRY_ID), routeContext());
    expect(response.status).toBe(200);
    expect(deleteIdEqMock).toHaveBeenCalledWith("id", ENTRY_ID);
    expect(deleteProjectEqMock).toHaveBeenCalledWith("project_id", PROJECT_ID);
    expect((await response.json()).deleted).toBe(true);
  });

  it("DELETE 404s when the entry is not in this project", async () => {
    deleteMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const response = await DELETE(deleteRequest(ENTRY_ID), routeContext());
    expect(response.status).toBe(404);
  });

  it("DELETE 400s without a valid entryId", async () => {
    const response = await DELETE(deleteRequest(null), routeContext());
    expect(response.status).toBe(400);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
