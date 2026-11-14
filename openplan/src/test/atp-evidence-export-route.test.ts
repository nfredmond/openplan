import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { BCA_NARRATIVE_CAVEAT } from "@/lib/bca/parameters";
import { ENGAGEMENT_NARRATIVE_CAVEAT } from "@/lib/grants/engagement-evidence";
import { KB_NARRATIVE_CAVEAT } from "@/lib/grants/kb-evidence";
import { GRANT_MODELING_PLANNING_CAVEAT } from "@/lib/grants/modeling-evidence";
import { GRANT_PROGRAM_CATALOG } from "@/lib/grants/program-catalog";
import { SAFETY_SEED_CAVEAT } from "@/lib/grants/safety-seed-origin";
import { ATP_VERIFY_GUIDELINES } from "@/lib/planner-pack/render";
import { ATP_IDS, atpIngestRow, atpProjectRow, atpRunMetrics, atpSeverityCountRows } from "./fixtures/grants/atp-evidence";
import { BCA_VERSION_ROW, CAMPAIGN_ROW, EVIDENCE_DATE, EVIDENCE_IDS } from "./fixtures/grants/ss4a-evidence";
import { seedId } from "./fixtures/grants/safety-seed";

/**
 * The ATP application export, end to end through the route with a fake
 * PostgREST client: an application seeded from the ATP template whose project
 * has an estimate, a corridor analysis run, a crash acquisition, a saved BCA
 * version and an engagement campaign must produce a PDF whose HTML carries
 * every ATP appendix, and the reads behind it must ask for the columns the
 * appendices print, scoped to the application's workspace and project.
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
const PDF_BYTES = new Uint8Array([37, 80, 68, 70, 4, 5, 6]);
const POSTGREST_ROW_CAP = 1000;

type Result = { data: unknown; error: { message: string } | null; count?: number | null };
type Call = { table: string; method: string; args: unknown[] };

/** A chain that records every call and answers with a fixed result; `range` honors the row cap. */
function chain(table: string, calls: Call[], result: () => Result) {
  const self: Record<string, unknown> = {};
  let range: [number, number] | null = null;
  for (const method of ["select", "eq", "neq", "in", "order", "limit", "insert"]) {
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

const ATP_TEMPLATE = GRANT_PROGRAM_CATALOG.find((entry) => entry.key === "atp")!;
const sections = (ATP_TEMPLATE.applicationSections ?? []).map((template, index) => ({
  id: seedId(10 + index), workspace_id: ATP_IDS.workspace, opportunity_id: ATP_IDS.opportunity, section_key: template.key,
  title: template.title, guidance: null, sort_order: index, source: "catalog", suggested_evidence: [], ai_drafting_enabled: true,
  status: "not_started", final_markdown: null, finalized_from_draft_id: null, finalized_by: null, finalized_at: null,
  updated_by: null, created_at: EVIDENCE_DATE, updated_at: EVIDENCE_DATE,
}));

type Tables = Record<string, () => Result>;
let calls: Call[];
let tables: Tables;
let rpcResult: () => Result;

function completeTables(): Tables {
  return {
    funding_opportunity_application_sections: () => ({ data: sections, error: null }),
    funding_opportunity_attachments: () => ({ data: [], error: null }),
    funding_opportunity_section_drafts: () => ({ data: [], error: null, count: 0 }),
    projects: () => ({ data: atpProjectRow(), error: null }),
    runs: () => ({ data: [{ id: ATP_IDS.run, title: "Main Street ATP screen", created_at: "2026-11-02T17:00:00+00:00", metrics: atpRunMetrics() }], error: null }),
    safety_crash_ingests: () => ({ data: [atpIngestRow()], error: null }),
    project_bca_versions: () => ({ data: [BCA_VERSION_ROW()], error: null }),
    project_bca_screenings: () => ({ data: [], error: null }),
    engagement_campaigns: () => ({ data: [CAMPAIGN_ROW], error: null, count: 1 }),
    workspaces: () => ({ data: { time_zone: "America/Los_Angeles", home_country_code: "US" }, error: null }),
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
    rpc: (name: string, args: unknown) => {
      calls.push({ table: `rpc:${name}`, method: "rpc", args: [args] });
      return chain(`rpc:${name}`, calls, rpcResult);
    },
  });
}

function post(body?: unknown) {
  return new NextRequest(`http://localhost/api/funding-opportunities/${ATP_IDS.opportunity}/application/export`, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
}
const context = { params: Promise.resolve({ opportunityId: ATP_IDS.opportunity }) };

function callsFor(table: string, method: string) {
  return calls.filter((call) => call.table === table && call.method === method).map((call) => call.args);
}

function statuses(body: { appendices: Array<{ key: string; status: string }> }) {
  return body.appendices.map((appendix) => [appendix.key, appendix.status]);
}

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  tables = completeTables();
  rpcResult = () => ({ data: atpSeverityCountRows(), error: null });
  install();
  loadFundingOpportunityAccessMock.mockResolvedValue({
    opportunity: { id: ATP_IDS.opportunity, workspace_id: ATP_IDS.workspace, program_id: null, project_id: ATP_IDS.project,
      title: "Main Street ATP application", agency_name: "California Transportation Commission", summary: null, expected_award_amount: null,
      closes_at: null, opportunity_status: "open", decision_state: "pursue" },
    membership: { workspace_id: ATP_IDS.workspace, role: "member" }, error: null, allowed: true,
  });
  renderReportPdfMock.mockResolvedValue({ bytes: PDF_BYTES, engine: "builtin", pageCount: 7, disclosure: "Typeset by the built-in writer." });
  uploadMock.mockResolvedValue({ error: null });
  checkWorkspaceStorageRoomMock.mockResolvedValue({ status: "room", usedBytes: 0, quotaBytes: 5 * 1024 ** 3 });
  createServiceRoleClientMock.mockReturnValue({ storage: { from: () => ({ upload: uploadMock }) } });
});

