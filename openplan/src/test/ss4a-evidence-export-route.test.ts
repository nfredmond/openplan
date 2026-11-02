import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SS4A_SECTION_KEYS } from "@/lib/grants/ss4a-safety-seed";
import {
  BCA_VERSION_ROW,
  CAMPAIGN_ROW,
  CRASH_ROWS,
  EVIDENCE_DATE,
  EVIDENCE_IDS,
  evidenceSnapshot,
  ROAD_ROWS,
  seedProvenance,
} from "./fixtures/grants/ss4a-evidence";
import { seedId } from "./fixtures/grants/safety-seed";

/**
 * The SS4A application export, end to end through the route with a fake
 * PostgREST client: a seeded SS4A application whose project has a frozen
 * Safety snapshot, a saved BCA version and an engagement campaign must
 * produce a PDF whose HTML carries every appendix, and the reads behind it
 * must ask for the columns the appendices print.
 */

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const loadFundingOpportunityAccessMock = vi.fn();
const renderReportPdfMock = vi.fn();
const uploadMock = vi.fn();
const checkWorkspaceStorageRoomMock = vi.hoisted(() => vi.fn());
const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => mockAudit }));
vi.mock("@/lib/programs/api", () => ({
  loadFundingOpportunityAccess: (...args: unknown[]) => loadFundingOpportunityAccessMock(...args),
}));
vi.mock("@/lib/reports/pdf", () => ({ renderReportPdf: (...args: unknown[]) => renderReportPdfMock(...args) }));
vi.mock("@/lib/workspaces/storage-quota", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspaces/storage-quota")>()),
  checkWorkspaceStorageRoom: (...args: unknown[]) => checkWorkspaceStorageRoomMock(...args),
}));
vi.mock("@/lib/grants/pursuit", async () => ({
  ...(await vi.importActual<typeof import("@/lib/grants/pursuit")>("@/lib/grants/pursuit")),
  loadOpportunityPursuitContext: async () => ({
    context: { pursuitKind: "grant", solicitationNumber: null, submissionFormatNote: null, questionsDueAt: null, schemaPending: false },
    error: null,
  }),
}));

import { POST as exportApplication } from "@/app/api/funding-opportunities/[opportunityId]/application/export/route";

const USER_ID = seedId(400);
const PDF_BYTES = new Uint8Array([37, 80, 68, 70, 1, 2, 3]);
const POSTGREST_ROW_CAP = 1000;

type Result = { data: unknown; error: { message: string } | null; count?: number | null };
type Call = { table: string; method: string; args: unknown[] };

/** A chain that records every call and answers with a fixed result; `range` honors the row cap. */
function chain(table: string, calls: Call[], result: () => Result) {
  const self: Record<string, unknown> = {};
  let range: [number, number] | null = null;
  for (const method of ["select", "eq", "neq", "in", "order", "limit", "gte", "lte", "insert"]) {
    self[method] = (...args: unknown[]) => {
      calls.push({ table, method, args });
      return self;
    };
  }
  self.range = (from: number, to: number) => {
    calls.push({ table, method: "range", args: [from, to] });
    range = [from, to];
    return self;
  };
  const resolve = () => {
    const base = result();
    if (!range || !Array.isArray(base.data)) return base;
    const [from, to] = range;
    return { ...base, data: base.data.slice(from, Math.min(to + 1, from + POSTGREST_ROW_CAP)) };
  };
  self.maybeSingle = async () => {
    const value = resolve();
    return { ...value, data: Array.isArray(value.data) ? value.data[0] ?? null : value.data };
  };
  self.single = self.maybeSingle;
  self.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(resolve()).then(onFulfilled, onRejected);
  return self;
}

const snapshot = evidenceSnapshot();
const provenance = seedProvenance(snapshot);
const seedDraft = { id: seedId(60), section_id: seedId(10), origin: "safety_plan_seed", safety_seed_id: seedId(70), grounding_json: provenance };

