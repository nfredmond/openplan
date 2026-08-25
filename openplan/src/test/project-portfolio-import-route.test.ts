import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUserMock = vi.fn();
const checkMembershipMock = vi.fn();
const rpcMock = vi.fn();
const auditInfo = vi.fn();
const auditWarn = vi.fn();
const auditError = vi.fn();

const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000";
const SOURCE_ID = "660e8400-e29b-41d4-a716-446655440000";
const ORIGINAL_ID = "770e8400-e29b-41d4-a716-446655440000";
const USER_ID = "880e8400-e29b-41d4-a716-446655440000";

const csv = "ID,Name,Description,Cost,Location\nP-1,Bridge work,Replace deck,12.5,River corridor";
const sourceHash = "2eb396a9ef79bada4c57df0749ba3e8479532aab37d7a175654c92476879527c";

let sourceRows: Record<string, unknown>[];
let projectRows: Record<string, unknown>[];
let priorRows: Record<string, unknown>[];
let storageBytes: Uint8Array;

function awaitable<T>(value: T) {
  const filters: Array<[string, string, unknown]> = [];
  const builder = {
    filters,
    eq(column: string, expected: unknown) {
      filters.push(["eq", column, expected]);
      return builder;
    },
    is(column: string, expected: unknown) {
      filters.push(["is", column, expected]);
      return builder;
    },
    maybeSingle: async () => {
      const id = filters.find((entry) => entry[1] === "id")?.[2];
      const row = Array.isArray(value)
        ? (value as Record<string, unknown>[]).find((candidate) => candidate.id === id) ?? null
        : value;
      return { data: row, error: null };
    },
    then(resolve: (result: { data: T; error: null }) => unknown) {
      return Promise.resolve(resolve({ data: value, error: null }));
    },
  };
  return builder;
}

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: auditInfo, warn: auditWarn, error: auditError }),
}));

vi.mock("@/lib/workspaces/membership", () => ({
  checkWorkspaceMembership: (...args: unknown[]) => checkMembershipMock(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: (table: string) => ({
      select: () => {
        if (table === "kb_documents") return awaitable(sourceRows);
        if (table === "projects") return awaitable(projectRows);
        if (table === "project_portfolio_import_rows") return awaitable(priorRows);
        throw new Error(`Unexpected table ${table}`);
      },
    }),
  }),
  createServiceRoleClient: () => ({
    storage: {
      from: () => ({
        download: async () => ({
          data: new Blob([new TextDecoder().decode(storageBytes)]),
          error: null,
        }),
      }),
    },
    rpc: (...args: unknown[]) => rpcMock(...args),
  }),
}));

import { POST } from "@/app/api/projects/import/route";

const basePayload = {
  workspaceId: WORKSPACE_ID,
  sourceDocumentId: SOURCE_ID,
  originalWorkbookDocumentId: ORIGINAL_ID,
  mapping: { sourceId: 0, name: 1, description: 2, estimatedCost: 3, sourceLocation: 4 },
  defaults: {
    planType: "capital_program",
    status: "draft",
    deliveryPhase: "programming",
    cost: { currency: "CAD", scale: "millions", priceYear: 2025 },
  },
  rowReviews: [{ rowNumber: 2, decision: "create" }],
};

