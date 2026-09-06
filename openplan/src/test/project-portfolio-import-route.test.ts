import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
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
const csv = new TextEncoder().encode("ID,Name,Description,Cost,Location\nP-1,Bridge work,Replace deck,12.5,River corridor");

let sourceRows: Record<string, unknown>[];
let projectRows: Record<string, unknown>[];
let priorRows: Record<string, unknown>[];
let storageBytes: Uint8Array;

function awaitable<T>(value: T) {
  const filters: Array<[string, string, unknown]> = [];
  const builder = {
    eq(column: string, expected: unknown) { filters.push(["eq", column, expected]); return builder; },
    is(column: string, expected: unknown) { filters.push(["is", column, expected]); return builder; },
    maybeSingle: async () => {
      const id = filters.find((entry) => entry[1] === "id")?.[2];
      const row = Array.isArray(value) ? (value as Record<string, unknown>[]).find((candidate) => candidate.id === id) ?? null : value;
      return { data: row, error: null };
    },
    then(resolve: (result: { data: T; error: null }) => unknown) { return Promise.resolve(resolve({ data: value, error: null })); },
  };
  return builder;
}

vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: auditInfo, warn: auditWarn, error: auditError }) }));
vi.mock("@/lib/workspaces/membership", () => ({ checkWorkspaceMembership: (...args: unknown[]) => checkMembershipMock(...args) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: (table: string) => ({ select: () => {
      if (table === "kb_documents") return awaitable(sourceRows);
      if (table === "projects") return awaitable(projectRows);
      if (table === "project_portfolio_import_rows") return awaitable(priorRows);
      throw new Error(`Unexpected table ${table}`);
    } }),
  }),
  createServiceRoleClient: () => ({
    storage: { from: () => ({ download: async () => ({ data: new Blob([storageBytes as Uint8Array<ArrayBuffer>]), error: null }) }) },
    rpc: (...args: unknown[]) => rpcMock(...args),
  }),
}));

import { POST } from "@/app/api/projects/import/route";

