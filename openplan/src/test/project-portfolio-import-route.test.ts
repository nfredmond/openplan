import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUserMock = vi.fn();
const checkMembershipMock = vi.fn();
const rpcMock = vi.fn();
const selectMock = vi.fn();
const orderMock = vi.fn();
const rangeMock = vi.fn();
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
let failedPageTable: string | null;

function awaitable<T>(value: T, table: string) {
  const filters: Array<[string, string, unknown]> = [];
  let range: [number, number] | null = null;
  const builder = {
    eq(column: string, expected: unknown) { filters.push(["eq", column, expected]); return builder; },
    is(column: string, expected: unknown) { filters.push(["is", column, expected]); return builder; },
    order(column: string, options: unknown) { orderMock(table, column, options); return builder; },
    range(from: number, to: number) { range = [from, to]; rangeMock(table, from, to); return builder; },
    maybeSingle: async () => {
      const id = filters.find((entry) => entry[1] === "id")?.[2];
      const row = Array.isArray(value) ? (value as Record<string, unknown>[]).find((candidate) => candidate.id === id) ?? null : value;
      return { data: row, error: null };
    },
    then(resolve: (result: { data: T | null; error: { code: string } | null }) => unknown) {
      if (table === failedPageTable && range?.[0] === 500) {
        return Promise.resolve(resolve({ data: null, error: { code: "page_failed" } }));
      }
      // Match the repository's 1,000-row API cap, including unpaged queries.
      const data = Array.isArray(value)
        ? value.slice(range?.[0] ?? 0, Math.min((range?.[1] ?? 999) + 1, (range?.[0] ?? 0) + 1000)) as T
        : value;
      return Promise.resolve(resolve({ data, error: null }));
    },
  };
  return builder;
}

vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: auditInfo, warn: auditWarn, error: auditError }) }));
vi.mock("@/lib/workspaces/membership", () => ({ checkWorkspaceMembership: (...args: unknown[]) => checkMembershipMock(...args) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: (table: string) => ({ select: (columns: string) => {
      selectMock(table, columns);
      if (table === "kb_documents") return awaitable(sourceRows, table);
      if (table === "projects") return awaitable(projectRows, table);
      if (table === "project_portfolio_import_rows") return awaitable(priorRows, table);
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
  failedPageTable = null;
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

  it("preserves the frozen valid EUR row and skipped invalid source status in one RPC payload", async () => {
    // Base64 keeps the captured CRLF source bytes stable across Git line-ending settings.
    storageBytes = Buffer.from(readFileSync(path.join(process.cwd(), "src/test/fixtures/portfolio-import/skipped-invalid-status.csv.b64"), "utf8"), "base64");
    sourceRows[0].checksum = createHash("sha256").update(storageBytes).digest("hex");
    sourceRows[0].byte_size = storageBytes.byteLength;
    const payload = {
      workspaceId: WORKSPACE_ID, sourceDocumentId: SOURCE_ID,
      configurations: [{
        worksheetIndex: 0, headerRow: 1,
        mapping: { name: 0, description: 1, estimatedCost: 4, status: 2, sourceLocation: 3 },
        defaults: { planType: "capital_program", status: "draft", deliveryPhase: "programming",
          cost: { currency: "EUR", scale: "ones", priceYear: null } },
      }],
      rowReviews: [
        { worksheetIndex: 0, rowNumber: 2, decision: "create", confirmNameMatch: false, confirmFormula: false },
        { worksheetIndex: 0, rowNumber: 3, decision: "skip", confirmNameMatch: false, confirmFormula: false },
      ],
    };
    const reviewed = await POST(request({ ...payload, mode: "preview" }));
    expect(reviewed.status).toBe(200);
    const { review } = await reviewed.json();
    expect(review.previewHash).toBe("b8d13529a3267b9b733a3ec80181494615d44c4940e833866bf691da006d0508");
    expect(review.rows).toMatchObject([
      { rowNumber: 2, decision: "create", canCreate: true, state: "warning",
        estimatedCost: { amount: "125000", currency: "EUR", priceYear: null },
        warnings: [{ code: "unknown_price_year" }] },
      { rowNumber: 3, decision: "skip", canCreate: false, state: "blocked",
        status: "invented-status", errors: [{ code: "invalid_status" }] },
    ]);
    const response = await POST(request({ ...payload, mode: "commit", approvedPreviewHash: review.previewHash }));
    expect(response.status).toBe(201);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("commit_project_portfolio_import_v2", expect.objectContaining({
      p_preview_hash: review.previewHash,
      p_rows: [
        expect.objectContaining({ rowNumber: 2, decision: "create", canCreate: true,
          estimatedCost: { amount: "125000", currency: "EUR", priceYear: null } }),
        expect.objectContaining({ rowNumber: 3, decision: "skip", canCreate: false,
          status: "invented-status", errors: [{ code: "invalid_status", message: expect.any(String) }] }),
      ],
    }));
    // The RPC is mocked. A 201 here proves payload custody, not native success.
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

  it("reports an unconfirmed commit and rechecks prior creations before retrying", async () => {
    const initial = await POST(request({ ...basePayload, mode: "preview" }));
    const { review } = await initial.json();
    rpcMock.mockImplementationOnce(async () => {
      // Model a committed transaction whose acknowledgement did not arrive.
      projectRows = [{ id: "created-project", name: "Bridge work" }];
      priorRows = [{
        source_sha256: review.sourceHash, worksheet_index: 0, source_row_number: 2,
        row_fingerprint: review.rows[0].fingerprint, created_project_id: "created-project",
      }];
      return { data: null, error: { code: "", message: "Failed to fetch" } };
    });

    const response = await POST(request({ ...basePayload, mode: "commit", approvedPreviewHash: review.previewHash }));
    expect(response.status).toBe(500);
    expect((await response.json()).error, "unconfirmed commit must direct re-review without claiming rollback").toBe(
      "The portfolio import result could not be confirmed. Review selections again before retrying; rows already created from this source will be locked to skip."
    );

    const retry = await POST(request({ ...basePayload, mode: "preview" }));
    expect(retry.status).toBe(200);
    const recovered = await retry.json();
    expect(selectMock.mock.calls, "retry query must select the complete prior-creation identity").toContainEqual([
      "project_portfolio_import_rows",
      "source_sha256, worksheet_index, source_row_number, row_fingerprint, created_project_id",
    ]);
    expect(recovered.review.rows[0], "re-review must lock a previously created source row").toMatchObject({
      state: "created_before", decision: "skip", canCreate: false, previouslyCreatedProjectId: "created-project",
    });
    expect(recovered.review.previewHash).not.toBe(review.previewHash);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("checks project name matches beyond the database row cap", async () => {
    projectRows = Array.from({ length: 1000 }, (_, index) => ({ id: `other-${index}`, name: `Other project ${index}` }));
    projectRows.push({ id: "tail-match", name: "Bridge work" });
    const response = await POST(request({ ...basePayload, mode: "preview" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.review.rows[0], "project beyond row cap must require individual name confirmation").toMatchObject({
      matchingProjectIds: ["tail-match"], canCreate: false,
      warnings: expect.arrayContaining([expect.objectContaining({ code: "name_match_confirmation_required" })]),
    });
    expect(selectMock.mock.calls, "project duplicate projection must include name and identity").toContainEqual(["projects", "id, name"]);
    expect(orderMock.mock.calls, "project duplicate pages must use stable identity order").toContainEqual(["projects", "id", { ascending: true }]);
    expect(rangeMock.mock.calls, "project duplicate checks must request the page beyond row cap").toContainEqual(["projects", 1000, 1499]);
  });

  it("locks every previously created source row beyond the database row cap", async () => {
    storageBytes = new TextEncoder().encode("Name\n" + Array.from({ length: 1001 }, (_, index) => `Project ${index}`).join("\n"));
    sourceRows[0].checksum = createHash("sha256").update(storageBytes).digest("hex");
    const payload = {
      mode: "preview", workspaceId: WORKSPACE_ID, sourceDocumentId: SOURCE_ID,
      configurations: [{ ...configurations[0], mapping: { name: 0 } }],
    };
    const initial = await POST(request(payload));
    const { review } = await initial.json();
    priorRows = review.rows.map((row: { rowNumber: number; fingerprint: string }) => ({
      source_sha256: review.sourceHash, worksheet_index: 0, source_row_number: row.rowNumber,
      row_fingerprint: row.fingerprint, created_project_id: `created-${row.rowNumber}`,
    }));
    const response = await POST(request(payload));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.review.counts.previouslyCreated, "retry must recover all source rows beyond row cap").toBe(1001);
    expect(body.review.rows[1000], "last prior source row must be locked to skip").toMatchObject({
      state: "created_before", decision: "skip", canCreate: false, previouslyCreatedProjectId: "created-1002",
    });
    expect(selectMock.mock.calls, "prior duplicate projection must retain full source identity").toContainEqual([
      "project_portfolio_import_rows", "source_sha256, worksheet_index, source_row_number, row_fingerprint, created_project_id",
    ]);
    expect(orderMock.mock.calls, "prior duplicate pages must use stable identity order").toContainEqual(["project_portfolio_import_rows", "id", { ascending: true }]);
    expect(rangeMock.mock.calls, "prior duplicate checks must request the page beyond row cap").toContainEqual(["project_portfolio_import_rows", 1000, 1499]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("stops the review when a later duplicate page fails", async () => {
    projectRows = Array.from({ length: 501 }, (_, index) => ({ id: `other-${index}`, name: `Other project ${index}` }));
    failedPageTable = "projects";
    const response = await POST(request({ ...basePayload, mode: "preview" }));
    expect(response.status, "later duplicate-page failure must stop the review").toBe(500);
    expect(await response.json()).toEqual({ error: "Could not check current duplicates, so the review stopped" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("keeps worksheet names, cells, formulas, locations, and costs out of audit logs", async () => {
    const { body } = await preview();
    await POST(request({ ...basePayload, mode: "commit", approvedPreviewHash: body.review.previewHash }));
    const logText = JSON.stringify([...auditInfo.mock.calls, ...auditWarn.mock.calls, ...auditError.mock.calls]);
    for (const sensitive of ["CSV", "Bridge work", "Replace deck", "River corridor", "12500000", "P-1"]) expect(logText).not.toContain(sensitive);
    expect(logText).toContain(body.review.sourceHash);
  });
});