function request(payload: unknown) {
  return new NextRequest("http://localhost/api/projects/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function preview() {
  const response = await POST(request({ ...basePayload, mode: "preview" }));
  const body = (await response.json()) as { review: { previewHash: string } };
  return { response, body };
}

beforeEach(() => {
  vi.clearAllMocks();
  storageBytes = new TextEncoder().encode(csv);
  sourceRows = [
    {
      id: SOURCE_ID,
      workspace_id: WORKSPACE_ID,
      project_id: null,
      title: "Portfolio export",
      original_filename: "portfolio.csv",
      source_kind: "uploaded_spreadsheet",
      status: "ready",
      extraction_source: "spreadsheet_parse",
      checksum: sourceHash,
      byte_size: storageBytes.byteLength,
      storage_ref: `storage://kb-documents/${WORKSPACE_ID}/${SOURCE_ID}/portfolio.csv`,
    },
    {
      id: ORIGINAL_ID,
      workspace_id: WORKSPACE_ID,
      project_id: null,
      title: "Original portfolio workbook",
      original_filename: "portfolio.xlsx",
      source_kind: "uploaded_spreadsheet",
      status: "stored",
      extraction_source: "none",
      checksum: "1".repeat(64),
      byte_size: 100,
      storage_ref: `storage://kb-documents/${WORKSPACE_ID}/${ORIGINAL_ID}/portfolio.xlsx`,
    },
  ];
  projectRows = [];
  priorRows = [];
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  checkMembershipMock.mockResolvedValue({ ok: true, role: "member" });
  rpcMock.mockResolvedValue({
    data: {
      batchId: "990e8400-e29b-41d4-a716-446655440000",
      created: 1,
      skipped: 0,
      conflicted: 0,
      invalid: 0,
      previouslyCreated: 0,
      projectIds: ["aa0e8400-e29b-41d4-a716-446655440000"],
    },
    error: null,
  });
});

describe("POST /api/projects/import", () => {
  it("requires authentication and a current write role", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null } });
    expect((await POST(request({ ...basePayload, mode: "preview" }))).status).toBe(401);

    checkMembershipMock.mockResolvedValueOnce({ ok: true, role: "viewer" });
    expect((await POST(request({ ...basePayload, mode: "preview" }))).status).toBe(403);
  });

  it("refuses a cross-workspace request before reading source bytes", async () => {
    checkMembershipMock.mockResolvedValue({ ok: false, kind: "not_member", message: "not found" });
    const response = await POST(request({ ...basePayload, mode: "preview" }));
    expect(response.status).toBe(404);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("confines both the CSV and original workbook to workspace-level documents", async () => {
    sourceRows[0].project_id = "project-private";
    const projectCsv = await POST(request({ ...basePayload, mode: "preview" }));
    expect(projectCsv.status).toBe(404);
    expect(rpcMock).not.toHaveBeenCalled();

    sourceRows[0].project_id = null;
    sourceRows[1].project_id = "project-private";
    const projectWorkbook = await POST(request({ ...basePayload, mode: "preview" }));
    expect(projectWorkbook.status).toBe(404);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("previews the exact stored bytes with source metadata and row decisions", async () => {
    const { response, body } = await preview();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      source: {
        id: SOURCE_ID,
        filename: "portfolio.csv",
        originalWorkbook: { id: ORIGINAL_ID, filename: "portfolio.xlsx" },
      },
      review: {
        rows: [
          {
            rowNumber: 2,
            sourceId: "P-1",
            name: "Bridge work",
            description: "Replace deck",
            sourceLocationText: "River corridor",
            estimatedCost: { amount: "12500000", currency: "CAD", priceYear: 2025 },
            decision: "create",
            canCreate: true,
          },
        ],
      },
    });
    expect(body.review.previewHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses when stored bytes no longer match the Knowledge Base checksum", async () => {
    sourceRows[0].checksum = "9".repeat(64);
    const response = await POST(request({ ...basePayload, mode: "preview" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "source_hash_mismatch" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("refuses stale approval after recomputing current duplicate checks", async () => {
    const response = await POST(
      request({ ...basePayload, mode: "commit", approvedPreviewHash: "0".repeat(64) })
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "stale_preview" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("commits only through the atomic RPC and carries no geography field", async () => {
    const { body } = await preview();
    const response = await POST(
      request({
        ...basePayload,
        mode: "commit",
        approvedPreviewHash: body.review.previewHash,
      })
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ committed: { created: 1 } });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [, args] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(args).toMatchObject({
      p_workspace_id: WORKSPACE_ID,
      p_actor_id: USER_ID,
      p_source_document_id: SOURCE_ID,
      p_original_workbook_document_id: ORIGINAL_ID,
    });
    const rows = args.p_rows as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ sourceLocationText: "River corridor" });
    expect(rows[0]).not.toHaveProperty("geometry");
    expect(rows[0]).not.toHaveProperty("coordinates");
    expect(rows[0]).not.toHaveProperty("bbox");
    expect(rows[0]).not.toHaveProperty("placeId");
  });

  it("maps an idempotency race to a complete-batch retry", async () => {
    const { body } = await preview();
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "23505" } });
    const response = await POST(
      request({ ...basePayload, mode: "commit", approvedPreviewHash: body.review.previewHash })
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "import_race" });
  });

  it("never writes CSV cell content or cost values to audit logs", async () => {
    const { body } = await preview();
    await POST(
      request({ ...basePayload, mode: "commit", approvedPreviewHash: body.review.previewHash })
    );
    const logText = JSON.stringify([
      ...auditInfo.mock.calls,
      ...auditWarn.mock.calls,
      ...auditError.mock.calls,
    ]);
    for (const sensitive of ["Bridge work", "Replace deck", "River corridor", "12500000", "P-1"]) {
      expect(logText).not.toContain(sensitive);
    }
    expect(logText).toContain(sourceHash);
  });
});