const configurations = [{
  worksheetIndex: 0,
  headerRow: 1,
  mapping: { sourceId: 0, name: 1, description: 2, estimatedCost: 3, sourceLocation: 4 },
  defaults: { planType: "capital_program", status: "draft", deliveryPhase: "programming", cost: { currency: "CAD", scale: "millions", priceYear: 2025 } },
}];
const basePayload = { workspaceId: WORKSPACE_ID, sourceDocumentId: SOURCE_ID, originalWorkbookDocumentId: ORIGINAL_ID, configurations, rowReviews: [{ worksheetIndex: 0, rowNumber: 2, decision: "create" }] };
function request(payload: unknown) {
  return new NextRequest("http://localhost/api/projects/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
}
async function preview() {
  const response = await POST(request({ ...basePayload, mode: "preview" }));
  return {
    response,
    body: await response.json() as {
      review: { previewHash: string; sourceHash: string };
      source: Record<string, unknown>;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storageBytes = csv;
  const checksum = createHash("sha256").update(storageBytes).digest("hex");
  sourceRows = [{
    id: SOURCE_ID, workspace_id: WORKSPACE_ID, project_id: null, title: "Portfolio export",
    original_filename: "portfolio.csv", source_kind: "uploaded_spreadsheet", status: "ready",
    extraction_source: "spreadsheet_parse", checksum, byte_size: storageBytes.byteLength,
    content_type: "text/csv", storage_ref: `storage://kb-documents/${WORKSPACE_ID}/${SOURCE_ID}/portfolio.csv`,
  }, {
    id: ORIGINAL_ID, workspace_id: WORKSPACE_ID, project_id: null, title: "Original workbook",
    original_filename: "portfolio.xlsx", source_kind: "uploaded_spreadsheet", status: "stored",
    extraction_source: "none", checksum: "1".repeat(64), byte_size: 100,
    content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    storage_ref: `storage://kb-documents/${WORKSPACE_ID}/${ORIGINAL_ID}/portfolio.xlsx`,
  }];
  projectRows = [];
  priorRows = [];
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  checkMembershipMock.mockResolvedValue({ ok: true, role: "member" });
  rpcMock.mockResolvedValue({ data: { batchId: "batch", created: 1, skipped: 0, conflicted: 0, invalid: 0, previouslyCreated: 0, projectIds: ["project"] }, error: null });
});

describe("POST /api/projects/import", () => {
  it("requires authentication and a current write role before source access", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null } });
    expect((await POST(request({ ...basePayload, mode: "preview" }))).status).toBe(401);
    checkMembershipMock.mockResolvedValueOnce({ ok: true, role: "viewer" });
    expect((await POST(request({ ...basePayload, mode: "preview" }))).status).toBe(403);
    checkMembershipMock.mockResolvedValueOnce({ ok: false, kind: "not_member" });
    expect((await POST(request({ ...basePayload, mode: "preview" }))).status).toBe(404);
  });

  it("inspects a stored workbook without selecting a worksheet", async () => {
    storageBytes = readFileSync(path.join(process.cwd(), "src/test/fixtures/portfolio-import/portfolio-multi.xlsx"));
    sourceRows[0] = {
      ...sourceRows[0], original_filename: "portfolio-multi.xlsx", status: "stored", extraction_source: "none",
      content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      checksum: createHash("sha256").update(storageBytes).digest("hex"),
      storage_ref: `storage://kb-documents/${WORKSPACE_ID}/${SOURCE_ID}/portfolio-multi.xlsx`,
    };
    const response = await POST(request({ mode: "inspect", workspaceId: WORKSPACE_ID, sourceDocumentId: SOURCE_ID }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.source).toMatchObject({ format: "xlsx" });
    expect(body.inspection.worksheets[0]).toMatchObject({ index: 0, name: "District α" });
    expect(body.inspection).not.toHaveProperty("selectedWorksheetIndex");
  });

  it("confines primary and optional original sources to workspace-level documents", async () => {
    sourceRows[0].project_id = "other-project";
    expect((await POST(request({ ...basePayload, mode: "preview" }))).status).toBe(404);
    sourceRows[0].project_id = null;
    sourceRows[1].project_id = "other-project";
    expect((await POST(request({ ...basePayload, mode: "preview" }))).status).toBe(404);
  });

  it("previews exact stored bytes and returns format, sheet, row, cost, and location provenance", async () => {
    const { response, body } = await preview();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      source: { id: SOURCE_ID, format: "csv", filename: "portfolio.csv" },
      review: { version: 2, sheets: [{ worksheetIndex: 0, headerRow: 1 }], rows: [{
        worksheetIndex: 0, worksheetName: "CSV", rowNumber: 2, sourceId: "P-1", name: "Bridge work",
        description: "Replace deck", sourceLocationText: "River corridor",
        estimatedCost: { amount: "12500000", currency: "CAD", priceYear: 2025 }, decision: "create", canCreate: true,
      }] },
    });
  });

  it("refuses checksum drift and stale approvals", async () => {
    sourceRows[0].checksum = "9".repeat(64);
    const drift = await POST(request({ ...basePayload, mode: "preview" }));
    expect(drift.status).toBe(409);
    sourceRows[0].checksum = createHash("sha256").update(storageBytes).digest("hex");
    const stale = await POST(request({ ...basePayload, mode: "commit", approvedPreviewHash: "0".repeat(64) }));
    expect(stale.status).toBe(409);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("carries an unknown cost year through exact-byte preview and the existing atomic commit", async () => {
    const unknownYear = configurations.map((config) => ({
      ...config, defaults: { ...config.defaults, cost: { ...config.defaults.cost, priceYear: null } },
    }));
    const response = await POST(request({ ...basePayload, configurations: unknownYear, mode: "preview" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.review.rows[0]).toMatchObject({
      estimatedCost: { amount: "12500000", currency: "CAD", priceYear: null },
      warnings: [{ code: "unknown_price_year" }],
    });
    const committed = await POST(request({ ...basePayload, configurations: unknownYear, mode: "commit", approvedPreviewHash: body.review.previewHash }));
    expect(committed.status).toBe(201);
    expect(rpcMock).toHaveBeenCalledWith("commit_project_portfolio_import_v2", expect.objectContaining({
      p_rows: [expect.objectContaining({ estimatedCost: { amount: "12500000", currency: "CAD", priceYear: null } })],
    }));
  });

  it("returns payload-too-large for a stored source above 10 MiB", async () => {
    storageBytes = new Uint8Array(10 * 1024 * 1024 + 1);
    sourceRows[0].checksum = createHash("sha256").update(storageBytes).digest("hex");
    const response = await POST(request({ ...basePayload, mode: "preview" }));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "size_limit" });
  });

  it("commits only through the v2 atomic RPC and carries no project geography", async () => {
    const { body } = await preview();
    const response = await POST(request({ ...basePayload, mode: "commit", approvedPreviewHash: body.review.previewHash }));
    expect(response.status).toBe(201);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [name, args] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe("commit_project_portfolio_import_v2");
    expect(args).toMatchObject({ p_source_format: "csv", p_sheet_configurations: [{ ...configurations[0], worksheetName: "CSV" }] });
    const row = (args.p_rows as Array<Record<string, unknown>>)[0];
    expect(row).toMatchObject({ worksheetIndex: 0, headerRow: 1, sourceLocationText: "River corridor" });
    for (const field of ["geometry", "coordinates", "bbox", "placeId"]) expect(row).not.toHaveProperty(field);
  });

  it("maps an idempotency race to a full-batch retry", async () => {
    const { body } = await preview();
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "23505" } });
    const response = await POST(request({ ...basePayload, mode: "commit", approvedPreviewHash: body.review.previewHash }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "import_race" });
  });

  it("maps a duplicate-check race to a stale full-batch retry", async () => {
    const { body } = await preview();
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "22023" } });
    const response = await POST(request({ ...basePayload, mode: "commit", approvedPreviewHash: body.review.previewHash }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "import_stale" });
  });

  it("keeps worksheet names, cells, formulas, locations, and costs out of audit logs", async () => {
    const { body } = await preview();
    await POST(request({ ...basePayload, mode: "commit", approvedPreviewHash: body.review.previewHash }));
    const logText = JSON.stringify([...auditInfo.mock.calls, ...auditWarn.mock.calls, ...auditError.mock.calls]);
    for (const sensitive of ["CSV", "Bridge work", "Replace deck", "River corridor", "12500000", "P-1"]) expect(logText).not.toContain(sensitive);
    expect(logText).toContain(body.review.sourceHash);
  });
});
