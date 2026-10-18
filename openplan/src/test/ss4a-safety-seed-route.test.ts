/** These mocked route controls cannot prove database privileges, locking, rollback or RLS. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { safetySeedFixture, seedId } from "./fixtures/grants/safety-seed";
import { buildSafetySeedPreview, SS4A_ARTIFACT_PROJECTION, SS4A_PROJECT_PROJECTION, SS4A_REPORT_PROJECTION, SS4A_SECTION_PROJECTION } from "@/lib/grants/ss4a-safety-seed";
import { SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION } from "@/lib/safety/crash-evidence";

const mocks = vi.hoisted(() => ({ create: vi.fn(), service: vi.fn(), access: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.create, createServiceRoleClient: mocks.service }));
vi.mock("@/lib/programs/api", () => ({ loadFundingOpportunityAccess: mocks.access }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/assistant/action-approval-server", () => ({ readAssistantExecutionSource: (request: NextRequest) => request.headers.get("x-openplan-assistant-execution-source") === "planner_agent_quick_link" ? "planner_agent_quick_link" : "manual" }));
import { POST } from "@/app/api/funding-opportunities/[opportunityId]/application/safety-seed/route";

type Result = { count?: number | null; data: unknown; error: { message: string; code?: string } | null };
function chain(result: Result) {
  const q = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(), then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve) };
  for (const method of ["select", "eq", "order", "limit"] as const) q[method].mockReturnValue(q);
  q.maybeSingle.mockResolvedValue(result);
  return q;
}
let rows = safetySeedFixture();
let tables: Record<string, ReturnType<typeof chain>>;
let from: ReturnType<typeof vi.fn>;
const context = () => ({ params: Promise.resolve({ opportunityId: rows.opportunity.id }) });
const call = (body: unknown, assistant = false) => POST(new NextRequest("http://localhost/api/funding-opportunities/seed/application/safety-seed", { method: "POST", headers: { "content-type": "application/json", ...(assistant ? { "x-openplan-assistant-execution-source": "planner_agent_quick_link" } : {}) }, body: JSON.stringify(body) }), context());
function install() {
  tables = Object.fromEntries(Object.entries({ funding_opportunities: rows.opportunity, projects: rows.project, report_artifacts: rows.artifact,
    funding_opportunity_application_sections: rows.sections, reports: rows.report, safety_crash_ingests: rows.acquisition,
    funding_opportunity_section_drafts: rows.drafts, funding_opportunity_safety_seeds: null }).map(([table, data]) => [table, chain({ data, count: Array.isArray(data) ? data.length : null, error: null })]));
  from = vi.fn((table: string) => { if (!tables[table]) throw new Error(`Unexpected table ${table}`); return tables[table]; });
  mocks.create.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: seedId(99) } } }) }, from });
  mocks.service.mockReturnValue({ rpc: mocks.rpc });
  mocks.access.mockResolvedValue({ opportunity: rows.opportunity, membership: { role: "member" }, allowed: true, error: null });
  mocks.rpc.mockResolvedValue({ data: { id: seedId(70), draft_ids: [10,11,12,13,14,15].map(seedId) }, error: null });
}
beforeEach(() => { vi.clearAllMocks(); rows = safetySeedFixture(); install(); });

describe("Safety seed preview and atomic apply dispatch", () => {
  it("previews the exact artifact with explicit projections and tenant/project filters and no writer", async () => {
    const response = await call({ operation: "preview", artifactId: rows.artifact.id });
    expect(response.status).toBe(200);
    const payload = await response.json(); expect(payload.preview.sections).toHaveLength(6);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled();
    for (const [table, projection] of Object.entries({ projects: SS4A_PROJECT_PROJECTION, reports: SS4A_REPORT_PROJECTION, report_artifacts: SS4A_ARTIFACT_PROJECTION, funding_opportunity_application_sections: SS4A_SECTION_PROJECTION, safety_crash_ingests: SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION })) expect(tables[table].select).toHaveBeenCalledWith(projection);
    expect(tables.report_artifacts.eq).toHaveBeenCalledWith("id", rows.artifact.id);
    for (const table of ["projects", "reports", "safety_crash_ingests", "funding_opportunity_application_sections", "funding_opportunity_section_drafts"]) expect(tables[table].eq).toHaveBeenCalledWith("workspace_id", rows.opportunity.workspace_id);
    for (const table of ["reports", "safety_crash_ingests"]) expect(tables[table].eq).toHaveBeenCalledWith("project_id", rows.project.id);
    expect(tables.funding_opportunity_section_drafts.select).toHaveBeenCalledWith("id, section_id", { count: "exact" });
    expect(tables.funding_opportunity_section_drafts.limit).toHaveBeenCalledWith(1001);
    expect(mocks.access).toHaveBeenCalledWith(expect.anything(), rows.opportunity.id, seedId(99), "programs.write");
  });
  it("dispatches all six drafts in one RPC, retaining source and final-text expectations", async () => {
    const preview = buildSafetySeedPreview(rows);
    const response = await call({ operation: "apply", artifactId: rows.artifact.id, previewHash: preview.previewHash });
    expect(response.status).toBe(200); expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe("apply_ss4a_safety_seed"); expect(args.p_sections).toEqual(preview.sections);
    expect(args.p_actor).toBe(seedId(99)); expect(args.p_rows.sections[0].final_markdown).toBe("Retain this approved text.");
    expect(args.p_rows.drafts).toEqual(rows.drafts);
    expect(from.mock.calls.map(([table]) => table)).not.toContain("funding_opportunity_attachments");
  });
  it("refuses stale previews and concurrent RPC conflicts without per-section fallback", async () => {
    const before = buildSafetySeedPreview(rows); rows.sections[0].final_markdown = "Concurrent edit";
    expect((await call({ operation: "apply", artifactId: rows.artifact.id, previewHash: before.previewHash })).status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "Section changed" } });
    expect((await call({ operation: "apply", artifactId: rows.artifact.id, previewHash: buildSafetySeedPreview(rows).previewHash })).status).toBe(409);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("returns the retained receipt on a lost-response retry without reseeding changed sources", async () => {
    const preview = buildSafetySeedPreview(rows);
    tables.funding_opportunity_safety_seeds = chain({ data: { id: seedId(70), artifact_id: rows.artifact.id, preview_hash: preview.previewHash, draft_ids: [10,11,12,13,14,15].map(seedId) }, error: null });
    rows.report.updated_at = "2026-10-19T00:00:00Z";
    const response = await call({ operation: "apply", artifactId: rows.artifact.id, previewHash: preview.previewHash });
    expect(response.status).toBe(200); expect((await response.json()).replayed).toBe(true);
    expect(mocks.rpc.mock.calls[0][1].p_sections).toEqual([]);
    expect(from.mock.calls.map(([table]) => table)).toEqual(["funding_opportunity_safety_seeds"]);
  });
  it("refuses an incomplete retained receipt and exposes failed transactions without claiming application", async () => {
    const previewHash = buildSafetySeedPreview(rows).previewHash;
    tables.funding_opportunity_safety_seeds = chain({ data: { artifact_id: rows.artifact.id, draft_ids: [seedId(10)] }, error: null });
    expect((await call({ operation: "apply", artifactId: rows.artifact.id, previewHash })).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
    tables.funding_opportunity_safety_seeds = chain({ data: null, error: null });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "injected transaction failure", code: "XX000" } });
    const response = await call({ operation: "apply", artifactId: rows.artifact.id, previewHash });
    expect(response.status).toBe(500); expect(await response.json()).not.toHaveProperty("applied");
  });
  it.each(["artifact", "acquisition", "drafts", "project", "report"])("fails closed on %s read failure", async (which) => {
    const table = { artifact: "report_artifacts", acquisition: "safety_crash_ingests", drafts: "funding_opportunity_section_drafts", project: "projects", report: "reports" }[which]!;
    tables[table] = chain({ data: null, error: { message: "read failed" } });
    expect((await call({ operation: "preview", artifactId: rows.artifact.id })).status).toBe(500); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects assistants, forged drafts, denied access, legacy data and missing migration", async () => {
    expect((await call({ operation: "apply", artifactId: rows.artifact.id, previewHash: "a".repeat(64) }, true)).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
    expect((await call({ operation: "preview", artifactId: rows.artifact.id, sections: [] })).status).toBe(400);
    mocks.access.mockResolvedValueOnce({ opportunity: rows.opportunity, membership: { role: "viewer" }, allowed: false });
    expect((await call({ operation: "preview", artifactId: rows.artifact.id })).status).toBe(403);
    rows.artifact.metadata_json = { htmlContent: "not an evidence source" };
    const legacy = await call({ operation: "preview", artifactId: rows.artifact.id });
    expect(legacy.status).toBe(422); expect((await legacy.json()).error).toMatch(/Regenerate/);
    tables.funding_opportunity_safety_seeds = chain({ data: null, error: { message: "relation does not exist" } });
    const pending = await call({ operation: "apply", artifactId: rows.artifact.id, previewHash: "a".repeat(64) });
    expect(pending.status).toBe(503); expect((await pending.json()).error).toContain("20261018000002");
  });
});