const sections = SS4A_SECTION_KEYS.map((key, index) => ({
  id: seedId(10 + index), workspace_id: EVIDENCE_IDS.workspace, opportunity_id: EVIDENCE_IDS.opportunity, section_key: key,
  title: `Section ${key}`, guidance: null, sort_order: index, source: "catalog", suggested_evidence: [], ai_drafting_enabled: true,
  status: "not_started", final_markdown: null, finalized_from_draft_id: null, finalized_by: null, finalized_at: null,
  updated_by: null, created_at: EVIDENCE_DATE, updated_at: EVIDENCE_DATE,
}));

type Tables = Record<string, () => Result>;
let calls: Call[];
let tables: Tables;

function completeTables(): Tables {
  return {
    funding_opportunity_application_sections: () => ({ data: sections, error: null }),
    funding_opportunity_attachments: () => ({ data: [], error: null }),
    funding_opportunity_section_drafts: () => ({ data: [seedDraft], error: null, count: 1 }),
    reports: () => ({ data: [{ id: EVIDENCE_IDS.report, workspace_id: EVIDENCE_IDS.workspace, project_id: EVIDENCE_IDS.project }], error: null }),
    report_artifacts: () => ({ data: [{ id: EVIDENCE_IDS.artifact, report_id: EVIDENCE_IDS.report, generated_at: EVIDENCE_DATE, metadata_json: { safetyPlanSnapshotV1: snapshot } }], error: null }),
    safety_road_context_features: () => ({ data: ROAD_ROWS, error: null }),
    safety_crashes: () => ({ data: CRASH_ROWS, error: null, count: CRASH_ROWS.length }),
    project_bca_versions: () => ({ data: [BCA_VERSION_ROW()], error: null }),
    project_bca_screenings: () => ({ data: [], error: null }),
    engagement_campaigns: () => ({ data: [CAMPAIGN_ROW], error: null, count: 1 }),
    projects: () => ({ data: { id: EVIDENCE_IDS.project, name: "Example safety project" }, error: null }),
    funding_opportunity_application_exports: () => ({ data: { id: seedId(500), storage_path: "path" }, error: null }),
  };
}

function install() {
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: (table: string) => {
      const handler = tables[table];
      if (!handler) throw new Error(`Unexpected table: ${table}`);
      return chain(table, calls, handler);
    },
  });
}

function post(body?: unknown) {
  return new NextRequest(`http://localhost/api/funding-opportunities/${EVIDENCE_IDS.opportunity}/application/export`, {
    method: "POST",
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
}
const context = { params: Promise.resolve({ opportunityId: EVIDENCE_IDS.opportunity }) };

function callsFor(table: string, method: string) {
  return calls.filter((call) => call.table === table && call.method === method).map((call) => call.args);
}

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  tables = completeTables();
  install();
  loadFundingOpportunityAccessMock.mockResolvedValue({
    opportunity: { id: EVIDENCE_IDS.opportunity, workspace_id: EVIDENCE_IDS.workspace, program_id: null, project_id: EVIDENCE_IDS.project,
      title: "Rural safety action plan", agency_name: "U.S. DOT", summary: null, expected_award_amount: null, closes_at: null,
      opportunity_status: "open", decision_state: "pursue" },
    membership: { workspace_id: EVIDENCE_IDS.workspace, role: "member" }, error: null, allowed: true,
  });
  renderReportPdfMock.mockResolvedValue({ bytes: PDF_BYTES, engine: "builtin", pageCount: 9, disclosure: "Typeset by the built-in writer." });
  uploadMock.mockResolvedValue({ error: null });
  checkWorkspaceStorageRoomMock.mockResolvedValue({ status: "room", usedBytes: 0, quotaBytes: 5 * 1024 ** 3 });
  createServiceRoleClientMock.mockReturnValue({ storage: { from: () => ({ upload: uploadMock }) } });
});

