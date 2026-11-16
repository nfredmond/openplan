import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ATP_IDS, atpIngestRow, atpProjectRow, atpRunMetrics, atpSeverityCountRows } from "./fixtures/grants/atp-evidence";
import { BCA_VERSION_ROW, CAMPAIGN_ROW, EVIDENCE_DATE } from "./fixtures/grants/ss4a-evidence";
import { seedId } from "./fixtures/grants/safety-seed";

/**
 * AN APPLICATION SEEDED FROM THE EARLIER ATP TEMPLATE EXPORTS THE SAME BYTES.
 *
 * The ATP entry now seeds new applications from a template that follows the
 * Commission's 2027 application. Applications seeded before that keep the
 * seven sections and five attachments they were given. This test sends one
 * fixed application of that kind through the export route, with a fake
 * database, the real HTML builder and the real built-in PDF writer, and
 * compares the SHA-256 of the HTML and of the PDF with the values the same
 * test produced on the commit before the 2027 template existed (`cd7727736`,
 * PR 498's head).
 *
 * The rows are written out here, not read from the catalog, because a saved
 * application holds its own copy of each title: the catalog may change and
 * the saved rows do not.
 *
 * Blind category: the Chrome engine's PDF, which carries its own creation
 * time and so never repeats byte for byte. Chrome prints the HTML pinned
 * here, and `src/lib/reports/pdf.ts` did not change. Also blind: a real
 * database, row-level security and the screen.
 */

const BASE_HTML_SHA256 = "35cc24e69b0eccfc7c69c5b7f67828cb20ee65baccc6e11cbf8ab8af8782f8d4";
const BASE_PDF_SHA256 = "a09cd7b8dc72b1c2b772c35241dd5a5874ec0b2b84e3726a1a35899f03499734";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const loadFundingOpportunityAccessMock = vi.fn();
const uploadMock = vi.fn();
const checkWorkspaceStorageRoomMock = vi.hoisted(() => vi.fn());
const captured = vi.hoisted(() => ({ html: [] as string[] }));
const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => mockAudit }));
vi.mock("@/lib/programs/api", () => ({
  loadFundingOpportunityAccess: (...args: unknown[]) => loadFundingOpportunityAccessMock(...args),
}));
// The real renderer, with the HTML it was handed kept for the hash.
vi.mock("@/lib/reports/pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reports/pdf")>();
  return {
    ...actual,
    renderReportPdf: (html: string, options: Parameters<typeof actual.renderReportPdf>[1]) => {
      captured.html.push(html);
      return actual.renderReportPdf(html, options);
    },
  };
});
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
type Result = { data: unknown; error: { message: string } | null; count?: number | null };

/** A query chain that answers every read with one fixed result. */
function chain(result: () => Result) {
  const self: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "in", "order", "limit", "insert", "range"]) self[method] = () => self;
  self.maybeSingle = async () => {
    const value = result();
    return { ...value, data: Array.isArray(value.data) ? value.data[0] ?? null : value.data };
  };
  self.single = self.maybeSingle;
  self.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(result()).then(onFulfilled, onRejected);
  return self;
}

/** The earlier template's seven sections, as a saved application holds them. */
const EARLIER_SECTIONS: Array<[key: string, title: string, final: string | null]> = [
  ["project-narrative", "Project description and scope", "Demonstration text. The project closes a sidewalk gap on Main Street between two schools.\n\n- 1,200 feet of new sidewalk\n- Four curb ramps"],
  ["need-and-safety", "Statement of need: safety and mobility", "Demonstration text. Collision history is summarized in Appendix B. [VERIFY: collision years]"],
  ["disadvantaged-communities", "Benefit to disadvantaged communities", null],
  ["community-engagement", "Public participation and planning", null],
  ["cost-effectiveness-leverage", "Cost effectiveness and leveraging", null],
  ["implementation-schedule", "Deliverability and schedule", null],
  ["budget-narrative", "Budget and engineer's estimate narrative", null],
];

const sections = EARLIER_SECTIONS.map(([section_key, title, final], index) => ({
  id: seedId(10 + index), workspace_id: ATP_IDS.workspace, opportunity_id: ATP_IDS.opportunity, section_key, title,
  guidance: null, sort_order: index, source: "catalog", suggested_evidence: [], ai_drafting_enabled: section_key !== "budget-narrative",
  status: final ? "final" : "not_started", final_markdown: final, finalized_from_draft_id: null,
  finalized_by: final ? USER_ID : null, finalized_at: final ? "2026-11-15T22:10:00+00:00" : null,
  updated_by: null, created_at: EVIDENCE_DATE, updated_at: EVIDENCE_DATE,
}));