describe("ATP application export with evidence appendices (KI-2026-11-02-045)", () => {
  it("embeds every ATP appendix from the linked project's saved records", async () => {
    const response = await exportApplication(post(), context);
    expect(response.status).toBe(201);
    const html = renderReportPdfMock.mock.calls[0][0] as string;
    for (const title of [
      "Appendix A. ATP screening packet",
      "Appendix B. Crash summary",
      "Appendix C. Cost estimate",
      "Appendix D. Engagement summary",
      "Appendix E. Disadvantaged-community and equity inputs",
      "Appendix F. Benefit-cost summary",
    ]) {
      expect(html).toContain(title);
    }
    expect(html).not.toContain("SS4A");
    expect(html).toContain("Not recorded. Equity is withheld because required demographic inputs are unavailable.");
    expect(html).toContain("<td>60.0</td>");
    expect(html).toContain(ATP_VERIFY_GUIDELINES.replaceAll("'", "&#39;"));
    // The run's crash snapshot was fetched at 03:40 UTC on November 2: November 1 in Los Angeles.
    expect(html).toContain("California Crash Reporting System (CCRS), crash years 2022–2025, retrieved 2026-11-01.");
    expect(html).toContain("<dt>Serious-injury crashes</dt><dd>12</dd>");
    expect(html).toContain("<dt>Crashes outside the boundary, left out</dt><dd>261</dd>");
    expect(html).toContain(EVIDENCE_IDS.bcaVersion);
    expect(html).toContain(EVIDENCE_IDS.campaign);

    const body = await response.json();
    expect(statuses(body)).toEqual([
      ["scoring_packet", "included"], ["crash_summary", "included"], ["cost_estimate", "included"],
      ["engagement", "included"], ["equity", "included"], ["bca", "included"],
    ]);
    expect(mockAudit.info).toHaveBeenCalledWith("application_exported", expect.objectContaining({ appendices: body.appendices }));

    // Projections, as literals: the columns the appendices print, from the
    // project's own records in the application's own workspace.
    expect(callsFor("projects", "select")).toEqual([[
      "id, name, summary, estimated_cost_amount::text, estimated_cost_currency, estimated_cost_basis_year, estimated_cost_recorded_at, estimated_cost_source_document_id",
    ]]);
    expect(callsFor("projects", "eq")).toEqual([["id", ATP_IDS.project], ["workspace_id", ATP_IDS.workspace]]);
    expect(callsFor("runs", "select")).toEqual([["id, title, created_at, metrics"]]);
    expect(callsFor("runs", "eq")).toEqual([["workspace_id", ATP_IDS.workspace], ["project_id", ATP_IDS.project]]);
    expect(callsFor("runs", "order")).toEqual([["created_at", { ascending: false }]]);
    expect(callsFor("safety_crash_ingests", "select")).toEqual([[
      "id, project_id, min_lon, min_lat, max_lon, max_lat, status, source_id, source_label, attribution, severity_completeness, crash_count, geocoded_count, stored_count, truncated, years_requested, created_at, dimension_coverage, party_completeness, party_count, involvement_basis, published_through, published_through_provenance",
    ]]);
    expect(callsFor("safety_crash_ingests", "eq")).toEqual([["workspace_id", ATP_IDS.workspace], ["project_id", ATP_IDS.project], ["status", "ready"]]);
    // Paged until a short page: every page asks for this workspace and this acquisition only.
    const countReads = callsFor("rpc:safety_crash_evidence_counts", "rpc");
    expect(countReads.length).toBeGreaterThan(0);
    for (const args of countReads) expect(args).toEqual([{ p_workspace_id: ATP_IDS.workspace, p_ingest_ids: [ATP_IDS.ingest] }]);
    expect(callsFor("project_bca_versions", "eq")).toEqual([["project_id", ATP_IDS.project]]);
    expect(callsFor("engagement_campaigns", "eq")).toEqual([["project_id", ATP_IDS.project]]);
  });

  it("lists the caveats for the evidence the packet carries, and only those (KI-2026-11-02-047)", async () => {
    await exportApplication(post(), context);
    const html = renderReportPdfMock.mock.calls[0][0] as string;
    const cover = html.slice(0, html.indexOf("</header>"));
    expect(cover).toContain(BCA_NARRATIVE_CAVEAT);
    expect(cover).toContain(ENGAGEMENT_NARRATIVE_CAVEAT);
    expect(cover).not.toContain(GRANT_MODELING_PLANNING_CAVEAT);
    expect(cover).not.toContain(KB_NARRATIVE_CAVEAT);
    expect(cover).not.toContain(SAFETY_SEED_CAVEAT);
    expect(cover).toMatch(/<dt>Assembled<\/dt><dd>[A-Z][a-z]+ \d{1,2}, \d{4} at \d{2}:\d{2} \(America\/Los_Angeles\)<\/dd>/);
  });

  it("lists every appendix as missing when the project holds none of the records", async () => {
    tables.projects = () => ({ data: atpProjectRow({ estimated_cost_amount: null, estimated_cost_currency: null, estimated_cost_basis_year: null, estimated_cost_recorded_at: null }), error: null });
    tables.runs = () => ({ data: [], error: null });
    tables.safety_crash_ingests = () => ({ data: [], error: null });
    tables.project_bca_versions = () => ({ data: [], error: null });
    tables.engagement_campaigns = () => ({ data: [], error: null, count: 0 });
    const response = await exportApplication(post(), context);
    expect(response.status).toBe(201);
    const html = renderReportPdfMock.mock.calls[0][0] as string;
    expect(html).toContain("Missing. No finished crash acquisition is saved for the linked project.");
    expect(html).toContain("Missing. No planning-level estimate is recorded on the linked project.");
    expect(html).toContain("Missing. No corridor analysis run is saved for the linked project");
    expect(html).toContain("Missing. No public engagement campaign is linked to the project.");
    expect(html).toContain("Missing. No benefit-cost analysis or screening is saved for the linked project.");
    // With no included evidence, the cover lists no standing caveat.
    expect(html).not.toContain("Standing caveats.");
    expect(statuses(await response.json())).toEqual([
      ["scoring_packet", "included"], ["crash_summary", "missing"], ["cost_estimate", "missing"],
      ["engagement", "missing"], ["equity", "missing"], ["bca", "missing"],
    ]);
  });

  it("marks the run-based appendices unreadable when the runs cannot be read", async () => {
    tables.runs = () => ({ data: null, error: { message: "permission denied" } });
    const response = await exportApplication(post(), context);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(statuses(body)[0]).toEqual(["scoring_packet", "unreadable"]);
    expect(statuses(body)[4]).toEqual(["equity", "unreadable"]);
    expect(renderReportPdfMock.mock.calls[0][0]).not.toContain("<td>60.0</td>");
  });

  it("reads only the selected appendices and lists the rest as not selected", async () => {
    const response = await exportApplication(post({ appendices: ["cost_estimate"] }), context);
    expect(response.status).toBe(201);
    expect(statuses(await response.json()).map(([, status]) => status)).toEqual(["omitted", "omitted", "included", "omitted", "omitted", "omitted"]);
    for (const table of ["runs", "safety_crash_ingests", "rpc:safety_crash_evidence_counts", "project_bca_versions", "engagement_campaigns"]) {
      expect(callsFor(table, "select").concat(callsFor(table, "rpc")), table).toEqual([]);
    }
  });

  it("refuses an appendix another program declares", async () => {
    const response = await exportApplication(post({ appendices: ["hin_map"] }), context);
    expect(response.status).toBe(400);
    expect(renderReportPdfMock).not.toHaveBeenCalled();
  });
});