describe("SS4A application export with evidence appendices", () => {
  it("embeds every appendix from the linked Safety, BCA and engagement records", async () => {
    const response = await exportApplication(post(), context);
    expect(response.status).toBe(201);
    const html = renderReportPdfMock.mock.calls[0][0] as string;
    for (const title of ["Appendix A. High-injury network map", "Appendix B. Crash summary", "Appendix C. Countermeasures", "Appendix D. Benefit-cost summary", "Appendix E. Engagement summary"]) {
      expect(html).toContain(title);
    }
    expect(html).toContain('aria-label="Ranked high-injury network segments, numbered by rank"');
    expect(html).toContain(snapshot.hash);
    expect(html).toContain(EVIDENCE_IDS.bcaVersion);
    expect(html).toContain(EVIDENCE_IDS.campaign);
    expect(html).toContain("Fatal crashes only. The source records only crashes in which someone was killed");

    const body = await response.json();
    expect(body.appendices.map((a: { status: string }) => a.status)).toEqual(["included", "included", "included", "included", "included"]);
    expect(body.appendices[0]).toMatchObject({ key: "hin_map", mapDrawn: true, hash: snapshot.hash });
    expect(body.sha256).toBe(createHash("sha256").update(PDF_BYTES).digest("hex"));
    expect(mockAudit.info).toHaveBeenCalledWith("application_exported", expect.objectContaining({ sha256: body.sha256 }));

    // Custody on the register row (migration 20261102110100): the same hash and
    // manifest the response carries, after a probe for the columns.
    const [inserted] = callsFor("funding_opportunity_application_exports", "insert")[0] as [Record<string, unknown>];
    expect(inserted.sha256).toBe(body.sha256);
    expect(inserted.appendix_manifest_json).toEqual(body.appendices);
    expect(inserted.appendix_manifest_json).toHaveLength(5);
    expect(callsFor("funding_opportunity_application_exports", "select")).toEqual([
      ["id, sha256, appendix_manifest_json"],
      ["id, workspace_id, opportunity_id, storage_path, pdf_engine, page_count, generated_by, generated_at, sha256, appendix_manifest_json"],
    ]);
    expect(callsFor("funding_opportunity_application_exports", "eq")).toEqual([["opportunity_id", EVIDENCE_IDS.opportunity]]);

    // Projections, as literals: the columns the appendices print, from the
    // project's own records. A dropped column must fail here, not hide behind
    // a shared constant.
    expect(callsFor("reports", "select")).toEqual([["id, workspace_id, project_id"]]);
    expect(callsFor("reports", "eq")).toEqual(expect.arrayContaining([["workspace_id", EVIDENCE_IDS.workspace], ["project_id", EVIDENCE_IDS.project]]));
    expect(callsFor("report_artifacts", "select")).toEqual([["id, report_id, generated_at, metadata_json"]]);
    expect(callsFor("report_artifacts", "in")).toEqual([["id", [EVIDENCE_IDS.artifact]], ["report_id", [EVIDENCE_IDS.report]]]);
    expect(callsFor("safety_road_context_features", "select")).toEqual([["id, road_name, geometry_geojson, source_id, source_vintage"]]);
    expect(callsFor("safety_road_context_features", "eq")).toEqual([["workspace_id", EVIDENCE_IDS.workspace], ["project_id", EVIDENCE_IDS.project]]);
    expect(callsFor("safety_crashes", "select")).toEqual([["id, longitude, latitude, severity", { count: "exact" }]]);
    expect(callsFor("safety_crashes", "eq")).toEqual([["workspace_id", EVIDENCE_IDS.workspace], ["ingest_id", EVIDENCE_IDS.ingest]]);
    // A fatality census is ranked on fatal crashes only.
    expect(callsFor("safety_crashes", "in")).toEqual([["severity", ["fatal"]], ["collision_year", [2023, 2024]]]);
    expect(callsFor("project_bca_versions", "select")).toEqual([["id, project_id, created_at, document_json, engine_version"]]);
    expect(callsFor("project_bca_versions", "eq")).toEqual([["project_id", EVIDENCE_IDS.project]]);
    expect(callsFor("engagement_campaigns", "select")).toEqual([["id, project_id, title, status, updated_at, ai_synthesis_json, ai_synthesized_at, representativeness_json, representativeness_computed_at", { count: "exact" }]]);
    expect(callsFor("engagement_campaigns", "eq")).toEqual([["project_id", EVIDENCE_IDS.project]]);
  });

  it("lists missing evidence as missing when the project has none of it", async () => {
    tables.funding_opportunity_section_drafts = () => ({ data: [], error: null, count: 0 });
    tables.project_bca_versions = () => ({ data: [], error: null });
    tables.engagement_campaigns = () => ({ data: [], error: null, count: 0 });
    const response = await exportApplication(post(), context);
    expect(response.status).toBe(201);
    const html = renderReportPdfMock.mock.calls[0][0] as string;
    expect(html).toContain("Missing. No saved Safety plan has been seeded into this application.");
    expect(html).toContain("Missing. No benefit-cost analysis or screening is saved for the linked project.");
    expect(html).toContain("Missing. No public engagement campaign is linked to the project.");
    expect(html).not.toContain("<svg");
    expect(callsFor("project_bca_screenings", "select")).toEqual([["id, project_id, result_json, engine_version, created_at"]]);
    expect((await response.json()).appendices.map((a: { status: string }) => a.status)).toEqual(["missing", "missing", "missing", "missing", "missing"]);
  });

  it("marks the engagement appendix unreadable when the linked project cannot be read", async () => {
    tables.projects = () => ({ data: null, error: { message: "permission denied", code: "42501" } });
    const response = await exportApplication(post(), context);
    expect(response.status).toBe(201);
    const statuses = (await response.json()).appendices.map((a: { status: string }) => a.status);
    expect(statuses[4]).toBe("unreadable");
    expect(renderReportPdfMock.mock.calls[0][0]).toContain("The linked project could not be read");
  });

  it("reads only the selected appendices and lists the rest as not selected", async () => {
    const response = await exportApplication(post({ appendices: ["crash_summary"] }), context);
    expect(response.status).toBe(201);
    expect((await response.json()).appendices.map((a: { status: string }) => a.status)).toEqual(["omitted", "included", "omitted", "omitted", "omitted"]);
    for (const table of ["safety_crashes", "safety_road_context_features", "project_bca_versions", "engagement_campaigns"]) {
      expect(callsFor(table, "select"), table).toEqual([]);
    }
    expect(renderReportPdfMock.mock.calls[0][0]).toContain("Not selected. Not selected for this export.");
  });

  it("refuses a malformed selection before rendering anything", async () => {
    for (const body of [{ appendices: ["letters"] }, "{not json"]) {
      expect((await exportApplication(post(body), context)).status).toBe(400);
    }
    expect(renderReportPdfMock).not.toHaveBeenCalled();
  });

  it("stores nothing when the workspace storage limit refuses the package", async () => {
    checkWorkspaceStorageRoomMock.mockResolvedValueOnce({ status: "full", usedBytes: 10, quotaBytes: 10, message: "Workspace storage is full." });
    const response = await exportApplication(post(), context);
    expect(response.status).toBe(413);
    expect(checkWorkspaceStorageRoomMock).toHaveBeenCalledWith(expect.anything(), EVIDENCE_IDS.workspace, PDF_BYTES.byteLength);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(callsFor("funding_opportunity_application_exports", "insert")).toEqual([]);
  });

  it.each([
    "column funding_opportunity_application_exports.sha256 does not exist",
    "Could not find the 'appendix_manifest_json' column of 'funding_opportunity_application_exports' in the schema cache",
  ])("answers 503 naming the custody migration, before rendering or storing, when the database lacks the columns: %s", async (message) => {
    tables.funding_opportunity_application_exports = () => ({ data: null, error: { message, code: "42703" } });
    const response = await exportApplication(post(), context);
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("20261102110100_application_export_custody");
    expect(renderReportPdfMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(callsFor("funding_opportunity_application_exports", "insert")).toEqual([]);
  });

  it("leaves a non-SS4A application without evidence appendices", async () => {
    tables.funding_opportunity_application_sections = () => ({ data: [{ ...sections[0], section_key: "custom-scope", source: "custom" }], error: null });
    tables.funding_opportunity_section_drafts = () => ({ data: [], error: null, count: 0 });
    const response = await exportApplication(post(), context);
    expect(response.status).toBe(201);
    expect(renderReportPdfMock.mock.calls[0][0]).not.toContain("Evidence appendices");
    const body = await response.json();
    expect(body.appendices).toBeNull();
    const [inserted] = callsFor("funding_opportunity_application_exports", "insert")[0] as [Record<string, unknown>];
    expect(inserted).toMatchObject({ sha256: body.sha256, appendix_manifest_json: null });
    expect(inserted.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