/** The earlier template's five attachments, in four different states. */
const EARLIER_ATTACHMENTS: Array<[key: string, title: string, required: boolean, status: string, kb: string | null, note: string | null]> = [
  ["location-vicinity-map", "Project location and vicinity map", true, "attached", seedId(30), null],
  ["engineers-cost-estimate", "Engineer's cost estimate", true, "missing", null, null],
  ["existing-conditions-photos", "Existing conditions photos", false, "in_progress", null, "Photos due from public works."],
  ["letters-of-support", "Letters of support", false, "not_applicable", null, null],
  ["plan-consistency-documentation", "Plan consistency documentation", false, "missing", null, null],
];

const attachments = EARLIER_ATTACHMENTS.map(([attachment_key, title, required, status, kb, note], index) => ({
  id: seedId(40 + index), workspace_id: ATP_IDS.workspace, opportunity_id: ATP_IDS.opportunity, attachment_key, title,
  guidance: null, required, status, kb_document_id: kb, report_artifact_id: null, note, sort_order: index,
  updated_by: null, created_at: EVIDENCE_DATE, updated_at: EVIDENCE_DATE,
}));

const tables: Record<string, () => Result> = {
  funding_opportunity_application_sections: () => ({ data: sections, error: null }),
  funding_opportunity_attachments: () => ({ data: attachments, error: null }),
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

const savedChromePath = process.env.CHROME_EXECUTABLE_PATH;

beforeEach(() => {
  vi.clearAllMocks();
  captured.html.length = 0;
  // The route stamps the document with the time it runs.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T04:00:00.000Z"));
  // No browser engine: the built-in writer repeats byte for byte.
  process.env.CHROME_EXECUTABLE_PATH = "Z:/no-browser-engine-in-this-test/chrome";
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: (table: string) => {
      const handler = tables[table];
      if (!handler) throw new Error(`Unexpected table: ${table}`);
      return chain(handler);
    },
    rpc: () => chain(() => ({ data: atpSeverityCountRows(), error: null })),
  });
  loadFundingOpportunityAccessMock.mockResolvedValue({
    opportunity: { id: ATP_IDS.opportunity, workspace_id: ATP_IDS.workspace, program_id: null, project_id: ATP_IDS.project,
      title: "Main Street ATP application", agency_name: "California Transportation Commission", summary: null, expected_award_amount: null,
      closes_at: null, opportunity_status: "open", decision_state: "pursue" },
    membership: { workspace_id: ATP_IDS.workspace, role: "member" }, error: null, allowed: true,
  });
  uploadMock.mockResolvedValue({ error: null });
  checkWorkspaceStorageRoomMock.mockResolvedValue({ status: "room", usedBytes: 0, quotaBytes: 5 * 1024 ** 3 });
  createServiceRoleClientMock.mockReturnValue({ storage: { from: () => ({ upload: uploadMock }) } });
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  if (savedChromePath === undefined) delete process.env.CHROME_EXECUTABLE_PATH;
  else process.env.CHROME_EXECUTABLE_PATH = savedChromePath;
});

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

function post() {
  return new NextRequest(`http://localhost/api/funding-opportunities/${ATP_IDS.opportunity}/application/export`, { method: "POST" });
}
const context = { params: Promise.resolve({ opportunityId: ATP_IDS.opportunity }) };

describe("an application seeded from the earlier ATP template", () => {
  it("exports the HTML and the PDF it exported before the 2027 template existed", async () => {
    const response = await exportApplication(post(), context);
    expect(response.status).toBe(201);
    const body = await response.json();

    const [html] = captured.html;
    // The document is the ATP one: seven sections, the old checklist words, six appendices.
    expect(html).toContain("Statement of need: safety and mobility");
    expect(html).toContain("<td>Existing conditions photos</td>\n          <td>Optional</td>");
    expect(html).toContain("Appendix F. Benefit-cost summary");
    expect(html).toContain("DRAFT: 1 required attachment(s) outstanding");
    expect(body.appendices.map((appendix: { status: string }) => appendix.status)).toEqual(Array(6).fill("included"));

    const pdfBytes = uploadMock.mock.calls[0][1] as Uint8Array;
    expect(body.pdfEngine).toBe("builtin");
    expect(Buffer.from(pdfBytes).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(body.sha256).toBe(sha256(pdfBytes));

    expect({ html: sha256(html), pdf: sha256(pdfBytes) }).toEqual({ html: BASE_HTML_SHA256, pdf: BASE_PDF_SHA256 });
  });

  it("gives the same bytes on a second export at the same moment, so the pins can hold", async () => {
    const first = await exportApplication(post(), context);
    const second = await exportApplication(post(), context);
    expect((await first.json()).sha256).toBe((await second.json()).sha256);
    expect(captured.html[0]).toBe(captured.html[1]);
  });
});
